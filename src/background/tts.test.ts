import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock storage.getSettings before importing the background module
vi.mock('./../lib/storage', () => ({
  getSettings: vi.fn(),
}))

import { getSettings } from './../lib/storage'

describe('background TTS service (test-tts)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    ;(globalThis as unknown as { chrome?: any }).chrome = {
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
    mockedGetSettings.mockResolvedValue({ rate: 1, ttsUrl: 'http://localhost:5002/api/tts' } as any)

    // mock fetch to return audio
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'audio/wav' },
      arrayBuffer: async () => fakeBuf,
    } as any)

    // prepare chrome tab
    ;(globalThis as any).chrome.tabs.query.mockResolvedValue([{ id: 101, url: 'https://example.com' }])
    ;(globalThis as any).chrome.tabs.sendMessage.mockResolvedValue(undefined)

  // import module (registers listeners)
  await import('./service-worker')

    // grab the second registered runtime.onMessage handler (the test-tts one)
    const addCalls = (globalThis as any).chrome.runtime.onMessage.addListener.mock.calls
    expect(addCalls.length).toBeGreaterThanOrEqual(2)
    const handler = addCalls[1][0]

    const sendResponse = vi.fn()
    // call handler with test-tts message
    handler({ action: 'test-tts', text: 'hello' }, null, sendResponse)

    // allow async handler to run
    await new Promise((r) => setTimeout(r, 0))

    expect(sendResponse).toHaveBeenCalled()
    const arg = (sendResponse as any).mock.calls[0][0]
    expect(arg).toEqual({ ok: true })
    // ensure audio forwarded to content script
    expect((globalThis as any).chrome.tabs.sendMessage).toHaveBeenCalled()
    const smCall = (globalThis as any).chrome.tabs.sendMessage.mock.calls[0]
    expect(smCall[1].kind).toBe('PLAY_AUDIO')
    expect(smCall[1].audio.byteLength).toBe((fakeBuf as ArrayBuffer).byteLength)
  })

  it('returns error when no ttsUrl configured', async () => {
    const mockedGetSettings = vi.mocked(getSettings)
    mockedGetSettings.mockResolvedValue({ rate: 1 } as any)

    ;(globalThis as any).chrome.tabs.query.mockResolvedValue([{ id: 101, url: 'https://example.com' }])

  await import('./service-worker')
    const addCalls = (globalThis as any).chrome.runtime.onMessage.addListener.mock.calls
    const handler = addCalls[1][0]

    const sendResponse = vi.fn()
    handler({ action: 'test-tts', text: 'hi' }, null, sendResponse)
    await new Promise((r) => setTimeout(r, 0))

    expect(sendResponse).toHaveBeenCalled()
    const arg = (sendResponse as any).mock.calls[0][0]
    expect(arg.ok).toBe(false)
    expect(arg.error).toMatch(/no ttsUrl/)
  })
})
