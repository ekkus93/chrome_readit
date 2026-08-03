import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PLAYBACK_STATUS } from './lib/playback-protocol'

type Listener = (...args: unknown[]) => unknown

type ChromeMock = {
  runtime: {
    onMessage: { addListener: ReturnType<typeof vi.fn> }
    sendMessage: ReturnType<typeof vi.fn>
    lastError?: { message?: string }
  }
}

let chromeMock: ChromeMock

describe('offscreen message routing', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()

    const globalState = globalThis as unknown as {
      __readitOffscreenRuntimeState?: unknown
      chrome?: ChromeMock
    }
    delete globalState.__readitOffscreenRuntimeState

    chromeMock = {
      runtime: {
        onMessage: { addListener: vi.fn() },
        sendMessage: vi.fn(),
        lastError: undefined,
      },
    }
    globalState.chrome = chromeMock

    vi.stubGlobal('Audio', vi.fn(() => ({
      src: '',
      preload: '',
      playbackRate: 1,
      onended: null,
      onerror: null,
      play: vi.fn(() => Promise.resolve()),
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      load: vi.fn(),
    })))
  })

  it('registers the runtime listener only once across repeated imports', async () => {
    await import('./offscreen')
    vi.resetModules()
    await import('./offscreen')

    expect(chromeMock.runtime.onMessage.addListener).toHaveBeenCalledTimes(1)
  })

  it('returns the coordinator status through the shared protocol', async () => {
    await import('./offscreen')
    const listener = chromeMock.runtime.onMessage.addListener.mock.calls[0]?.[0] as Listener
    const sendResponse = vi.fn()

    const claimed = listener({ kind: PLAYBACK_STATUS }, null, sendResponse)

    expect(claimed).toBe(true)
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      kind: PLAYBACK_STATUS,
      state: 'idle',
      sessionId: null,
    }))
  })

  it('does not claim unrelated runtime messages', async () => {
    await import('./offscreen')
    const listener = chromeMock.runtime.onMessage.addListener.mock.calls[0]?.[0] as Listener

    expect(listener({ kind: 'UNRELATED' }, null, vi.fn())).toBe(false)
  })
})

describe('offscreen coordinator boundary failures', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    vi.unstubAllGlobals()
    const globalState = globalThis as unknown as {
      __readitOffscreenRuntimeState?: unknown
      chrome?: ChromeMock
    }
    delete globalState.__readitOffscreenRuntimeState
    chromeMock = {
      runtime: {
        onMessage: { addListener: vi.fn() },
        sendMessage: vi.fn(),
        lastError: undefined,
      },
    }
    globalState.chrome = chromeMock
  })

  function installCoordinator(overrides: Record<string, unknown> = {}) {
    const coordinator = {
      start: vi.fn().mockResolvedValue({ ok: true, accepted: true, requestId: 'request-1', sessionId: 'session-1' }),
      control: vi.fn().mockResolvedValue({ ok: true, sessionId: 'session-1', state: 'paused' }),
      getStatus: vi.fn(() => ({
        kind: PLAYBACK_STATUS,
        sequence: 0,
        state: 'idle',
        sessionId: null,
        requestId: null,
        source: null,
        currentChunk: 0,
        totalChunks: 0,
        currentParagraph: 0,
        totalParagraphs: 0,
      })),
      getDiagnosticEvents: vi.fn(() => []),
      getPlayerDiagnostics: vi.fn(() => ({
        activePlayerCount: 0,
        maxActivePlayerCount: 1,
        playAttemptCount: 1,
        successfulPlayStartCount: 1,
        settlementCount: 1,
        cleanupFailureCount: 0,
        lastCleanupFailureStage: null,
        invariantViolationCount: 0,
      })),
      ...overrides,
    }
    ;(globalThis as unknown as { __readitOffscreenRuntimeState?: unknown }).__readitOffscreenRuntimeState = {
      initialized: false,
      coordinator,
    }
    return coordinator
  }

  function startRequest() {
    return {
      kind: 'START_PLAYBACK',
      requestId: 'request-1',
      source: 'popup-test',
      text: 'Hello.',
      settings: { ttsUrl: 'http://localhost:5002/api/tts', voice: 'p225', rate: 1 },
    }
  }

  it('routes valid start and control requests to the coordinator', async () => {
    const coordinator = installCoordinator()
    await import('./offscreen')
    const listener = chromeMock.runtime.onMessage.addListener.mock.calls[0]?.[0] as Listener
    const startResponse = vi.fn()
    const controlResponse = vi.fn()

    expect(listener(startRequest(), null, startResponse)).toBe(true)
    expect(listener({ kind: 'PLAYBACK_CONTROL', action: 'pause', expectedSessionId: 'session-1' }, null, controlResponse)).toBe(true)
    await vi.waitFor(() => expect(startResponse).toHaveBeenCalled())
    await vi.waitFor(() => expect(controlResponse).toHaveBeenCalled())
    expect(coordinator.start).toHaveBeenCalledWith(startRequest())
    expect(coordinator.control).toHaveBeenCalledWith('pause', 'session-1')
  })

  it('returns stable internal failures when start or control rejects', async () => {
    installCoordinator({
      start: vi.fn().mockRejectedValue(new Error('secret start detail')),
      control: vi.fn().mockRejectedValue(new Error('secret control detail')),
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await import('./offscreen')
    const listener = chromeMock.runtime.onMessage.addListener.mock.calls[0]?.[0] as Listener
    const startResponse = vi.fn()
    const controlResponse = vi.fn()

    listener(startRequest(), null, startResponse)
    listener({ kind: 'PLAYBACK_CONTROL', action: 'cancel' }, null, controlResponse)
    await vi.waitFor(() => expect(startResponse).toHaveBeenCalledWith(expect.objectContaining({
      ok: false,
      error: { code: 'INTERNAL_PLAYBACK_ERROR', message: expect.not.stringContaining('secret') },
    })))
    await vi.waitFor(() => expect(controlResponse).toHaveBeenCalledWith(expect.objectContaining({
      ok: false,
      error: { code: 'INTERNAL_PLAYBACK_ERROR', message: expect.not.stringContaining('secret') },
    })))
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('returns a stable failed status when coordinator status retrieval throws', async () => {
    installCoordinator({ getStatus: vi.fn(() => { throw new Error('status secret') }) })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await import('./offscreen')
    const listener = chromeMock.runtime.onMessage.addListener.mock.calls[0]?.[0] as Listener
    const sendResponse = vi.fn()

    expect(listener({ kind: PLAYBACK_STATUS }, null, sendResponse)).toBe(true)
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      state: 'failed',
      error: { code: 'INTERNAL_PLAYBACK_ERROR', message: expect.not.stringContaining('secret') },
    }))
  })

  it('returns diagnostic snapshots only in diagnostic builds', async () => {
    vi.stubGlobal('__READIT_E2E__', true)
    const coordinator = installCoordinator()
    await import('./offscreen')
    const listener = chromeMock.runtime.onMessage.addListener.mock.calls[0]?.[0] as Listener
    const sendResponse = vi.fn()

    expect(listener({ kind: 'PLAYBACK_DIAGNOSTICS_OFFSCREEN' }, null, sendResponse)).toBe(true)
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      status: coordinator.getStatus(),
      events: [],
      player: coordinator.getPlayerDiagnostics(),
    })
  })

  it('publishes the diagnostic initialization event and tolerates publication failure', async () => {
    vi.stubGlobal('__READIT_E2E__', true)
    vi.stubGlobal('Audio', vi.fn(() => ({
      src: '',
      preload: '',
      playbackRate: 1,
      onended: null,
      onerror: null,
      play: vi.fn(() => Promise.resolve()),
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      load: vi.fn(),
    })))
    chromeMock.runtime.sendMessage.mockImplementation(() => { throw new Error('runtime unavailable') })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const module = await import('./offscreen')

    expect(module.__testing.getCoordinator().getStatus().state).toBe('idle')
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'PLAYBACK_EVENT',
      event: 'state-changed',
      player: expect.objectContaining({ activePlayerCount: 0 }),
    }), expect.any(Function))
    expect(warn).toHaveBeenCalledWith('[readit] playback event publication failed')
  })

  it('rejects malformed protocol messages without claiming them', async () => {
    installCoordinator()
    await import('./offscreen')
    const listener = chromeMock.runtime.onMessage.addListener.mock.calls[0]?.[0] as Listener

    expect(listener({ kind: 'START_PLAYBACK', requestId: 4 }, null, vi.fn())).toBe(false)
    expect(listener({ kind: 'PLAYBACK_CONTROL', action: 'explode' }, null, vi.fn())).toBe(false)
    expect(listener({ kind: PLAYBACK_STATUS, unexpected: true }, null, vi.fn())).toBe(true)
  })
})
