import { beforeEach, describe, it, expect, vi } from 'vitest'

vi.mock('./../lib/storage', () => ({ getSettings: vi.fn() }))

type ChromeMock = {
  tabs: { query: (...args: unknown[]) => Promise<unknown> }
  scripting: { executeScript: (...args: unknown[]) => unknown }
  commands: { onCommand: { addListener: (...args: unknown[]) => unknown } }
  runtime: { onMessage: { addListener: (...args: unknown[]) => unknown }, onInstalled: { addListener: (...args: unknown[]) => unknown }, sendMessage: ReturnType<typeof vi.fn> }
  contextMenus: { create: (...args: unknown[]) => unknown, onClicked: { addListener: (...args: unknown[]) => unknown } }
}

describe('background control forwarding', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    const chromeObj = {
      tabs: {
        query: vi.fn(),
      },
      scripting: { executeScript: vi.fn() },
      commands: { onCommand: { addListener: vi.fn() } },
      runtime: { onMessage: { addListener: vi.fn() }, onInstalled: { addListener: vi.fn() }, sendMessage: vi.fn() },
      contextMenus: { create: vi.fn(), onClicked: { addListener: vi.fn() } },
    } as unknown as ChromeMock
    ;(globalThis as unknown as Record<string, unknown>).chrome = chromeObj
  })

  it('forwards pause/resume/cancel actions to the offscreen player', async () => {
    const chrome = (globalThis as unknown as Record<string, unknown>).chrome as unknown as ChromeMock

    await import('./service-worker')

    const addListenerMock = (chrome.runtime.onMessage.addListener as unknown as { mock?: { calls?: unknown[][] } })
    const registered = (addListenerMock.mock?.calls?.[0]?.[0]) as unknown as ((msg: unknown, sender: unknown, sendResponse: (res?: unknown) => void) => void)
    const sendResp = vi.fn()

    registered({ kind: 'PAUSE_SPEECH' }, null, sendResp)
    await new Promise((r) => setTimeout(r, 0))
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'OFFSCREEN_PAUSE_AUDIO' })
    expect(sendResp).toHaveBeenCalledWith({ ok: true })

    ;(chrome.runtime.sendMessage as unknown as { mockClear?: () => void }).mockClear?.()
    sendResp.mockClear()
    registered({ kind: 'RESUME_SPEECH' }, null, sendResp)
    await new Promise((r) => setTimeout(r, 0))
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'OFFSCREEN_RESUME_AUDIO' })
    expect(sendResp).toHaveBeenCalledWith({ ok: true })

    ;(chrome.runtime.sendMessage as unknown as { mockClear?: () => void }).mockClear?.()
    sendResp.mockClear()
    registered({ kind: 'CANCEL_SPEECH' }, null, sendResp)
    await new Promise((r) => setTimeout(r, 0))
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'OFFSCREEN_STOP_AUDIO' })
    expect(sendResp).toHaveBeenCalledWith({ ok: true })
  })
})
