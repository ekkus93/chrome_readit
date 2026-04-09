import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./../lib/storage', () => ({
  getSettings: vi.fn(async () => ({ rate: 1.25, ttsUrl: 'http://localhost:5002/api/tts', voice: 'v' })),
}))

describe('background bootstrap sequencing', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.resetAllMocks()
    ;(globalThis as unknown as { __CHUNK_TIMEOUT_MS?: number }).__CHUNK_TIMEOUT_MS = 1000
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

  it('retries through the normal content-script path and does not advance the queue early', async () => {
    const long = `${'Sentence one. '.repeat(40)}${'Sentence two. '.repeat(40)}`
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'audio/wav' },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })))

    let resolveRetriedFirstChunk: (() => void) | null = null
    let playAttempt = 0
    const chromeObj = (globalThis as unknown as Record<string, unknown>).chrome as { tabs: { sendMessage: ReturnType<typeof vi.fn> }; scripting: { executeScript: ReturnType<typeof vi.fn> } }
    chromeObj.tabs.sendMessage.mockImplementation((_: unknown, message: { kind: string }) => {
      if (message.kind !== 'PLAY_AUDIO') return Promise.resolve(undefined)
      playAttempt += 1
      if (playAttempt === 1) return Promise.reject(new Error('no content script'))
      if (playAttempt === 2) {
        return new Promise((resolve) => {
          resolveRetriedFirstChunk = () => resolve({ ok: true })
        })
      }
      return Promise.resolve({ ok: true })
    })

    const mod = await import('./service-worker')
    const promise = mod.sendToActiveTabOrInject({ kind: 'READ_TEXT', text: long })

    for (let i = 0; i < 20; i += 1) {
      const playCalls = chromeObj.tabs.sendMessage.mock.calls.filter(([, payload]) => (payload as Record<string, unknown>).kind === 'PLAY_AUDIO')
      if (playCalls.length >= 2) break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    const playCallsBeforeAck = chromeObj.tabs.sendMessage.mock.calls.filter(([, payload]) => (payload as Record<string, unknown>).kind === 'PLAY_AUDIO')
    expect(playCallsBeforeAck).toHaveLength(2)
    expect(chromeObj.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 77 },
      files: ['src/content/content.ts'],
    })

    resolveRetriedFirstChunk?.()
    await promise

    const playCalls = chromeObj.tabs.sendMessage.mock.calls.filter(([, payload]) => (payload as Record<string, unknown>).kind === 'PLAY_AUDIO')
    expect(playCalls.length).toBeGreaterThan(2)
  })
})
