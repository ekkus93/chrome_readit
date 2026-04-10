import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetBackgroundPlaybackState, resetBackgroundTestGlobals } from './test-helpers'

vi.mock('./../lib/storage', () => ({
  getSettings: vi.fn(async () => ({ rate: 1.25, ttsUrl: 'http://localhost:5002/api/tts', voice: 'v' })),
}))

describe('background bootstrap sequencing', () => {
  let mod: typeof import('./service-worker') | undefined
  beforeEach(async () => {
    vi.resetModules()
    vi.resetAllMocks()
    ;(globalThis as unknown as { __CHUNK_TIMEOUT_MS?: number }).__CHUNK_TIMEOUT_MS = 1000
    ;(globalThis as unknown as { __CHUNK_GAP_MS?: number }).__CHUNK_GAP_MS = 40
    ;(globalThis as unknown as { __CHUNK_PARAGRAPH_GAP_MS?: number }).__CHUNK_PARAGRAPH_GAP_MS = 80
    const storage = await import('./../lib/storage')
    vi.mocked(storage.getSettings).mockResolvedValue({ rate: 1.25, ttsUrl: 'http://localhost:5002/api/tts', voice: 'v' })

    type ChromeMock = {
      tabs: { query: (...args: unknown[]) => Promise<unknown>; sendMessage: (...args: unknown[]) => unknown }
      scripting: { executeScript: (...args: unknown[]) => unknown }
      commands: { onCommand: { addListener: (...args: unknown[]) => unknown } }
      runtime: { onMessage: { addListener: (...args: unknown[]) => unknown }; onInstalled: { addListener: (...args: unknown[]) => unknown }; sendMessage: (...args: unknown[]) => unknown }
      contextMenus: { create: (...args: unknown[]) => unknown; onClicked: { addListener: (...args: unknown[]) => unknown } }
    }

    ;(globalThis as unknown as Record<string, unknown>).chrome = {
      tabs: {
        query: vi.fn(() => Promise.resolve([{ id: 77, url: 'https://example.com' }])),
        sendMessage: vi.fn(),
      },
      scripting: { executeScript: vi.fn(() => Promise.resolve(undefined)) },
      commands: { onCommand: { addListener: vi.fn() } },
      runtime: { onMessage: { addListener: vi.fn() }, onInstalled: { addListener: vi.fn() }, sendMessage: vi.fn() },
      contextMenus: { create: vi.fn(), onClicked: { addListener: vi.fn() } },
    } satisfies ChromeMock
  })

  afterEach(() => {
    resetBackgroundPlaybackState(mod)
    resetBackgroundTestGlobals()
    mod = undefined
  })

  it('does not advance the queue early while the first offscreen playback ack is pending', async () => {
    const long = `${'Sentence one. '.repeat(40)}${'Sentence two. '.repeat(40)}`
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'audio/wav' },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })))

    let resolveFirstChunk: (() => void) | null = null
    const chromeObj = (globalThis as unknown as Record<string, unknown>).chrome as { runtime: { sendMessage: ReturnType<typeof vi.fn> } }
    mod = await import('./service-worker')
    chromeObj.runtime.sendMessage.mockImplementation((message: Record<string, unknown>) => {
      if (message.action !== 'OFFSCREEN_PLAY_AUDIO') return Promise.resolve(undefined)
      if (!resolveFirstChunk) {
        return new Promise((resolve) => {
          resolveFirstChunk = () => {
            queueMicrotask(() => mod?.__testing.resolvePendingPlaybackAck(String((message as unknown as Record<string, unknown>).playbackToken ?? ''), { ok: true }))
            resolve({ ok: true })
          }
        })
      }
      queueMicrotask(() => mod?.__testing.resolvePendingPlaybackAck(String((message as unknown as Record<string, unknown>).playbackToken ?? ''), { ok: true }))
      return Promise.resolve({ ok: true })
    })

    const promise = mod.sendToActiveTabOrInject({ kind: 'READ_TEXT', text: long })

    for (let i = 0; i < 20; i += 1) {
      const playCalls = chromeObj.runtime.sendMessage.mock.calls.filter(([payload]) => (payload as Record<string, unknown>).action === 'OFFSCREEN_PLAY_AUDIO')
      if (playCalls.length >= 2) break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    const playCallsBeforeAck = chromeObj.runtime.sendMessage.mock.calls.filter(([payload]) => (payload as Record<string, unknown>).action === 'OFFSCREEN_PLAY_AUDIO')
    expect(playCallsBeforeAck).toHaveLength(1)

    resolveFirstChunk?.()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(
      chromeObj.runtime.sendMessage.mock.calls.filter(([payload]) => (payload as Record<string, unknown>).action === 'OFFSCREEN_PLAY_AUDIO'),
    ).toHaveLength(1)

    await new Promise((resolve) => setTimeout(resolve, 50))
    await promise

    const playCalls = chromeObj.runtime.sendMessage.mock.calls.filter(([payload]) => (payload as Record<string, unknown>).action === 'OFFSCREEN_PLAY_AUDIO')
    expect(playCalls.length).toBeGreaterThan(1)
  })
})
