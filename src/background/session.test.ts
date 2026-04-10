import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetBackgroundPlaybackState, resetBackgroundTestGlobals } from './test-helpers'

vi.mock('./../lib/storage', () => ({ getSettings: vi.fn(async () => ({ rate: 1.0, ttsUrl: 'http://localhost:5002/api/tts', voice: 'v' })) }))

describe('background playback sessions', () => {
  let mod: typeof import('./service-worker') | undefined
  beforeEach(async () => {
    vi.resetModules()
    vi.resetAllMocks()
    ;(globalThis as unknown as { __CHUNK_TIMEOUT_MS?: number }).__CHUNK_TIMEOUT_MS = 25
    ;(globalThis as unknown as { __CHUNK_GAP_MS?: number }).__CHUNK_GAP_MS = 50
    ;(globalThis as unknown as { __CHUNK_PARAGRAPH_GAP_MS?: number }).__CHUNK_PARAGRAPH_GAP_MS = 80
    const storage = await import('./../lib/storage')
    vi.mocked(storage.getSettings).mockResolvedValue({ rate: 1.0, ttsUrl: 'http://localhost:5002/api/tts', voice: 'v' })

    type ChromeMock = {
      tabs: { query: (...args: unknown[]) => Promise<unknown>; sendMessage: ReturnType<typeof vi.fn> }
      scripting: { executeScript: (...args: unknown[]) => unknown }
      commands: { onCommand: { addListener: (...args: unknown[]) => unknown } }
      runtime: { onMessage: { addListener: ReturnType<typeof vi.fn> }; onInstalled: { addListener: (...args: unknown[]) => unknown }; sendMessage: ReturnType<typeof vi.fn> }
      contextMenus: { create: (...args: unknown[]) => unknown; onClicked: { addListener: (...args: unknown[]) => unknown } }
    }

    ;(globalThis as unknown as Record<string, unknown>).chrome = {
      tabs: {
        query: vi.fn(() => Promise.resolve([{ id: 42, url: 'https://example.com' }])),
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

  function acknowledgePlayback(mod: typeof import('./service-worker'), token: unknown, result: { ok: boolean; error?: string } = { ok: true }) {
    queueMicrotask(() => {
      if (typeof token === 'string') mod.__testing.resolvePendingPlaybackAck(token, result)
    })
  }

  it('starting a new session stops the previous session before new playback starts', async () => {
    let firstPlaybackResolved = false
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'audio/wav' },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })))

    const chromeObj = (globalThis as unknown as Record<string, unknown>).chrome as { runtime: { sendMessage: ReturnType<typeof vi.fn> } }
    mod = await import('./service-worker')
    chromeObj.runtime.sendMessage.mockImplementation((message: Record<string, unknown>) => {
      if (message.action === 'OFFSCREEN_PLAY_AUDIO' && !firstPlaybackResolved) {
        firstPlaybackResolved = true
        return new Promise((resolve) => {
          setTimeout(() => {
            acknowledgePlayback(mod!, message.playbackToken)
            resolve({ ok: true })
          }, 40)
        })
      }
      if (message.action === 'OFFSCREEN_PLAY_AUDIO') {
        acknowledgePlayback(mod!, message.playbackToken)
        return Promise.resolve({ ok: true })
      }
      if (message.action === 'OFFSCREEN_STOP_AUDIO') return Promise.resolve({ ok: true })
      return Promise.resolve(undefined)
    })

    const first = mod.sendToActiveTabOrInject({ kind: 'READ_TEXT', text: 'First session text.' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const second = mod.sendToActiveTabOrInject({ kind: 'READ_TEXT', text: 'Second session text.' })

    await Promise.all([first, second])

    const sendCalls = chromeObj.runtime.sendMessage.mock.calls
    const firstStopIndex = sendCalls.findIndex(([payload]) => (payload as Record<string, unknown>).action === 'OFFSCREEN_STOP_AUDIO')
    const secondPlayIndex = sendCalls.findIndex(([payload], index) => index > firstStopIndex && (payload as Record<string, unknown>).action === 'OFFSCREEN_PLAY_AUDIO')

    expect(firstStopIndex).toBeGreaterThanOrEqual(0)
    expect(secondPlayIndex).toBeGreaterThan(firstStopIndex)
  })

  it('stale async work exits when a newer session replaces it', async () => {
    let resolveFirstFetch: ((value: { ok: boolean; headers: { get: () => string }; arrayBuffer: () => Promise<ArrayBuffer> }) => void) | null = null
    vi.stubGlobal('fetch', vi.fn((_: unknown, init?: unknown) => {
      const body = JSON.parse(String((init as Record<string, unknown>).body))
      if (body.text === 'First session text.') {
        return new Promise((resolve) => {
          resolveFirstFetch = resolve as typeof resolveFirstFetch
        })
      }
      return Promise.resolve({
        ok: true,
        headers: { get: () => 'audio/wav' },
        arrayBuffer: async () => new Uint8Array([9, 9]).buffer,
      })
    }))

    const chromeObj = (globalThis as unknown as Record<string, unknown>).chrome as { runtime: { sendMessage: ReturnType<typeof vi.fn> } }
    mod = await import('./service-worker')
    chromeObj.runtime.sendMessage.mockImplementation((message: Record<string, unknown>) => {
      if (message.action === 'OFFSCREEN_PLAY_AUDIO') {
        acknowledgePlayback(mod!, message.playbackToken)
        return Promise.resolve({ ok: true })
      }
      return Promise.resolve(undefined)
    })

    const first = mod.sendToActiveTabOrInject({ kind: 'READ_TEXT', text: 'First session text.' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const second = mod.sendToActiveTabOrInject({ kind: 'READ_TEXT', text: 'Second session text.' })
    resolveFirstFetch?.({
      ok: true,
      headers: { get: () => 'audio/wav' },
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    })

    await Promise.all([first, second])

    const playCalls = chromeObj.runtime.sendMessage.mock.calls.filter(([payload]) => (payload as Record<string, unknown>).action === 'OFFSCREEN_PLAY_AUDIO')
    const playbackTokens = playCalls.map(([payload]) => String((payload as Record<string, unknown>).playbackToken ?? ''))
    expect(playbackTokens).not.toContain('1:0')
    expect(playbackTokens).toContain('2:0')
  })

  it('does not start the next chunk if the session is replaced during the handoff gap', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'audio/wav' },
      arrayBuffer: async () => new Uint8Array([7, 7]).buffer,
    })))

    const chromeObj = (globalThis as unknown as Record<string, unknown>).chrome as { runtime: { sendMessage: ReturnType<typeof vi.fn> } }
    mod = await import('./service-worker')
    chromeObj.runtime.sendMessage.mockImplementation((message: Record<string, unknown>) => {
      if (message.action === 'OFFSCREEN_PLAY_AUDIO') {
        acknowledgePlayback(mod!, message.playbackToken)
        return Promise.resolve({ ok: true })
      }
      if (message.action === 'OFFSCREEN_STOP_AUDIO') return Promise.resolve({ ok: true })
      return Promise.resolve(undefined)
    })

    const first = mod.sendToActiveTabOrInject({ kind: 'READ_TEXT', text: `${'First session sentence. '.repeat(25)}\n\n${'Next paragraph sentence. '.repeat(25)}` })
    await new Promise((resolve) => setTimeout(resolve, 10))
    const second = mod.sendToActiveTabOrInject({ kind: 'READ_TEXT', text: 'Second session text.' })

    await Promise.all([first, second])

    const playCalls = chromeObj.runtime.sendMessage.mock.calls.filter(([payload]) => (payload as Record<string, unknown>).action === 'OFFSCREEN_PLAY_AUDIO')
    const playbackTokens = playCalls.map(([payload]) => String((payload as Record<string, unknown>).playbackToken ?? ''))
    expect(playbackTokens).not.toContain('1:1')
    expect(playbackTokens).toContain('2:0')
  })

  it('reports only the current active session through speech-status', async () => {
    let releasePlayback: (() => void) | null = null
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'audio/wav' },
      arrayBuffer: async () => new Uint8Array([4, 5, 6]).buffer,
    })))

    const chromeObj = (globalThis as unknown as Record<string, unknown>).chrome as { runtime: { sendMessage: ReturnType<typeof vi.fn>; onMessage: { addListener: ReturnType<typeof vi.fn> } } }
    mod = await import('./service-worker')
    chromeObj.runtime.sendMessage.mockImplementation((message: Record<string, unknown>) => {
      if (message.action === 'OFFSCREEN_PLAY_AUDIO') {
        return new Promise((resolve) => {
          releasePlayback = () => {
            acknowledgePlayback(mod!, message.playbackToken)
            resolve({ ok: true })
          }
        })
      }
      return Promise.resolve(undefined)
    })

    void mod.sendToActiveTabOrInject({ kind: 'READ_TEXT', text: 'First session text.' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    void mod.sendToActiveTabOrInject({ kind: 'READ_TEXT', text: 'Second session text.' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const runtimeHandlers = chromeObj.runtime.onMessage.addListener.mock.calls
    const statusHandler = runtimeHandlers[0]?.[0] as (msg: unknown, sender: unknown, sendResponse: (value: unknown) => void) => void
    const sendResponse = vi.fn()
    statusHandler({ kind: 'SPEECH_STATUS' }, null, sendResponse)

    expect(sendResponse).toHaveBeenCalledWith({ ok: true, state: 'playing', current: 1, total: 1 })
    releasePlayback?.()
  })
})
