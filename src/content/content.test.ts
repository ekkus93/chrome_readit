import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./playback', () => ({
  PlaybackController: vi.fn().mockImplementation(() => ({
    setPlaybackRate: vi.fn(),
    playBase64: vi.fn().mockResolvedValue({ ok: true }),
    playArrayBuffer: vi.fn().mockResolvedValue({ ok: true }),
    pause: vi.fn(),
    resume: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  })),
}))

type Listener = (...args: unknown[]) => unknown

type ChromeMock = {
  runtime: {
    onMessage: { addListener: ReturnType<typeof vi.fn> }
    sendMessage: ReturnType<typeof vi.fn>
  }
  storage: {
    sync: { get: ReturnType<typeof vi.fn> }
    onChanged: { addListener: ReturnType<typeof vi.fn> }
  }
}

describe('content bootstrap guard', () => {
  beforeEach(() => {
    vi.resetModules()

    const globalState = globalThis as typeof globalThis & {
      __readitContentBridgeState?: unknown
      chrome?: ChromeMock
    }
    delete globalState.__readitContentBridgeState

    globalState.chrome = {
      runtime: {
        onMessage: { addListener: vi.fn() },
        sendMessage: vi.fn(),
      },
      storage: {
        sync: { get: vi.fn().mockResolvedValue({ settings: { rate: 1 } }) },
        onChanged: { addListener: vi.fn() },
      },
    }
  })

  it('registers runtime listeners only once across repeated imports', async () => {
    await import('./content')
    vi.resetModules()
    await import('./content')

    const chromeObj = (globalThis as typeof globalThis & { chrome: ChromeMock }).chrome
    expect(chromeObj.runtime.onMessage.addListener).toHaveBeenCalledTimes(1)
    expect(chromeObj.storage.onChanged.addListener).toHaveBeenCalledTimes(1)
  })

  it('ignores legacy READ_TEXT messages in the content script', async () => {
    await import('./content')

    const chromeObj = (globalThis as typeof globalThis & { chrome: ChromeMock }).chrome
    const listener = chromeObj.runtime.onMessage.addListener.mock.calls[0]?.[0] as Listener
    const sendResponse = vi.fn()

    const handled = listener({ kind: 'READ_TEXT', text: 'hello there' }, {}, sendResponse)

    expect(handled).toBe(false)
    expect(chromeObj.runtime.sendMessage).not.toHaveBeenCalled()
    expect(sendResponse).not.toHaveBeenCalled()
  })
})
