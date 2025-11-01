import { beforeEach, describe, it, expect, vi } from 'vitest'

vi.mock('./../lib/storage', () => ({ getSettings: vi.fn() }))

type ChromeMock = {
  tabs: { query: (...args: unknown[]) => Promise<unknown>, sendMessage: (...args: unknown[]) => unknown }
  scripting: { executeScript: (...args: unknown[]) => unknown }
  commands: { onCommand: { addListener: (...args: unknown[]) => unknown } }
  runtime: { onMessage: { addListener: (...args: unknown[]) => unknown }, onInstalled: { addListener: (...args: unknown[]) => unknown }, sendMessage: (...args: unknown[]) => unknown }
  contextMenus: { create: (...args: unknown[]) => unknown, onClicked: { addListener: (...args: unknown[]) => unknown } }
}

describe('background control forwarding', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    const chromeObj = {
      tabs: {
        query: vi.fn(),
        sendMessage: vi.fn(),
      },
      scripting: { executeScript: vi.fn() },
      commands: { onCommand: { addListener: vi.fn() } },
      runtime: { onMessage: { addListener: vi.fn() }, onInstalled: { addListener: vi.fn() }, sendMessage: vi.fn() },
      contextMenus: { create: vi.fn(), onClicked: { addListener: vi.fn() } },
    } as unknown as ChromeMock
    ;(globalThis as unknown as Record<string, unknown>).chrome = chromeObj
  })

  it('forwards pause/resume/cancel actions to the active tab', async () => {
    const chrome = (globalThis as unknown as Record<string, unknown>).chrome as unknown as ChromeMock
    ;(chrome.tabs.query as unknown as { mockResolvedValue?: (v: unknown) => void }).mockResolvedValue?.([{ id: 500, url: 'https://example.com' }])
    ;(chrome.tabs.sendMessage as unknown as { mockResolvedValue?: (v: unknown) => void }).mockResolvedValue?.(undefined)

    // Import module after mocks are ready so it registers listeners against our mock
    await import('./service-worker')

    // The background registers runtime.onMessage.addListener — grab the first registered callback
  const addListenerMock = (chrome.runtime.onMessage.addListener as unknown as { mock?: { calls?: unknown[][] } })
  const registered = (addListenerMock.mock?.calls?.[0]?.[0]) as unknown as ((msg: unknown, sender: unknown, sendResponse: (res?: unknown) => void) => void)
    const sendResp = vi.fn()

    // Pause
    registered({ action: 'pause-speech' }, null, sendResp)
    // allow the async forwarder to run
    await new Promise((r) => setTimeout(r, 0))
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(500, { kind: 'PAUSE_SPEECH' })
    expect(sendResp).toHaveBeenCalledWith({ ok: true })

    // Resume
    ;(chrome.tabs.sendMessage as unknown as { mockClear?: () => void }).mockClear?.()
    sendResp.mockClear()
    registered({ action: 'resume-speech' }, null, sendResp)
    await new Promise((r) => setTimeout(r, 0))
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(500, { kind: 'RESUME_SPEECH' })
    expect(sendResp).toHaveBeenCalledWith({ ok: true })

    // Cancel
    ;(chrome.tabs.sendMessage as unknown as { mockClear?: () => void }).mockClear?.()
    sendResp.mockClear()
    registered({ action: 'cancel-speech' }, null, sendResp)
    await new Promise((r) => setTimeout(r, 0))
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(500, { kind: 'STOP_SPEECH' })
    expect(sendResp).toHaveBeenCalledWith({ ok: true })
  })
})
