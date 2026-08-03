import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/storage', () => ({
  getSettings: vi.fn(),
}))

import { getSettings } from '../lib/storage'
import { PLAYBACK_CONTROL, START_PLAYBACK } from '../lib/playback-protocol'

type ChromeMock = {
  tabs: { query: ReturnType<typeof vi.fn> }
  scripting: { executeScript: ReturnType<typeof vi.fn> }
  offscreen: { createDocument: ReturnType<typeof vi.fn>; hasDocument?: ReturnType<typeof vi.fn> }
  commands: { onCommand: { addListener: ReturnType<typeof vi.fn> } }
  runtime: {
    onMessage: { addListener: ReturnType<typeof vi.fn> }
    onInstalled: { addListener: ReturnType<typeof vi.fn> }
    sendMessage: ReturnType<typeof vi.fn>
    getURL: ReturnType<typeof vi.fn>
    getContexts: ReturnType<typeof vi.fn>
    lastError?: { message?: string }
  }
  contextMenus: {
    removeAll: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    onClicked: { addListener: ReturnType<typeof vi.fn> }
  }
}

function installChromeMock(): ChromeMock {
  const chromeMock: ChromeMock = {
    tabs: { query: vi.fn() },
    scripting: { executeScript: vi.fn() },
    offscreen: { createDocument: vi.fn().mockResolvedValue(undefined) },
    commands: { onCommand: { addListener: vi.fn() } },
    runtime: {
      onMessage: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
      sendMessage: vi.fn(),
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      getContexts: vi.fn().mockResolvedValue([]),
      lastError: undefined,
    },
    contextMenus: {
      removeAll: vi.fn((callback: () => void) => callback()),
      create: vi.fn(),
      onClicked: { addListener: vi.fn() },
    },
  }
  ;(globalThis as unknown as { chrome: ChromeMock }).chrome = chromeMock
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

  it('derives non-synthesizing API health endpoints', async () => {
    installChromeMock()
    const module = await import('./service-worker')

    expect(module.deriveApiSiblingUrl('http://localhost:5002/api/tts', 'ping')).toBe('http://localhost:5002/api/ping')
    expect(module.deriveApiSiblingUrl('https://example.com/local/api/tts?voice=x', 'ready')).toBe('https://example.com/local/api/ready')
    expect(module.deriveApiSiblingUrl('invalid', 'ping')).toBeNull()
  })
})
