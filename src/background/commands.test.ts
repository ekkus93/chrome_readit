import { beforeEach, describe, expect, it, vi } from 'vitest'

type ChromeMock = {
  tabs: { query: (...args: unknown[]) => Promise<unknown> }
  scripting: { executeScript: (...args: unknown[]) => unknown }
  commands: { onCommand: { addListener: (fn: (cmd: string) => unknown) => void } }
  runtime: { onMessage: { addListener: (...args: unknown[]) => unknown }, onInstalled: { addListener: (...args: unknown[]) => unknown }, sendMessage: ReturnType<typeof vi.fn>, getURL: (...args: unknown[]) => unknown }
  contextMenus: { create: (...args: unknown[]) => unknown, onClicked: { addListener: (...args: unknown[]) => unknown } }
}

vi.mock('./../lib/storage', () => ({ getSettings: vi.fn(async () => ({ rate: 1.0, ttsUrl: 'http://localhost:5002/api/tts', voice: 'v' })) }))

describe('commands.onCommand handlers', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()

    let capturedCommandListener: ((cmd: string) => unknown) | null = null
    const chromeObj = {
      tabs: {
        query: vi.fn(),
      },
      scripting: { executeScript: vi.fn() },
      commands: {
        onCommand: {
          addListener: vi.fn((fn: (cmd: string) => unknown) => { capturedCommandListener = fn }),
        },
      },
      runtime: { onMessage: { addListener: vi.fn() }, onInstalled: { addListener: vi.fn() }, sendMessage: vi.fn(), getURL: vi.fn() },
      contextMenus: { create: vi.fn(), onClicked: { addListener: vi.fn() } },
    } as unknown as ChromeMock

    ;(globalThis as unknown as Record<string, unknown>).chrome = chromeObj
    ;(globalThis as unknown as Record<string, unknown>).__captureCommandListener = (() => capturedCommandListener) as unknown as Record<string, unknown>['__captureCommandListener']
  })

  it('sends offscreen pause when pause-speech command fires', async () => {
    const chromeMock = (globalThis as unknown as Record<string, unknown>).chrome as unknown as ChromeMock

    await import('./service-worker')
    const listener = ((globalThis as unknown as Record<string, unknown>).__captureCommandListener as unknown as () => ((cmd: string) => unknown))()

    await (listener as (cmd: string) => Promise<void>)('pause-speech')

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({ action: 'OFFSCREEN_PAUSE_AUDIO' })
  })

  it('sends offscreen resume when resume-speech command fires', async () => {
    const chromeMock = (globalThis as unknown as Record<string, unknown>).chrome as unknown as ChromeMock

    await import('./service-worker')
    const listener = ((globalThis as unknown as Record<string, unknown>).__captureCommandListener as unknown as () => ((cmd: string) => unknown))()

    await (listener as (cmd: string) => Promise<void>)('resume-speech')

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({ action: 'OFFSCREEN_RESUME_AUDIO' })
  })

  it('sends offscreen stop when cancel-speech command fires', async () => {
    const chromeMock = (globalThis as unknown as Record<string, unknown>).chrome as unknown as ChromeMock

    await import('./service-worker')
    const listener = ((globalThis as unknown as Record<string, unknown>).__captureCommandListener as unknown as () => ((cmd: string) => unknown))()

    await (listener as (cmd: string) => Promise<void>)('cancel-speech')

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({ action: 'OFFSCREEN_STOP_AUDIO' })
  })

  it('does not throw when pause is invoked without an active session', async () => {
    await import('./service-worker')
    const listener = ((globalThis as unknown as Record<string, unknown>).__captureCommandListener as unknown as () => ((cmd: string) => unknown))()

    await expect((listener as (cmd: string) => Promise<void>)('pause-speech')).resolves.not.toThrow()
  })
})
