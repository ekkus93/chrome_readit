import { beforeEach, describe, expect, it, vi } from 'vitest'

// We'll mock storage.getSettings before importing the background module
vi.mock('./../lib/storage', () => ({
  getSettings: vi.fn(),
}))

import { getSettings } from './../lib/storage'

describe('background.sendToActiveTabOrInject', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    // Minimal chrome mock to allow module import and to inspect calls.
    ;(globalThis as any).chrome = {
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
    ;(globalThis as any).chrome.tabs.query.mockResolvedValue([{ id: 123, url: 'https://example.com' }])
    ;(globalThis as any).chrome.tabs.sendMessage.mockResolvedValue(undefined)

    // Import module after mocks are set up
    const mod = await import('./service-worker')

    // Act
    await mod.sendToActiveTabOrInject({ kind: 'READ_SELECTION' })

    // Assert
    expect(globalThis.chrome.tabs.sendMessage).toHaveBeenCalledWith(123, { kind: 'READ_SELECTION' })
    expect(globalThis.chrome.scripting.executeScript).not.toHaveBeenCalled()
    expect((getSettings as any)).not.toHaveBeenCalled()
  })

  it('falls back to executeScript when sendMessage throws and passes READ_TEXT', async () => {
    ;(globalThis as any).chrome.tabs.query.mockResolvedValue([{ id: 55, url: 'https://example.com' }])
    ;(globalThis as any).chrome.tabs.sendMessage.mockRejectedValue(new Error('no content script'))
    ;(getSettings as any).mockResolvedValue({ voice: 'V', rate: 1.5 })

    const mod = await import('./service-worker')

    await mod.sendToActiveTabOrInject({ kind: 'READ_TEXT', text: 'hello world' })

    expect(getSettings).toHaveBeenCalled()
    expect(globalThis.chrome.scripting.executeScript).toHaveBeenCalled()
    const callArg = (globalThis as any).chrome.scripting.executeScript.mock.calls[0][0]
    expect(callArg.args).toEqual(['V', 1.5, 'hello world'])
  })

  it('does nothing when there is no eligible tab', async () => {
    ;(globalThis as any).chrome.tabs.query.mockResolvedValue([])
    const mod = await import('./service-worker')
    await mod.sendToActiveTabOrInject({ kind: 'READ_SELECTION' })
    expect(globalThis.chrome.tabs.sendMessage).not.toHaveBeenCalled()
    expect(globalThis.chrome.scripting.executeScript).not.toHaveBeenCalled()
  })
})
