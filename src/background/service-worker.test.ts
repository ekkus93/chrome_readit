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
    runtime: { onMessage: { addListener: FnMock }; onInstalled: { addListener: FnMock } }
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
      },
      contextMenus: {
        create: vi.fn(),
        onClicked: { addListener: vi.fn() },
      },
    }
  })

  it('sends message to active tab when content script present', async () => {
    // Arrange
  ;(globalThis as unknown as { chrome: { tabs: { query: { mockResolvedValue: (v: unknown) => void }; sendMessage: { mockResolvedValue: (v: unknown) => void } } } }).chrome.tabs.query.mockResolvedValue([{ id: 123, url: 'https://example.com' }])
  ;(globalThis as unknown as { chrome: { tabs: { query: { mockResolvedValue: (v: unknown) => void }; sendMessage: { mockResolvedValue: (v: unknown) => void } } } }).chrome.tabs.sendMessage.mockResolvedValue(undefined)

    // Import module after mocks are set up
    const mod = await import('./service-worker')

    // Act
    await mod.sendToActiveTabOrInject({ kind: 'READ_SELECTION' })

    // Assert
  const g = globalThis as unknown as { chrome: ChromeMock }
  expect(g.chrome.tabs.sendMessage).toHaveBeenCalledWith(123, { kind: 'READ_SELECTION' })
  expect(g.chrome.scripting.executeScript).not.toHaveBeenCalled()
    // mocked getSettings is a vi mock
    const mockedGetSettings = vi.mocked(getSettings)
    expect(mockedGetSettings).not.toHaveBeenCalled()
  })

  it('falls back to executeScript when sendMessage throws and passes READ_TEXT', async () => {
  ;(globalThis as unknown as { chrome: { tabs: { query: { mockResolvedValue: (v: unknown) => void }; sendMessage: { mockRejectedValue: (e: unknown) => void } } } }).chrome.tabs.query.mockResolvedValue([{ id: 55, url: 'https://example.com' }])
  ;(globalThis as unknown as { chrome: { tabs: { query: { mockResolvedValue: (v: unknown) => void }; sendMessage: { mockRejectedValue: (e: unknown) => void } } } }).chrome.tabs.sendMessage.mockRejectedValue(new Error('no content script'))
  const mockedGetSettings2 = vi.mocked(getSettings)
  mockedGetSettings2.mockResolvedValue({ voice: 'V', rate: 1.5 })

    const mod = await import('./service-worker')

    await mod.sendToActiveTabOrInject({ kind: 'READ_TEXT', text: 'hello world' })

    expect(mockedGetSettings2).toHaveBeenCalled()
    const g2 = globalThis as unknown as { chrome: ChromeMock }
  expect(g2.chrome.scripting.executeScript).toHaveBeenCalled()
  })

  it('does nothing when there is no eligible tab', async () => {
    ;(globalThis as unknown as { chrome: { tabs: { query: { mockResolvedValue: (v: unknown) => void } } } }).chrome.tabs.query.mockResolvedValue([])
    const mod = await import('./service-worker')
    await mod.sendToActiveTabOrInject({ kind: 'READ_SELECTION' })
    const g3 = globalThis as unknown as { chrome: ChromeMock }
    expect(g3.chrome.tabs.sendMessage).not.toHaveBeenCalled()
    expect(g3.chrome.scripting.executeScript).not.toHaveBeenCalled()
  })

  it('logs when executeScript fails after sendMessage rejection', async () => {
    const g = globalThis as unknown as { chrome: { tabs: { query: { mockResolvedValue?: (v: unknown) => void }; sendMessage: { mockRejectedValue?: (e: unknown) => void } }; scripting: { executeScript: { mockRejectedValue?: (e: unknown) => void } } } }
    g.chrome = g.chrome || ({} as any)
    ;(globalThis as unknown as any).chrome.tabs.query.mockResolvedValue([{ id: 99, url: 'https://example.com' }])
    ;(globalThis as unknown as any).chrome.tabs.sendMessage.mockRejectedValue(new Error('no content script'))
    const mockedGetSettings = vi.mocked(getSettings)
    mockedGetSettings.mockResolvedValue({ voice: 'V', rate: 1.0 })

    // Make executeScript fail
    ;(globalThis as unknown as any).chrome.scripting.executeScript.mockRejectedValue(new Error('exec failed'))

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const mod = await import('./service-worker')
    await mod.sendToActiveTabOrInject({ kind: 'READ_SELECTION' })

    expect(mockedGetSettings).toHaveBeenCalled()
    expect((globalThis as unknown as any).chrome.scripting.executeScript).toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('logs when getSettings rejects and does not throw', async () => {
    ;(globalThis as unknown as any).chrome.tabs.query.mockResolvedValue([{ id: 77, url: 'https://example.com' }])
    ;(globalThis as unknown as any).chrome.tabs.sendMessage.mockRejectedValue(new Error('no content script'))
    const mockedGetSettings = vi.mocked(getSettings)
    mockedGetSettings.mockRejectedValue(new Error('storage error'))

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const mod = await import('./service-worker')
    await mod.sendToActiveTabOrInject({ kind: 'READ_TEXT', text: 'hi' })

    expect(mockedGetSettings).toHaveBeenCalled()
    // executeScript should not be called because getSettings failed
    expect((globalThis as unknown as any).chrome.scripting.executeScript).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
