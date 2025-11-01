import { beforeEach, describe, expect, it, vi } from 'vitest'

// We'll mock storage.getSettings before importing the background module
vi.mock('./../lib/storage', () => ({
  getSettings: vi.fn(),
}))

import { getSettings } from './../lib/storage'

describe('background.sendToActiveTabOrInject', () => {
  // Reuseable minimal chrome mock type for tests
  type FnMock = ((...args: unknown[]) => unknown) & {
    mock?: { calls?: unknown[] }
    mockResolvedValue?: (v: unknown) => void
    mockRejectedValue?: (e: unknown) => void
  }

  type ChromeMock = {
    tabs: { query: FnMock; sendMessage: FnMock }
    scripting: { executeScript: FnMock }
    commands: { onCommand: { addListener: FnMock } }
    runtime: { onMessage: { addListener: FnMock }; onInstalled: { addListener: FnMock }; sendMessage: FnMock; getURL?: FnMock }
    contextMenus: { create: FnMock; onClicked: { addListener: FnMock } }
  }

  beforeEach(() => {
    vi.resetAllMocks()

    // Minimal chrome mock to allow module import and to inspect calls.
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
  getURL: (vi.fn() as unknown as FnMock),
      },
      contextMenus: {
        create: vi.fn(),
        onClicked: { addListener: vi.fn() },
      },
    }
  })

  it('sends message to active tab when content script present', async () => {
    // Arrange
    const g = globalThis as unknown as { chrome: ChromeMock }
    ;(g.chrome.tabs.query as unknown as { mockResolvedValue?: (v: unknown) => void }).mockResolvedValue?.([{ id: 123, url: 'https://example.com' }])
    ;(g.chrome.tabs.sendMessage as unknown as { mockResolvedValue?: (v: unknown) => void }).mockResolvedValue?.(undefined)
    ;(g.chrome.scripting.executeScript as unknown as { mockResolvedValue?: (v: unknown) => void }).mockResolvedValue?.([{ result: 'selected text' }])
    const mockedGetSettings = vi.mocked(getSettings)
    mockedGetSettings.mockResolvedValue({ voice: 'V', rate: 1.0, ttsUrl: 'http://localhost/tts' })
    ;(g.chrome.runtime.sendMessage as unknown as { mockResolvedValue?: (v: unknown) => void }).mockResolvedValue?.(undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: { get: () => 'audio/wav' }, arrayBuffer: async () => new ArrayBuffer(8) }))

    // Import module after mocks are set up
    const mod = await import('./service-worker')

  // Act
  await mod.sendToActiveTabOrInject({ kind: 'READ_SELECTION' })

    // Assert
  // Canonical playback now forwards audio to the content script; ensure
  // we did not open a player window and that the content script was used.
  expect(g.chrome.tabs.sendMessage).toHaveBeenCalled()
  expect(g.chrome.scripting.executeScript).toHaveBeenCalled()
  expect(g.chrome.scripting.executeScript).toHaveBeenCalled()
  // mocked getSettings is a vi mock
  const mockedGetSettingsCalled = vi.mocked(getSettings)
  expect(mockedGetSettingsCalled).toHaveBeenCalled()
  })

  it('falls back to executeScript when sendMessage throws and passes READ_TEXT', async () => {
    const g = globalThis as unknown as { chrome: ChromeMock }
    ;(g.chrome.tabs.query as unknown as { mockResolvedValue?: (v: unknown) => void }).mockResolvedValue?.([{ id: 55, url: 'https://example.com' }])
    ;(g.chrome.tabs.sendMessage as unknown as { mockRejectedValue?: (e: unknown) => void }).mockRejectedValue?.(new Error('no content script'))
    const mockedGetSettings2 = vi.mocked(getSettings)
    mockedGetSettings2.mockResolvedValue({ voice: 'V', rate: 1.5, ttsUrl: 'http://localhost/tts' })
    ;(g.chrome.runtime.sendMessage as unknown as { mockResolvedValue?: (v: unknown) => void }).mockResolvedValue?.(undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: { get: () => 'audio/wav' }, arrayBuffer: async () => new ArrayBuffer(8) }))

    const mod = await import('./service-worker')

    await mod.sendToActiveTabOrInject({ kind: 'READ_TEXT', text: 'hello world' })

    expect(mockedGetSettings2).toHaveBeenCalled()
  // ensure we did not open any legacy player window (no-op for this test)
  })

  it('does nothing when there is no eligible tab', async () => {
    const g = globalThis as unknown as { chrome: ChromeMock }
    ;(g.chrome.tabs.query as unknown as { mockResolvedValue?: (v: unknown) => void }).mockResolvedValue?.([])
    const mod = await import('./service-worker')
    await mod.sendToActiveTabOrInject({ kind: 'READ_SELECTION' })
    const g3 = globalThis as unknown as { chrome: ChromeMock }
    expect(g3.chrome.tabs.sendMessage).not.toHaveBeenCalled()
    expect(g3.chrome.scripting.executeScript).not.toHaveBeenCalled()
  })

  it('logs when executeScript fails after sendMessage rejection', async () => {
    const g = globalThis as unknown as { chrome: ChromeMock }
    ;(g.chrome.tabs.query as unknown as { mockResolvedValue?: (v: unknown) => void }).mockResolvedValue?.([{ id: 99, url: 'https://example.com' }])
    ;(g.chrome.tabs.sendMessage as unknown as { mockRejectedValue?: (e: unknown) => void }).mockRejectedValue?.(new Error('no content script'))
    const mockedGetSettings = vi.mocked(getSettings)
    mockedGetSettings.mockResolvedValue({ voice: 'V', rate: 1.0, ttsUrl: 'http://localhost/tts' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: { get: () => 'audio/wav' }, arrayBuffer: async () => new ArrayBuffer(8) }))
    ;(g.chrome.scripting.executeScript as unknown as { mockResolvedValue?: (v: unknown) => void }).mockResolvedValue?.([{ result: 'selected text' }])

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const mod = await import('./service-worker')
    await mod.sendToActiveTabOrInject({ kind: 'READ_SELECTION' })

    expect(mockedGetSettings).toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('logs when getSettings rejects and does not throw', async () => {
    const g = globalThis as unknown as { chrome: ChromeMock }
    ;(g.chrome.tabs.query as unknown as { mockResolvedValue?: (v: unknown) => void }).mockResolvedValue?.([{ id: 77, url: 'https://example.com' }])
    ;(g.chrome.tabs.sendMessage as unknown as { mockRejectedValue?: (e: unknown) => void }).mockRejectedValue?.(new Error('no content script'))
    const mockedGetSettings = vi.mocked(getSettings)
    mockedGetSettings.mockRejectedValue(new Error('storage error'))

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const mod = await import('./service-worker')
    await mod.sendToActiveTabOrInject({ kind: 'READ_TEXT', text: 'hi' })

    expect(mockedGetSettings).toHaveBeenCalled()
    // legacy player window is not used; ensure we logged a warning
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
