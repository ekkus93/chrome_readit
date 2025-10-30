import { beforeEach, describe, it, expect, vi } from 'vitest'

vi.mock('./../lib/storage', () => ({ getSettings: vi.fn() }))

describe('background control forwarding', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    ;(globalThis as any).chrome = {
      tabs: {
        query: vi.fn(),
        sendMessage: vi.fn(),
      },
      scripting: { executeScript: vi.fn() },
      commands: { onCommand: { addListener: vi.fn() } },
      runtime: { onMessage: { addListener: vi.fn() }, onInstalled: { addListener: vi.fn() }, sendMessage: vi.fn() },
      contextMenus: { create: vi.fn(), onClicked: { addListener: vi.fn() } },
    }
  })

  it('forwards pause/resume/cancel actions to the active tab', async () => {
    const chrome = (globalThis as any).chrome
    chrome.tabs.query.mockResolvedValue([{ id: 500, url: 'https://example.com' }])
    chrome.tabs.sendMessage.mockResolvedValue(undefined)

    // Import module after mocks are ready so it registers listeners against our mock
  await import('./service-worker')

    // The background registers runtime.onMessage.addListener — grab the first registered callback
    const addListenerMock = (globalThis as any).chrome.runtime.onMessage.addListener as any
    const registered = addListenerMock.mock.calls[0][0]
    const sendResp = vi.fn()

    // Pause
    registered({ action: 'pause-speech' }, null, sendResp)
    // allow the async forwarder to run
    await new Promise((r) => setTimeout(r, 0))
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(500, { kind: 'PAUSE_SPEECH' })
    expect(sendResp).toHaveBeenCalledWith({ ok: true })

    // Resume
    chrome.tabs.sendMessage.mockClear()
    sendResp.mockClear()
    registered({ action: 'resume-speech' }, null, sendResp)
    await new Promise((r) => setTimeout(r, 0))
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(500, { kind: 'RESUME_SPEECH' })
    expect(sendResp).toHaveBeenCalledWith({ ok: true })

    // Cancel
    chrome.tabs.sendMessage.mockClear()
    sendResp.mockClear()
    registered({ action: 'cancel-speech' }, null, sendResp)
    await new Promise((r) => setTimeout(r, 0))
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(500, { kind: 'STOP_SPEECH' })
    expect(sendResp).toHaveBeenCalledWith({ ok: true })
  })
})
