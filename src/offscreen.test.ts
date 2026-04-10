import { beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (...args: unknown[]) => unknown

type ChromeMock = {
  runtime: {
    onMessage: { addListener: ReturnType<typeof vi.fn> }
    sendMessage: ReturnType<typeof vi.fn>
    lastError?: { message?: string }
  }
}

type AudioMock = {
  src: string
  autoplay: boolean
  preload: string
  playbackRate: number
  onended: (() => void) | null
  onerror: (() => void) | null
  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
}

describe('offscreen playback', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()

    const globalState = globalThis as typeof globalThis & {
      __readitOffscreenPlaybackState?: unknown
      chrome?: ChromeMock
      Audio?: unknown
    }
    delete globalState.__readitOffscreenPlaybackState

    globalState.chrome = {
      runtime: {
        onMessage: { addListener: vi.fn() },
        sendMessage: vi.fn(),
        lastError: undefined,
      },
    }

    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:test-audio'),
      revokeObjectURL: vi.fn(),
    })
  })

  it('registers the offscreen message listener only once across repeated imports', async () => {
    await import('./offscreen')
    vi.resetModules()
    await import('./offscreen')

    const chromeObj = (globalThis as typeof globalThis & { chrome: ChromeMock }).chrome
    expect(chromeObj.runtime.onMessage.addListener).toHaveBeenCalledTimes(1)
  })

  it('ignores duplicate playback for the same token', async () => {
    const firstAudio = createAudioMock()
    const audioCtor = vi.fn(() => firstAudio)
    vi.stubGlobal('Audio', audioCtor)

    await import('./offscreen')
    const chromeObj = (globalThis as typeof globalThis & { chrome: ChromeMock }).chrome
    const listener = chromeObj.runtime.onMessage.addListener.mock.calls[0]?.[0] as Listener
    const sendResponse = vi.fn()

    listener({ action: 'OFFSCREEN_PLAY_AUDIO', audio: 'AQID', mime: 'audio/wav', playbackToken: '1:0' }, null, sendResponse)
    listener({ action: 'OFFSCREEN_PLAY_AUDIO', audio: 'AQID', mime: 'audio/wav', playbackToken: '1:0' }, null, sendResponse)

    expect(audioCtor).toHaveBeenCalledTimes(1)
    expect(sendResponse).toHaveBeenLastCalledWith({ ok: true, duplicate: true })
  })

  it('stops the previous audio before starting a new token', async () => {
    const firstAudio = createAudioMock()
    const secondAudio = createAudioMock()
    const audioCtor = vi.fn()
      .mockImplementationOnce(() => firstAudio)
      .mockImplementationOnce(() => secondAudio)
    vi.stubGlobal('Audio', audioCtor)

    await import('./offscreen')
    const chromeObj = (globalThis as typeof globalThis & { chrome: ChromeMock }).chrome
    const listener = chromeObj.runtime.onMessage.addListener.mock.calls[0]?.[0] as Listener

    listener({ action: 'OFFSCREEN_PLAY_AUDIO', audio: 'AQID', mime: 'audio/wav', playbackToken: '1:0' }, null, vi.fn())
    listener({ action: 'OFFSCREEN_PLAY_AUDIO', audio: 'BAUG', mime: 'audio/wav', playbackToken: '1:1' }, null, vi.fn())

    expect(firstAudio.pause).toHaveBeenCalledTimes(1)
    expect(secondAudio.play).toHaveBeenCalledTimes(1)
  })
})

function createAudioMock(): AudioMock {
  return {
    src: '',
    autoplay: false,
    preload: '',
    playbackRate: 1,
    onended: null,
    onerror: null,
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(() => {}),
  }
}
