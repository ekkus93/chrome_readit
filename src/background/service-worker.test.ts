import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/storage', () => ({
  getSettings: vi.fn(),
}))

import { getSettings } from '../lib/storage'
import { PLAYBACK_CONTROL, PLAYBACK_STATUS, START_PLAYBACK } from '../lib/playback-protocol'

function installChromeMock() {
  const sessionValues: Record<string, unknown> = {}
  const chromeMock = {
    tabs: { query: vi.fn() },
    scripting: { executeScript: vi.fn() },
    offscreen: { createDocument: vi.fn().mockResolvedValue(undefined), hasDocument: vi.fn() },
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
  return chromeMock
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
    const chromeMock = installChromeMock()
    chromeMock.tabs.query.mockResolvedValue([{ id: 42, url: 'https://example.com' }])
    chromeMock.scripting.executeScript.mockResolvedValue([{ result: ' Selected text. ' }])
    chromeMock.runtime.sendMessage.mockImplementation(async (message: Record<string, unknown>) => ({
      ok: true,
      accepted: true,
      requestId: message.requestId,
      sessionId: 'session-uuid',
    }))

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

  it('preserves the source for popup and Options test requests', async () => {
    const chromeMock = installChromeMock()
    chromeMock.runtime.sendMessage.mockImplementation(async (message: Record<string, unknown>) => ({
      ok: true,
      accepted: true,
      requestId: message.requestId,
      sessionId: 'session-uuid',
    }))

    const module = await import('./service-worker')
    await module.sendToActiveTabOrInject({ kind: 'READ_TEXT', text: 'Hello.', source: 'popup-test' })

    expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled()
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      kind: START_PLAYBACK,
      source: 'popup-test',
      text: 'Hello.',
    }))
  })

  it('returns a structured error for unsupported pages', async () => {
    const chromeMock = installChromeMock()
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
    const chromeMock = installChromeMock()
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

  it('forwards legacy controls through the shared protocol', async () => {
    const chromeMock = installChromeMock()
    chromeMock.runtime.sendMessage.mockResolvedValue({ ok: true, sessionId: 'session-1', state: 'paused' })

    const module = await import('./service-worker')
    await module.__testing.routeControl('pause')

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({ kind: PLAYBACK_CONTROL, action: 'pause' })
  })

  it('reports an interrupted active session when a recreated offscreen document is idle', async () => {
    const chromeMock = installChromeMock()
    const module = await import('./service-worker')
    await module.__testing.writeLastPlaybackStatus({
      kind: PLAYBACK_STATUS,
      state: 'playing',
      sessionId: 'session-lost',
      requestId: 'request-lost',
      source: 'selection',
      currentChunk: 2,
      totalChunks: 4,
      currentParagraph: 1,
      totalParagraphs: 2,
    })
    chromeMock.runtime.sendMessage.mockResolvedValue({
      kind: PLAYBACK_STATUS,
      state: 'idle',
      sessionId: null,
      requestId: null,
      source: null,
      currentChunk: 0,
      totalChunks: 0,
      currentParagraph: 0,
      totalParagraphs: 0,
    })

    const status = await module.__testing.queryPlaybackStatus()

    expect(status).toMatchObject({
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

  it('derives non-synthesizing API health endpoints', async () => {
    installChromeMock()
    const module = await import('./service-worker')

    expect(module.deriveApiSiblingUrl('http://localhost:5002/api/tts', 'ping')).toBe('http://localhost:5002/api/ping')
    expect(module.deriveApiSiblingUrl('https://example.com/local/api/tts?voice=x', 'ready')).toBe('https://example.com/local/api/ready')
    expect(module.deriveApiSiblingUrl('invalid', 'ping')).toBeNull()
  })
})
