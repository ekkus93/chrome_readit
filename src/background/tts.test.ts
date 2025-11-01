import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from './../lib/storage'

// Mock storage.getSettings before importing the background module
vi.mock('./../lib/storage', () => ({
  getSettings: vi.fn(),
}))

import { getSettings } from './../lib/storage'

describe('background TTS service (test-tts)', () => {
  function getGlobal(path: string[]) {
    let obj: unknown = globalThis
    for (const p of path) {
      if (obj && typeof obj === 'object' && p in (obj as Record<string, unknown>)) {
        obj = (obj as Record<string, unknown>)[p]
      } else {
        return undefined
      }
    }
    return obj
  }
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

  ;(globalThis as unknown as { chrome?: unknown }).chrome = {
      tabs: { query: vi.fn(), sendMessage: vi.fn() },
      scripting: { executeScript: vi.fn() },
      commands: { onCommand: { addListener: vi.fn() } },
      runtime: { onMessage: { addListener: vi.fn() }, onInstalled: { addListener: vi.fn() } },
      contextMenus: { create: vi.fn(), onClicked: { addListener: vi.fn() } },
    }
  })

  it('responds ok and forwards audio when ttsUrl returns audio', async () => {
    const fakeBuf = new Uint8Array([1, 2, 3]).buffer

  // configure mocked getSettings
  const mockedGetSettings = vi.mocked(getSettings)
  mockedGetSettings.mockResolvedValue({ rate: 1, ttsUrl: 'http://localhost:5002/api/tts' } as Settings)

    // mock fetch to return audio
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'audio/wav' },
      arrayBuffer: async () => fakeBuf,
    } as unknown)

    // prepare chrome tab
  // Ensure chrome.tabs.query/sendMessage will behave like a real tab for this test
  const chromeObj = getGlobal(['chrome']) as unknown as Record<string, unknown>
  chromeObj.tabs = {
    query: vi.fn(() => Promise.resolve([{ id: 101, url: 'https://example.com' }])),
    sendMessage: vi.fn(() => Promise.resolve(undefined)),
  }

  // import module (registers listeners)
  await import('./service-worker')

  // grab the second registered runtime.onMessage handler (the test-tts one)
  const runtimeOnMessage = getGlobal(['chrome', 'runtime', 'onMessage']) as unknown as { addListener?: { mock?: { calls?: unknown[][] } } }
  const addCalls = (runtimeOnMessage.addListener?.mock?.calls as unknown[][]) || []
  expect(addCalls.length).toBeGreaterThanOrEqual(2)

  // Some handlers registered on runtime.onMessage are generic; find the one
  // that handles the test-tts action by invoking each registered handler and
  // checking which one calls the provided sendResponse with a value.
  let foundArg: unknown = undefined
  for (const call of addCalls) {
    const handler = call && (call[0] as unknown as (...args: unknown[]) => void)
    if (!handler) continue
    const sr = vi.fn()
    try {
      handler({ action: 'test-tts', text: 'hello' }, null, sr)
    } catch (e) { void e }
    // allow async handler to run
    await new Promise((r) => setTimeout(r, 0))
    const calls = (sr as unknown as { mock?: { calls?: unknown[][] } }).mock?.calls || []
    if (calls.length) {
      foundArg = calls[0][0]
      break
    }
  }
  expect(foundArg).toBeDefined()
  expect((foundArg as Record<string, unknown>)?.ok).toBe(true)
    // response should include audio bytes and mime type so callers can play it
  const arg = foundArg
  expect((arg as Record<string, unknown>)?.audio).toBeDefined()
  expect((arg as Record<string, unknown>)?.mime).toBe('audio/wav')
  expect(((arg as Record<string, unknown>)?.audio as ArrayBuffer).byteLength).toBe((fakeBuf as ArrayBuffer).byteLength)
    // ensure audio was also forwarded to content script
    const tabsSend = getGlobal(['chrome', 'tabs', 'sendMessage']) as unknown as { mock?: { calls?: unknown[][] } }
    const tabsCalls = (tabsSend.mock?.calls as unknown[][]) || []
    expect(tabsCalls.length).toBeGreaterThan(0)
    const smCall = tabsCalls[0]
    expect((smCall[1] as Record<string, unknown>).kind).toBe('PLAY_AUDIO')
    expect(((smCall[1] as Record<string, unknown>).audio as ArrayBuffer).byteLength).toBe((fakeBuf as ArrayBuffer).byteLength)
  })

  it('returns error when no ttsUrl configured', async () => {
    const mockedGetSettings = vi.mocked(getSettings)
  mockedGetSettings.mockResolvedValue({ rate: 1 } as Settings)

  await import('./service-worker')
    const runtimeOnMessage2 = getGlobal(['chrome', 'runtime', 'onMessage']) as unknown as { addListener?: { mock?: { calls?: unknown[][] } } }
    const addCalls = (runtimeOnMessage2.addListener?.mock?.calls as unknown[][]) || []
    const handler = addCalls[1] && (addCalls[1][0] as unknown as (...args: unknown[]) => void)

    const sendResponse = vi.fn()
    handler({ action: 'test-tts', text: 'hi' }, null, sendResponse)
    await new Promise((r) => setTimeout(r, 0))

    expect(sendResponse).toHaveBeenCalled()
    const sendRespCalls2 = (sendResponse as unknown as { mock?: { calls?: unknown[][] } }).mock?.calls || []
    const arg2 = sendRespCalls2[0] && sendRespCalls2[0][0]
    expect((arg2 as Record<string, unknown>)?.ok).toBe(false)
    expect(String((arg2 as Record<string, unknown>)?.error)).toMatch(/no ttsUrl/)
  })
})
