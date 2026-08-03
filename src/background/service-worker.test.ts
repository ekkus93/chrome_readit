import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/storage', () => ({
  getSettings: vi.fn(),
}))

import { getSettings } from '../lib/storage'
import { PLAYBACK_CONTROL, PLAYBACK_STATUS, START_PLAYBACK, type PlaybackStatus } from '../lib/playback-protocol'

function installChromeMock() {
  const sessionValues: Record<string, unknown> = {}
  const chromeMock = {
    tabs: { query: vi.fn() },
    scripting: { executeScript: vi.fn() },
    offscreen: {
      Reason: { AUDIO_PLAYBACK: 'AUDIO_PLAYBACK' },
      createDocument: vi.fn().mockResolvedValue(undefined),
      hasDocument: vi.fn(),
    },
    commands: { onCommand: { addListener: vi.fn() } },
    runtime: {
      onMessage: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
      sendMessage: vi.fn(),
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      getContexts: vi.fn().mockResolvedValue([]),
      lastError: undefined as { message?: string } | undefined,
    },
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: sessionValues[key] })),
        set: vi.fn(async (updates: Record<string, unknown>) => { Object.assign(sessionValues, updates) }),
      },
    },
    contextMenus: {
      removeAll: vi.fn((callback: () => void) => callback()),
      create: vi.fn(),
      onClicked: { addListener: vi.fn() },
    },
  }
  ;(globalThis as unknown as { chrome: typeof chrome }).chrome = chromeMock as unknown as typeof chrome
  return { chromeMock, sessionValues }
}

function status(overrides: Partial<PlaybackStatus> = {}): PlaybackStatus {
  return {
    kind: PLAYBACK_STATUS,
    sequence: 1,
    state: 'playing',
    sessionId: 'session-1',
    requestId: 'request-1',
    source: 'selection',
    currentChunk: 1,
    totalChunks: 2,
    currentParagraph: 1,
    totalParagraphs: 1,
    ...overrides,
  }
}

function idleStatus(): PlaybackStatus {
  return status({
    sequence: 0,
    state: 'idle',
    sessionId: null,
    requestId: null,
    source: null,
    currentChunk: 0,
    totalChunks: 0,
    currentParagraph: 0,
    totalParagraphs: 0,
  })
}

describe('background playback router', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    vi.mocked(getSettings).mockResolvedValue({
      voice: 'p225',
      rate: 1.25,
      ttsUrl: 'http://localhost:5002/api/tts',
    })
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'request-uuid') })
  })

  it('captures the active selection and forwards one start request to offscreen', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { chromeMock } = installChromeMock()
    chromeMock.tabs.query.mockResolvedValue([{ id: 42, url: 'https://example.com' }])
    chromeMock.scripting.executeScript.mockResolvedValue([{ result: ' Selected text. ' }])
    chromeMock.runtime.sendMessage.mockImplementation(async (message: Record<string, unknown>) => {
      if (message.kind === PLAYBACK_STATUS) return idleStatus()
      return {
        ok: true,
        accepted: true,
        requestId: message.requestId,
        sessionId: 'session-uuid',
      }
    })

    const module = await import('./service-worker')
    const result = await module.sendToActiveTabOrInject({ kind: 'READ_SELECTION' })

    expect(result).toMatchObject({ ok: true, accepted: true, sessionId: 'session-uuid' })
    expect(chromeMock.offscreen.createDocument).toHaveBeenCalledTimes(1)
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      kind: START_PLAYBACK,
      requestId: 'request-uuid',
      source: 'selection',
      text: 'Selected text.',
      settings: {
        ttsUrl: 'http://localhost:5002/api/tts',
        voice: 'p225',
        rate: 1.25,
      },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('waits for a valid offscreen status before forwarding the first fresh-document start', async () => {
    const { chromeMock } = installChromeMock()
    let readinessAttempts = 0
    chromeMock.runtime.sendMessage.mockImplementation(async (message: Record<string, unknown>) => {
      if (message.kind === PLAYBACK_STATUS) {
        readinessAttempts += 1
        return readinessAttempts < 3 ? undefined : idleStatus()
      }
      return {
        ok: true,
        accepted: true,
        requestId: message.requestId,
        sessionId: 'session-ready',
      }
    })

    const module = await import('./service-worker')
    const result = await module.sendToActiveTabOrInject({ kind: 'READ_TEXT', text: 'Fresh start.', source: 'popup-test' })

    expect(result).toMatchObject({ ok: true, accepted: true, sessionId: 'session-ready' })
    expect(readinessAttempts).toBe(3)
    expect(chromeMock.runtime.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: START_PLAYBACK,
      text: 'Fresh start.',
    }))
  })

  it('preserves the explicit source for popup and Options test requests', async () => {
    const { chromeMock } = installChromeMock()
    chromeMock.runtime.sendMessage.mockImplementation(async (message: Record<string, unknown>) => {
      if (message.kind === PLAYBACK_STATUS) return idleStatus()
      return {
        ok: true,
        accepted: true,
        requestId: message.requestId,
        sessionId: 'session-uuid',
      }
    })

    const module = await import('./service-worker')
    await module.sendToActiveTabOrInject({ kind: 'READ_TEXT', text: 'Hello.', source: 'popup-test' })

    expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled()
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      kind: START_PLAYBACK,
      source: 'popup-test',
      text: 'Hello.',
    }))
  })

  it('rejects READ_TEXT without an explicit source through the runtime listener', async () => {
    const { chromeMock } = installChromeMock()
    await import('./service-worker')
    const listener = chromeMock.runtime.onMessage.addListener.mock.calls[0]?.[0]
    const sendResponse = vi.fn()

    expect(listener({ kind: 'READ_TEXT', text: 'Hello.' }, null, sendResponse)).toBe(true)
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      ok: false,
      error: { code: 'INVALID_REQUEST', message: expect.any(String) },
    }))
  })

  it('returns a structured error for unsupported pages', async () => {
    const { chromeMock } = installChromeMock()
    chromeMock.tabs.query.mockResolvedValue([{ id: 1, url: 'chrome://settings' }])

    const module = await import('./service-worker')
    await expect(module.sendToActiveTabOrInject({ kind: 'READ_SELECTION' })).resolves.toMatchObject({
      ok: false,
      accepted: false,
      error: { code: 'INVALID_REQUEST' },
    })
    expect(chromeMock.offscreen.createDocument).not.toHaveBeenCalled()
  })

  it('coalesces concurrent offscreen creation', async () => {
    const { chromeMock } = installChromeMock()
    let resolveCreation: (() => void) | undefined
    chromeMock.offscreen.createDocument.mockReturnValue(new Promise<void>((resolve) => { resolveCreation = resolve }))

    const module = await import('./service-worker')
    const first = module.__testing.ensureOffscreenPlaybackDocument()
    const second = module.__testing.ensureOffscreenPlaybackDocument()
    await vi.waitFor(() => expect(resolveCreation).toBeTypeOf('function'))
    resolveCreation?.()
    await Promise.all([first, second])

    expect(chromeMock.offscreen.createDocument).toHaveBeenCalledTimes(1)
  })

  it('fails explicitly when no supported offscreen existence API is available', async () => {
    const { chromeMock } = installChromeMock()
    delete (chromeMock.runtime as { getContexts?: unknown }).getContexts
    delete (chromeMock.offscreen as { hasDocument?: unknown }).hasDocument

    const module = await import('./service-worker')
    await expect(module.__testing.ensureOffscreenPlaybackDocument()).rejects.toThrow('OFFSCREEN_UNSUPPORTED')
    expect(chromeMock.offscreen.createDocument).not.toHaveBeenCalled()
  })

  it('forwards controls through the shared protocol with expected session protection', async () => {
    const { chromeMock } = installChromeMock()
    chromeMock.runtime.sendMessage.mockImplementation(async (message: Record<string, unknown>) => {
      if (message.kind === PLAYBACK_STATUS) return idleStatus()
      return { ok: true, sessionId: 'session-1', state: 'paused' }
    })

    const module = await import('./service-worker')
    await module.__testing.routeControl('pause', 'session-1')

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      kind: PLAYBACK_CONTROL,
      action: 'pause',
      expectedSessionId: 'session-1',
    })
  })

  it('reports an interrupted active session when a recreated offscreen document is idle', async () => {
    const { chromeMock } = installChromeMock()
    const module = await import('./service-worker')
    await module.__testing.writeLastPlaybackStatus(status({
      sequence: 8,
      sessionId: 'session-lost',
      requestId: 'request-lost',
      currentChunk: 2,
      totalChunks: 4,
      totalParagraphs: 2,
    }))
    chromeMock.runtime.sendMessage.mockResolvedValue(idleStatus())

    const interrupted = await module.__testing.queryPlaybackStatus()

    expect(interrupted).toMatchObject({
      sequence: 9,
      state: 'failed',
      sessionId: 'session-lost',
      currentChunk: 2,
      error: { code: 'OFFSCREEN_INTERRUPTED' },
    })
    await expect(module.__testing.readLastPlaybackStatus()).resolves.toMatchObject({
      state: 'failed',
      error: { code: 'OFFSCREEN_INTERRUPTED' },
    })
  })

  it('serializes writes so an older playing state cannot overwrite completion', async () => {
    const { chromeMock, sessionValues } = installChromeMock()
    const resolvers: Array<() => void> = []
    chromeMock.storage.session.set.mockImplementation((updates: Record<string, unknown>) => new Promise<void>((resolve) => {
      resolvers.push(() => {
        Object.assign(sessionValues, updates)
        resolve()
      })
    }))

    const module = await import('./service-worker')
    const first = module.__testing.writeLastPlaybackStatus(status({ sequence: 10 }))
    const second = module.__testing.writeLastPlaybackStatus(status({
      sequence: 11,
      state: 'completed',
      currentChunk: 2,
      error: undefined,
    }))

    await vi.waitFor(() => expect(resolvers).toHaveLength(1))
    resolvers[0]()
    await vi.waitFor(() => expect(resolvers).toHaveLength(2))
    resolvers[1]()
    await Promise.all([first, second])

    await expect(module.__testing.readLastPlaybackStatus()).resolves.toMatchObject({
      sequence: 11,
      state: 'completed',
    })
  })

  it('rejects a late terminal status from an older session after a replacement starts', async () => {
    installChromeMock()
    const module = await import('./service-worker')
    const replacement = status({
      sequence: 1,
      state: 'starting',
      sessionId: 'session-new',
      requestId: 'request-new',
      currentChunk: 1,
      totalChunks: 1,
    })
    const stale = status({
      sequence: 99,
      state: 'completed',
      sessionId: 'session-old',
      requestId: 'request-old',
      currentChunk: 2,
      totalChunks: 2,
    })

    expect(module.__testing.shouldAcceptStatus(null, replacement)).toBe(true)
    expect(module.__testing.shouldAcceptStatus(replacement, stale)).toBe(false)
  })

  it('derives non-synthesizing API health endpoints including trailing slash inputs', async () => {
    installChromeMock()
    const module = await import('./service-worker')

    expect(module.deriveApiSiblingUrl('http://localhost:5002/api/tts', 'ping')).toBe('http://localhost:5002/api/ping')
    expect(module.deriveApiSiblingUrl('http://localhost:5002/api/tts/', 'voices')).toBe('http://localhost:5002/api/voices')
    expect(module.deriveApiSiblingUrl('https://example.com/local/api/tts?voice=x', 'ready')).toBe('https://example.com/local/api/ready')
    expect(module.deriveApiSiblingUrl('invalid', 'ping')).toBeNull()
  })
})
