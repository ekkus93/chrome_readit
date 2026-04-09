import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetBackgroundPlaybackState, resetBackgroundTestGlobals } from './test-helpers'

vi.mock('./../lib/storage', () => ({
  getSettings: vi.fn(),
}))

import { getSettings } from './../lib/storage'

describe('background.sendToActiveTabOrInject', () => {
  type FnMock = ReturnType<typeof vi.fn>

  type ChromeMock = {
    tabs: { query: FnMock; sendMessage: FnMock }
    scripting: { executeScript: FnMock }
    commands: { onCommand: { addListener: FnMock } }
    runtime: { onMessage: { addListener: FnMock }; onInstalled: { addListener: FnMock }; sendMessage: FnMock; getURL?: FnMock }
    contextMenus: { create: FnMock; onClicked: { addListener: FnMock } }
  }
  let mod: typeof import('./service-worker') | undefined

  function acknowledgePlayback(mod: typeof import('./service-worker'), token: unknown, result: { ok: boolean; error?: string } = { ok: true }) {
    queueMicrotask(() => {
      if (typeof token === 'string') mod.__testing.resolvePendingPlaybackAck(token, result)
    })
  }

  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    vi.mocked(getSettings).mockResolvedValue({ voice: 'V', rate: 1.0, ttsUrl: 'http://localhost/tts' })

    ;(globalThis as unknown as { chrome?: ChromeMock }).chrome = {
      tabs: {
        query: vi.fn(),
        sendMessage: vi.fn(),
      },
      scripting: {
        executeScript: vi.fn(),
      },
      commands: {
        onCommand: { addListener: vi.fn() },
      },
      runtime: {
        onMessage: { addListener: vi.fn() },
        onInstalled: { addListener: vi.fn() },
        sendMessage: vi.fn(),
        getURL: vi.fn(),
      },
      contextMenus: {
        create: vi.fn(),
        onClicked: { addListener: vi.fn() },
      },
    }
  })

  afterEach(() => {
    resetBackgroundPlaybackState(mod)
    resetBackgroundTestGlobals()
    mod = undefined
  })

  it('sends message to active tab when content script present', async () => {
    const g = globalThis as unknown as { chrome: ChromeMock }
    g.chrome.tabs.query.mockResolvedValue([{ id: 123, url: 'https://example.com' }])
    g.chrome.scripting.executeScript.mockResolvedValue([{ result: 'selected text' }])
    vi.mocked(getSettings).mockResolvedValue({ voice: 'V', rate: 1.0, ttsUrl: 'http://localhost/tts' })
    g.chrome.runtime.sendMessage.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: { get: () => 'audio/wav' }, arrayBuffer: async () => new ArrayBuffer(8) }))

    mod = await import('./service-worker')
    g.chrome.tabs.sendMessage.mockImplementation((_: unknown, payload: Record<string, unknown>) => {
      if (payload.kind === 'PLAY_AUDIO') {
        acknowledgePlayback(mod!, payload.playbackToken)
        return Promise.resolve({ ok: true })
      }
      return Promise.resolve(undefined)
    })

    await mod.sendToActiveTabOrInject({ kind: 'READ_SELECTION' })

    expect(g.chrome.tabs.sendMessage).toHaveBeenCalled()
    expect(g.chrome.scripting.executeScript).toHaveBeenCalled()
    expect(vi.mocked(getSettings)).toHaveBeenCalled()
    const sendCalls = g.chrome.tabs.sendMessage.mock.calls
    expect(sendCalls[0]?.[1]).toMatchObject({ rate: 1 })
  })

  it('reuses the same active tab for selection capture and playback', async () => {
    const g = globalThis as unknown as { chrome: ChromeMock }
    g.chrome.tabs.query.mockResolvedValueOnce([{ id: 123, url: 'https://first.example.com' }])
    g.chrome.tabs.query.mockResolvedValueOnce([{ id: 999, url: 'https://second.example.com' }])
    g.chrome.scripting.executeScript.mockResolvedValue([{ result: 'selected text' }])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: { get: () => 'audio/wav' }, arrayBuffer: async () => new ArrayBuffer(8) }))

    mod = await import('./service-worker')
    g.chrome.tabs.sendMessage.mockImplementation((_: unknown, payload: Record<string, unknown>) => {
      if (payload.kind === 'PLAY_AUDIO') {
        acknowledgePlayback(mod!, payload.playbackToken)
        return Promise.resolve({ ok: true })
      }
      return Promise.resolve(undefined)
    })

    await mod.sendToActiveTabOrInject({ kind: 'READ_SELECTION' })

    expect(g.chrome.tabs.query).toHaveBeenCalledTimes(1)
    expect(g.chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 123 },
      world: 'MAIN',
      func: expect.any(Function),
    })
    const sendCalls = g.chrome.tabs.sendMessage.mock.calls
    expect(sendCalls.every(([tabId]) => tabId === 123)).toBe(true)
  })

  it('bootstraps the content script and retries when sendMessage throws for READ_TEXT', async () => {
    const g = globalThis as unknown as { chrome: ChromeMock }
    g.chrome.tabs.query.mockResolvedValue([{ id: 55, url: 'https://example.com' }])
    g.chrome.tabs.sendMessage.mockRejectedValueOnce(new Error('no content script'))
    g.chrome.scripting.executeScript.mockResolvedValue(undefined)
    vi.mocked(getSettings).mockResolvedValue({ voice: 'V', rate: 1.5, ttsUrl: 'http://localhost/tts' })
    g.chrome.runtime.sendMessage.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: { get: () => 'audio/wav' }, arrayBuffer: async () => new ArrayBuffer(8) }))

    mod = await import('./service-worker')
    g.chrome.tabs.sendMessage.mockImplementation((_: unknown, payload: Record<string, unknown>) => {
      if (payload.kind === 'PLAY_AUDIO') {
        acknowledgePlayback(mod!, payload.playbackToken)
        return Promise.resolve({ ok: true })
      }
      return Promise.resolve(undefined)
    })

    await mod.sendToActiveTabOrInject({ kind: 'READ_TEXT', text: 'hello world' })

    expect(vi.mocked(getSettings)).toHaveBeenCalled()
    expect(g.chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 55 },
      files: ['src/content/content.ts'],
    })
    const sendCalls = g.chrome.tabs.sendMessage.mock.calls
    expect(sendCalls.length).toBe(2)
    expect(sendCalls[1]?.[1]).toMatchObject({ kind: 'PLAY_AUDIO', rate: 1.5 })
  })

  it('returns a structured error when there is no eligible tab', async () => {
    const g = globalThis as unknown as { chrome: ChromeMock }
    g.chrome.tabs.query.mockResolvedValue([])

    mod = await import('./service-worker')
    await expect(mod.sendToActiveTabOrInject({ kind: 'READ_SELECTION' })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('Playback not supported on this page'),
    })

    expect(g.chrome.tabs.sendMessage).not.toHaveBeenCalled()
    expect(g.chrome.scripting.executeScript).not.toHaveBeenCalled()
  })

  it('logs when playback bridge bootstrap fails after sendMessage rejection', async () => {
    const g = globalThis as unknown as { chrome: ChromeMock }
    g.chrome.tabs.query.mockResolvedValue([{ id: 99, url: 'https://example.com' }])
    g.chrome.tabs.sendMessage.mockRejectedValue(new Error('no content script'))
    vi.mocked(getSettings).mockResolvedValue({ voice: 'V', rate: 1.0, ttsUrl: 'http://localhost/tts' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: { get: () => 'audio/wav' }, arrayBuffer: async () => new ArrayBuffer(8) }))
    g.chrome.scripting.executeScript.mockRejectedValue(new Error('cannot inject'))

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    mod = await import('./service-worker')
    await mod.sendToActiveTabOrInject({ kind: 'READ_TEXT', text: 'hello' })

    expect(vi.mocked(getSettings)).toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('logs when getSettings rejects and does not throw', async () => {
    const g = globalThis as unknown as { chrome: ChromeMock }
    g.chrome.tabs.query.mockResolvedValue([{ id: 77, url: 'https://example.com' }])
    g.chrome.tabs.sendMessage.mockRejectedValue(new Error('no content script'))
    vi.mocked(getSettings).mockRejectedValue(new Error('storage error'))

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    mod = await import('./service-worker')
    await mod.sendToActiveTabOrInject({ kind: 'READ_TEXT', text: 'hi' })

    expect(vi.mocked(getSettings)).toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('recovers when a new playback acknowledgement replaces an older pending acknowledgement', async () => {
    mod = await import('./service-worker')

    const firstAck = mod.__testing.waitForPlaybackAck('session-1:0')
    const secondAck = mod.__testing.waitForPlaybackAck('session-2:0')

    await expect(firstAck).resolves.toMatchObject({ ok: false, error: 'superseded by session-2:0' })
    expect(mod.__testing.resolvePendingPlaybackAck('session-2:0', { ok: true })).toBe(true)
    await expect(secondAck).resolves.toMatchObject({ ok: true })
    mod.__testing.resetPlaybackAckState()
  })

  it('marks paragraph-separated chunks with explicit paragraph transition metadata', async () => {
    mod = await import('./service-worker')

    const chunks = mod.__testing.splitTextIntoChunks('First paragraph ends here.\n\nNext starts here.', 40)

    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toMatchObject({
      text: 'First paragraph ends here.',
      paragraphIndex: 0,
      chunkIndexInParagraph: 0,
      transitionAfter: 'paragraph',
    })
    expect(chunks[1]).toMatchObject({
      text: 'Next starts here.',
      paragraphIndex: 1,
      chunkIndexInParagraph: 0,
      transitionAfter: 'end',
    })
    expect(mod.__testing.getGapAfterTransition(chunks[0].transitionAfter)).toBe(700)
    expect(mod.__testing.getGapAfterTransition(chunks[1].transitionAfter)).toBe(0)
  })
})
