import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PLAYBACK_STATUS } from './lib/playback-protocol'

type Listener = (...args: unknown[]) => unknown

type ChromeMock = {
  runtime: {
    onMessage: { addListener: ReturnType<typeof vi.fn> }
    sendMessage: ReturnType<typeof vi.fn>
    lastError?: { message?: string }
  }
}

let chromeMock: ChromeMock

describe('offscreen message routing', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()

    const globalState = globalThis as unknown as {
      __readitOffscreenRuntimeState?: unknown
      chrome?: ChromeMock
    }
    delete globalState.__readitOffscreenRuntimeState

    chromeMock = {
      runtime: {
        onMessage: { addListener: vi.fn() },
        sendMessage: vi.fn(),
        lastError: undefined,
      },
    }
    globalState.chrome = chromeMock

    vi.stubGlobal('Audio', vi.fn(() => ({
      src: '',
      preload: '',
      playbackRate: 1,
      onended: null,
      onerror: null,
      play: vi.fn(() => Promise.resolve()),
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      load: vi.fn(),
    })))
  })

  it('registers the runtime listener only once across repeated imports', async () => {
    await import('./offscreen')
    vi.resetModules()
    await import('./offscreen')

    expect(chromeMock.runtime.onMessage.addListener).toHaveBeenCalledTimes(1)
  })

  it('returns the coordinator status through the shared protocol', async () => {
    await import('./offscreen')
    const listener = chromeMock.runtime.onMessage.addListener.mock.calls[0]?.[0] as Listener
    const sendResponse = vi.fn()

    const claimed = listener({ kind: PLAYBACK_STATUS }, null, sendResponse)

    expect(claimed).toBe(true)
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      kind: PLAYBACK_STATUS,
      state: 'idle',
      sessionId: null,
    }))
  })

  it('does not claim unrelated runtime messages', async () => {
    await import('./offscreen')
    const listener = chromeMock.runtime.onMessage.addListener.mock.calls[0]?.[0] as Listener

    expect(listener({ kind: 'UNRELATED' }, null, vi.fn())).toBe(false)
  })
})
