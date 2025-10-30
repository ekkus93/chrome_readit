import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock storage.getSettings since the module imports it at top-level
vi.mock('./../lib/storage', () => ({ getSettings: vi.fn(async () => ({ rate: 1.0, ttsUrl: 'http://localhost:5002/api/tts/play', voice: 'v' })) }))

describe('commands.onCommand handlers', () => {
  beforeEach(() => {
    // Ensure module cache is cleared so each test re-imports the
    // service-worker and re-registers its command listeners.
    vi.resetModules()
    vi.resetAllMocks()

    // Provide a chrome mock and capture the commands listener when added
    let capturedCommandListener: ((cmd: string) => unknown) | null = null
    ;(globalThis as unknown as { chrome?: any }).chrome = {
      tabs: {
        query: vi.fn(),
        sendMessage: vi.fn(),
      },
      scripting: { executeScript: vi.fn() },
      commands: {
        onCommand: {
          addListener: vi.fn((fn: (cmd: string) => unknown) => { capturedCommandListener = fn }),
        },
      },
      runtime: { onMessage: { addListener: vi.fn() }, onInstalled: { addListener: vi.fn() }, sendMessage: vi.fn(), getURL: vi.fn() },
      contextMenus: { create: vi.fn(), onClicked: { addListener: vi.fn() } },
    }

    // Expose the captured listener to tests via a well-known global so the
    // test can import the module and then call the listener.
    ;(globalThis as any).__captureCommandListener = () => capturedCommandListener
  })

  it('sends PAUSE_SPEECH to the active tab when pause-speech command fires', async () => {
    const chromeMock = (globalThis as any).chrome
    chromeMock.tabs.query.mockResolvedValue([{ id: 10, url: 'https://example.com' }])

  // import after mocks are installed so module registers the listener
  await import('./service-worker')
    const listener = (globalThis as any).__captureCommandListener()
    expect(typeof listener).toBe('function')

    await (listener as (cmd: string) => Promise<void>)('pause-speech')

    expect(chromeMock.tabs.query).toHaveBeenCalled()
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(10, { kind: 'PAUSE_SPEECH' })
  })

  it('sends RESUME_SPEECH to the active tab when resume-speech command fires', async () => {
    const chromeMock = (globalThis as any).chrome
    chromeMock.tabs.query.mockResolvedValue([{ id: 11, url: 'https://example.com' }])

  await import('./service-worker')
    const listener = (globalThis as any).__captureCommandListener()
    expect(typeof listener).toBe('function')

    await (listener as (cmd: string) => Promise<void>)('resume-speech')

    expect(chromeMock.tabs.query).toHaveBeenCalled()
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(11, { kind: 'RESUME_SPEECH' })
  })

  it('sends STOP_SPEECH to the active tab and resets when cancel-speech command fires', async () => {
    const chromeMock = (globalThis as any).chrome
    chromeMock.tabs.query.mockResolvedValue([{ id: 12, url: 'https://example.com' }])

  await import('./service-worker')
    const listener = (globalThis as any).__captureCommandListener()
    expect(typeof listener).toBe('function')

    await (listener as (cmd: string) => Promise<void>)('cancel-speech')

    expect(chromeMock.tabs.query).toHaveBeenCalled()
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(12, { kind: 'STOP_SPEECH' })
  })

  it('does not throw when there is no eligible active tab', async () => {
    const chromeMock = (globalThis as any).chrome
    chromeMock.tabs.query.mockResolvedValue([])

  await import('./service-worker')
    const listener = (globalThis as any).__captureCommandListener()
    expect(typeof listener).toBe('function')

    await expect((listener as (cmd: string) => Promise<void>)('pause-speech')).resolves.not.toThrow()
    expect(chromeMock.tabs.sendMessage).not.toHaveBeenCalled()
  })
})
