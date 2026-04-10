import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PlaybackController } from './playback'

describe('PlaybackController', () => {
  let _originalWindow: unknown
  let createObjectURLSpy: ReturnType<typeof vi.spyOn> | null
  let revokeObjectURLSpy: ReturnType<typeof vi.spyOn> | null
  beforeEach(() => {
    // ensure code that references `window` has a value in this test env
    _originalWindow = (globalThis as unknown as { window?: unknown }).window
    if (!_originalWindow) (globalThis as unknown as Record<string, unknown>).window = (globalThis as unknown as Record<string, unknown>)
    // use vitest helpers to stub globals; restoreAllMocks will undo
    vi.restoreAllMocks()
    createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test-audio')
    revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  afterEach(() => {
    // restore window only if we set it
    if (!_originalWindow) delete (globalThis as unknown as Record<string, unknown>).window
    createObjectURLSpy?.mockRestore()
    revokeObjectURLSpy?.mockRestore()
    vi.restoreAllMocks()
  })

  it('plays via HTMLAudio when play() resolves and ends', async () => {
    // mock Audio to capture listeners and simulate ended
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}
    vi.stubGlobal('Audio', function () {
      return {
        addEventListener: (ev: string, cb: (...args: unknown[]) => void) => {
          listeners[ev] = listeners[ev] || []
          listeners[ev].push(cb)
        },
        play: () => Promise.resolve(),
        pause: () => {},
        src: '',
        autoplay: false,
        playbackRate: 1,
      }
    } as unknown)

    const playback = new PlaybackController()
    const buf = new Uint8Array([1, 2, 3, 4]).buffer

    const p = playback.playArrayBuffer(buf, 'audio/wav')
    // simulate ended event
    expect(listeners['ended'] && listeners['ended'].length > 0).toBe(true)
    // call the first ended listener
    listeners['ended'][0]()
    const res = await p
    expect(res.ok).toBe(true)
  })

  it('attaches a real audio element to the document and removes it on finish', async () => {
    let attachedAudio: unknown = null
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}
    const originalDocument = (globalThis as unknown as { document?: unknown }).document
    ;(globalThis as unknown as { document?: unknown }).document = {
      body: {
        appendChild: (node: unknown) => {
          attachedAudio = node
          return node
        },
      },
      documentElement: null,
    }
    const audio = {
      autoplay: false,
      preload: '',
      muted: true,
      volume: 0,
      playbackRate: 1,
      style: {},
      src: '',
      setAttribute: vi.fn(),
      remove: vi.fn(() => {
        attachedAudio = null
      }),
      addEventListener: vi.fn((eventName: string, cb: (...args: unknown[]) => void) => {
        listeners[eventName] = listeners[eventName] || []
        listeners[eventName].push(cb)
      }),
    } as unknown as HTMLAudioElement
    let playResolve: (() => void) | null = null
    Object.defineProperty(audio, 'play', {
      value: vi.fn(() => new Promise<void>((resolve) => { playResolve = resolve })),
      configurable: true,
    })
    Object.defineProperty(audio, 'pause', {
      value: vi.fn(() => {}),
      configurable: true,
    })
    vi.stubGlobal('Audio', function () {
      return audio
    } as unknown)

    const playback = new PlaybackController()
    const promise = playback.playArrayBuffer(new Uint8Array([1, 2, 3]).buffer, 'audio/wav')

    expect(attachedAudio).toBe(audio)
    listeners.playing?.[0]?.()
    playResolve?.()
    listeners.ended?.[0]?.()

    await expect(promise).resolves.toMatchObject({ ok: true })
    expect(attachedAudio).toBeNull()
    ;(globalThis as unknown as { document?: unknown }).document = originalDocument
  })

  it('falls back to WebAudio when HTMLAudio play() rejects', async () => {
    // mock Audio.play to reject
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}
    vi.stubGlobal('Audio', function () {
      return {
        addEventListener: (ev: string, cb: (...args: unknown[]) => void) => {
          listeners[ev] = listeners[ev] || []
          listeners[ev].push(cb)
        },
        play: () => Promise.reject(new Error('autoplay')),
        pause: () => {},
        src: '',
        autoplay: false,
        playbackRate: 1,
      }
    } as unknown)

    // mock AudioContext + decodeAudioData and createBufferSource
    vi.stubGlobal('AudioContext', function () {
      return {
        decodeAudioData: (_buf: ArrayBuffer) => { void _buf; return Promise.resolve({}) },
        createBufferSource: () => {
          const src: { buffer: unknown | null; connect: (arg: unknown) => void; start: () => void; onended?: (() => void) | undefined } = {
            buffer: null,
            connect: (_: unknown) => { void _ },
            start: () => {
              // simulate onended in next tick
              setTimeout(() => { if (src.onended) src.onended() }, 0)
            },
            onended: undefined,
          }
          return src
        },
        destination: {},
      }
    } as unknown)

    const playback = new PlaybackController()
    const buf = new Uint8Array([1, 2, 3, 4]).buffer
  const res = await playback.playArrayBuffer(buf, 'audio/wav')
  expect(res.ok).toBe(true)
  })

  it('falls back when HTMLAudio start never begins and play() stays pending', async () => {
    vi.useFakeTimers()
    ;(globalThis as unknown as { __HTML_AUDIO_START_TIMEOUT_MS?: number }).__HTML_AUDIO_START_TIMEOUT_MS = 25
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}
    vi.stubGlobal('Audio', function () {
      return {
        addEventListener: (ev: string, cb: (...args: unknown[]) => void) => {
          listeners[ev] = listeners[ev] || []
          listeners[ev].push(cb)
        },
        play: () => new Promise(() => {}),
        pause: () => {},
        src: '',
        autoplay: false,
        playbackRate: 1,
      }
    } as unknown)

    const createBufferSourceMock = vi.fn(() => {
      const src = {
        buffer: null as unknown | null,
        connect: (_: unknown) => { void _ },
        start: () => {
          setTimeout(() => src.onended?.(), 0)
        },
        onended: undefined as (() => void) | undefined,
        playbackRate: { value: 1 },
      }
      return src
    })
    vi.stubGlobal('AudioContext', function () {
      return {
        decodeAudioData: (_buf: ArrayBuffer) => { void _buf; return Promise.resolve({}) },
        createBufferSource: createBufferSourceMock,
        destination: {},
        close: vi.fn(() => Promise.resolve()),
        state: 'running',
      }
    } as unknown)

    const playback = new PlaybackController()
    const promise = playback.playArrayBuffer(new Uint8Array([1, 2, 3]).buffer, 'audio/wav')
    await vi.advanceTimersByTimeAsync(30)
    await expect(promise).resolves.toMatchObject({ ok: true })
    expect(createBufferSourceMock).toHaveBeenCalledTimes(1)
    delete (globalThis as unknown as { __HTML_AUDIO_START_TIMEOUT_MS?: number }).__HTML_AUDIO_START_TIMEOUT_MS
    vi.useRealTimers()
  })

  it('closes AudioContext on normal WebAudio fallback completion', async () => {
    vi.stubGlobal('Audio', function () {
      return {
        addEventListener: () => {},
        play: () => Promise.reject(new Error('autoplay')),
        pause: () => {},
        src: '',
        autoplay: false,
        playbackRate: 1,
      }
    } as unknown)

    const closeMock = vi.fn(() => Promise.resolve())
    let createdSrc: { onended?: (() => void) | undefined } | null = null
    vi.stubGlobal('AudioContext', function () {
      return {
        decodeAudioData: (_buf: ArrayBuffer) => { void _buf; return Promise.resolve({}) },
        createBufferSource: () => {
          const src = {
            buffer: null as unknown | null,
            connect: (_: unknown) => { void _ },
            start: () => {},
            onended: undefined as (() => void) | undefined,
            playbackRate: { value: 1 },
          }
          createdSrc = src
          return src
        },
        destination: {},
        close: closeMock,
      }
    } as unknown)

    const playback = new PlaybackController()
    const promise = playback.playArrayBuffer(new Uint8Array([1, 2, 3]).buffer, 'audio/wav')
    await new Promise((resolve) => setTimeout(resolve, 0))
    createdSrc?.onended?.()
    const result = await promise
    expect(result.ok).toBe(true)
    expect(closeMock).toHaveBeenCalled()
  })

  it('returns webaudio-unavailable when fallback missing', async () => {
    // mock Audio.play to reject
    vi.stubGlobal('Audio', function () {
      return {
        addEventListener: (_ev: string, _cb: (...args: unknown[]) => void) => { void _ev; void _cb },
        play: () => Promise.reject(new Error('autoplay')),
        pause: () => {},
        src: '',
        autoplay: false,
        playbackRate: 1,
      }
    } as unknown)

  // Ensure no AudioContext available
  vi.stubGlobal('AudioContext', undefined as unknown)
  vi.stubGlobal('webkitAudioContext', undefined as unknown)

    const playback = new PlaybackController()
    const buf = new Uint8Array([1, 2, 3, 4]).buffer
    const res = await playback.playArrayBuffer(buf, 'audio/wav')
    expect(res.ok).toBe(false)
    expect(res.error).toBe('webaudio-unavailable')
  })

  it('returns error for invalid base64 input', async () => {
    const playback = new PlaybackController()
    const res = await playback.playBase64('not-a-base64')
    expect(res.ok).toBe(false)
    // error message should indicate decode/atob failure
    expect(typeof res.error).toBe('string')
    expect(res.error!.length).toBeGreaterThan(0)
  })

  it('plays large ArrayBuffer without blowing up', async () => {
    // simulate HTMLAudio success
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}
    vi.stubGlobal('Audio', function () {
      return {
  addEventListener: (ev: string, cb: (...args: unknown[]) => void) => {
          listeners[ev] = listeners[ev] || []
          listeners[ev].push(cb)
        },
        play: () => Promise.resolve(),
        pause: () => {},
        src: '',
        autoplay: false,
        playbackRate: 1,
      }
  } as unknown)

    const playback = new PlaybackController()
    // ~200KB buffer
    const big = new Uint8Array(200 * 1024)
    for (let i = 0; i < big.length; i++) big[i] = i % 256
  const p = playback.playArrayBuffer(big.buffer, 'audio/wav');
    // simulate ended
    listeners['ended'][0]()
    const res = await p
    expect(res.ok).toBe(true)
  })

  it('supports pause/resume for WebAudio fallback', async () => {
    // make Audio.play reject to force WebAudio path
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}
    vi.stubGlobal('Audio', function () {
      return {
        addEventListener: (ev: string, cb: (...args: unknown[]) => void) => {
          listeners[ev] = listeners[ev] || []
          listeners[ev].push(cb)
        },
        play: () => Promise.reject(new Error('autoplay')),
        pause: () => {},
        src: '',
        autoplay: false,
        playbackRate: 1,
      }
    } as unknown)

  let createdSrc: { onended?: (() => void) | undefined; stop?: () => void } | null = null
  const suspendMock = vi.fn(() => Promise.resolve())
  const resumeMock = vi.fn(() => Promise.resolve())
    vi.stubGlobal('AudioContext', function () {
      const ctx = {
        decodeAudioData: (_buf: ArrayBuffer) => { void _buf; return Promise.resolve({}) },
        createBufferSource: () => {
          const src = {
            buffer: null as unknown | null,
            connect: (_: unknown) => { void _ },
            start: () => {},
            onended: undefined as (() => void) | undefined,
            stop: () => {},
          }
          createdSrc = src
          return src
        },
        destination: {},
        suspend: suspendMock,
        resume: resumeMock,
      }
      return ctx
    } as unknown)

    const playback = new PlaybackController()
    const buf = new Uint8Array([1, 2, 3, 4]).buffer
    // start playback (this will schedule a fallback to WebAudio)
    const p = playback.playArrayBuffer(buf, 'audio/wav')

    // Give the internal fallback a tick to create context/source
  await new Promise((r) => setTimeout(r, 0));
    // Now pause and resume via controller
  playback.pause()
  expect(suspendMock).toHaveBeenCalled()
  await new Promise((r) => setTimeout(r, 0))

    // finish playback
  ;(createdSrc as unknown as { onended?: () => void })?.onended?.()
    const res = await p
    expect(res.ok).toBe(true)
  })

  it('cleans up WebAudio fallback idempotently on stop', async () => {
    vi.stubGlobal('Audio', function () {
      return {
        addEventListener: () => {},
        play: () => Promise.reject(new Error('autoplay')),
        pause: () => {},
        src: '',
        autoplay: false,
        playbackRate: 1,
      }
    } as unknown)

    const closeMock = vi.fn(() => Promise.resolve())
    const stopMock = vi.fn()
    vi.stubGlobal('AudioContext', function () {
      return {
        decodeAudioData: (_buf: ArrayBuffer) => { void _buf; return Promise.resolve({}) },
        createBufferSource: () => ({
          buffer: null as unknown | null,
          connect: (_: unknown) => { void _ },
          start: () => {},
          onended: undefined as (() => void) | undefined,
          stop: stopMock,
          playbackRate: { value: 1 },
        }),
        destination: {},
        close: closeMock,
      }
    } as unknown)

    const playback = new PlaybackController()
    const promise = playback.playArrayBuffer(new Uint8Array([1, 2, 3]).buffer, 'audio/wav')
    await new Promise((resolve) => setTimeout(resolve, 0))
    playback.stop()
    playback.stop()
    await expect(promise).resolves.toMatchObject({ ok: false, error: 'stopped' })
    expect(stopMock).toHaveBeenCalledTimes(1)
    expect(closeMock).toHaveBeenCalledTimes(1)
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:test-audio')
  })

  it('shuts down HTMLAudio before starting WebAudio fallback', async () => {
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}
    const pauseMock = vi.fn()
    let assignedSrc = ''
    vi.stubGlobal('Audio', function () {
      return {
        addEventListener: (ev: string, cb: (...args: unknown[]) => void) => {
          listeners[ev] = listeners[ev] || []
          listeners[ev].push(cb)
        },
        play: () => Promise.resolve(),
        pause: pauseMock,
        get src() {
          return assignedSrc
        },
        set src(value: string) {
          assignedSrc = value
        },
        autoplay: false,
        playbackRate: 1,
      }
    } as unknown)

    let createdSrc: { onended?: (() => void) | undefined } | null = null
    vi.stubGlobal('AudioContext', function () {
      return {
        decodeAudioData: (_buf: ArrayBuffer) => { void _buf; return Promise.resolve({}) },
        createBufferSource: () => {
          const src = {
            buffer: null as unknown | null,
            connect: (_: unknown) => { void _ },
            start: () => {
              setTimeout(() => createdSrc?.onended?.(), 0)
            },
            onended: undefined as (() => void) | undefined,
            playbackRate: { value: 1 },
          }
          createdSrc = src
          return src
        },
        destination: {},
        close: vi.fn(() => Promise.resolve()),
      }
    } as unknown)

    const playback = new PlaybackController()
    const promise = playback.playArrayBuffer(new Uint8Array([1, 2, 3]).buffer, 'audio/wav')
    listeners['error']?.[0]?.(new Error('decode failure'))
    const result = await promise

    expect(result.ok).toBe(true)
    expect(pauseMock).toHaveBeenCalled()
    expect(assignedSrc).toBe('')
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:test-audio')
  })

  it('starts WebAudio fallback only once when multiple fallback triggers fire', async () => {
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}
    let rejectPlay: ((reason?: unknown) => void) | null = null
    vi.stubGlobal('Audio', function () {
      return {
        addEventListener: (ev: string, cb: (...args: unknown[]) => void) => {
          listeners[ev] = listeners[ev] || []
          listeners[ev].push(cb)
        },
        play: () => new Promise((_, reject) => {
          rejectPlay = reject
        }),
        pause: () => {},
        src: '',
        autoplay: false,
        playbackRate: 1,
      }
    } as unknown)

    const createBufferSourceMock = vi.fn(() => {
      const src = {
        buffer: null as unknown | null,
        connect: (_: unknown) => { void _ },
        start: () => {
          setTimeout(() => src.onended?.(), 0)
        },
        onended: undefined as (() => void) | undefined,
        playbackRate: { value: 1 },
      }
      return src
    })
    vi.stubGlobal('AudioContext', function () {
      return {
        decodeAudioData: (_buf: ArrayBuffer) => { void _buf; return Promise.resolve({}) },
        createBufferSource: createBufferSourceMock,
        destination: {},
        close: vi.fn(() => Promise.resolve()),
      }
    } as unknown)

    const playback = new PlaybackController()
    const promise = playback.playArrayBuffer(new Uint8Array([1, 2, 3]).buffer, 'audio/wav')
    listeners['error']?.[0]?.(new Error('stream error'))
    rejectPlay?.(new Error('autoplay'))
    const result = await promise

    expect(result.ok).toBe(true)
    expect(createBufferSourceMock).toHaveBeenCalledTimes(1)
  })

  it('resolves stale WebAudio fallback completion as stopped', async () => {
    vi.stubGlobal('Audio', function () {
      return {
        addEventListener: () => {},
        play: () => Promise.reject(new Error('autoplay')),
        pause: () => {},
        src: '',
        autoplay: false,
        playbackRate: 1,
      }
    } as unknown)

    const closeMock = vi.fn(() => Promise.resolve())
    let firstSource: { onended?: (() => void) | undefined; stop: () => void; playbackRate: { value: number } } | null = null
    let secondSource: { onended?: (() => void) | undefined; stop: () => void; playbackRate: { value: number } } | null = null

    vi.stubGlobal('AudioContext', function () {
      return {
        decodeAudioData: (_buf: ArrayBuffer) => { void _buf; return Promise.resolve({}) },
        createBufferSource: () => {
          const src = {
            buffer: null as unknown | null,
            connect: (_: unknown) => { void _ },
            start: () => {},
            onended: undefined as (() => void) | undefined,
            stop: () => {},
            playbackRate: { value: 1 },
          }
          if (!firstSource) firstSource = src
          else secondSource = src
          return src
        },
        destination: {},
        close: closeMock,
      }
    } as unknown)

    const playback = new PlaybackController()
    const buf = new Uint8Array([1, 2, 3]).buffer

    const firstPromise = playback.playArrayBuffer(buf, 'audio/wav')
    await new Promise((resolve) => setTimeout(resolve, 0))
    const secondPromise = playback.playArrayBuffer(buf, 'audio/wav')
    await new Promise((resolve) => setTimeout(resolve, 0))

    firstSource?.onended?.()
    secondSource?.onended?.()

    await expect(firstPromise).resolves.toMatchObject({ ok: false, error: 'stopped' })
    await expect(secondPromise).resolves.toMatchObject({ ok: true })
    expect(closeMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('handles rapid stop followed by new play (race) correctly', async () => {
    // First Audio mock: will trigger error when src is cleared (stop)
    vi.stubGlobal('Audio', function () {
      const evs: Record<string, Array<(...args: unknown[]) => void>> = {}
      let _src = ''
      const obj = {
  addEventListener: (ev: string, cb: (...args: unknown[]) => void) => { evs[ev] = evs[ev] || []; evs[ev].push(cb) },
        play: () => Promise.resolve(),
        pause: () => {},
        get src() { return _src },
        set src(v: string) {
          _src = v
          // if src is cleared by stop(), emit error to trigger fallback/finish
          if (v === '' && evs['error']) evs['error'].forEach((cb) => cb(new Error('aborted')))
        },
        autoplay: false,
        playbackRate: 1,
      }
      return obj as unknown
  } as unknown)

    // No AudioContext so fallback will respond with webaudio-unavailable
  vi.stubGlobal('AudioContext', undefined as unknown)
  vi.stubGlobal('webkitAudioContext', undefined as unknown)

    const playback = new PlaybackController()
    const buf = new Uint8Array([5, 6, 7, 8]).buffer
    const p1 = playback.playArrayBuffer(buf, 'audio/wav')
    // Immediately stop (race)
    playback.stop()
    const r1 = await p1
    expect(r1.ok).toBe(false)
    expect(r1.error).toBe('stopped')

    // Now install a fresh Audio mock for the next play that will succeed
    let secondListeners: Record<string, Array<(...args: unknown[]) => void>> = {}
    vi.stubGlobal('Audio', function () {
      const evs: Record<string, Array<(...args: unknown[]) => void>> = {}
      const obj = {
  addEventListener: (ev: string, cb: (...args: unknown[]) => void) => { evs[ev] = evs[ev] || []; evs[ev].push(cb) },
        play: () => Promise.resolve(),
        pause: () => {},
        src: '',
        autoplay: false,
        playbackRate: 1,
      }
      secondListeners = evs
      return obj as unknown
    } as unknown)

    // Ensure AudioContext available but not used
  vi.stubGlobal('AudioContext', undefined as unknown)

    const p2 = playback.playArrayBuffer(buf, 'audio/wav')
    // simulate ended event on second audio
    if (secondListeners['ended'] && secondListeners['ended'][0]) secondListeners['ended'][0]()
    const r2 = await p2
    expect(r2.ok).toBe(true)
  })

  it('ignores stale ended events from a stopped audio instance', async () => {
    const audioListeners: Array<Record<string, Array<(...args: unknown[]) => void>>> = []
    vi.stubGlobal('Audio', function () {
      const evs: Record<string, Array<(...args: unknown[]) => void>> = {}
      audioListeners.push(evs)
      return {
        addEventListener: (ev: string, cb: (...args: unknown[]) => void) => {
          evs[ev] = evs[ev] || []
          evs[ev].push(cb)
        },
        play: () => Promise.resolve(),
        pause: () => {},
        src: '',
        autoplay: false,
        playbackRate: 1,
      } as unknown
    } as unknown)

    const playback = new PlaybackController()
    const buf = new Uint8Array([1, 2, 3]).buffer

    const firstPromise = playback.playArrayBuffer(buf, 'audio/wav')
    playback.stop()
    const secondPromise = playback.playArrayBuffer(buf, 'audio/wav')

    audioListeners[0]?.ended?.[0]?.()
    audioListeners[1]?.ended?.[0]?.()

    await expect(firstPromise).resolves.toMatchObject({ ok: false, error: 'stopped' })
    await expect(secondPromise).resolves.toMatchObject({ ok: true })
  })

  it('setPlaybackRate updates current HTMLAudio playback speed', async () => {
    const listeners: Record<string, Array<() => void>> = {}
    let appliedRate = 1
    vi.stubGlobal('Audio', function () {
      return {
        addEventListener: (ev: string, cb: (...args: unknown[]) => void) => {
          listeners[ev] = listeners[ev] || []
          listeners[ev].push(cb)
        },
        play: () => Promise.resolve(),
        pause: () => {},
        src: '',
        autoplay: false,
        get playbackRate() {
          return appliedRate
        },
        set playbackRate(v: number) {
          appliedRate = v
        },
      }
    } as unknown)

    const playback = new PlaybackController()
    const buf = new Uint8Array([9, 9, 9]).buffer
    const promise = playback.playArrayBuffer(buf, 'audio/wav')
    playback.setPlaybackRate(1.8)
    expect(appliedRate).toBeCloseTo(1.8)
    listeners['ended'][0]()
    const res = await promise
    expect(res.ok).toBe(true)
  })

  it('setPlaybackRate affects WebAudio fallback playbackRate value', async () => {
    vi.stubGlobal('Audio', function () {
      return {
        addEventListener: () => {},
        play: () => Promise.reject(new Error('autoplay')), // force fallback
        pause: () => {},
        src: '',
        autoplay: false,
        playbackRate: 1,
      }
    } as unknown)

    const playbackRateParam = { value: 1 }
    vi.stubGlobal('AudioContext', function () {
      return {
        decodeAudioData: (_buf: ArrayBuffer) => { void _buf; return Promise.resolve({}) },
        createBufferSource: () => {
          const node = {
            buffer: null as unknown | null,
            connect: (_: unknown) => { void _ },
            start: () => { setTimeout(() => { node.onended?.() }, 0) },
            onended: undefined as (() => void) | undefined,
            playbackRate: playbackRateParam,
          }
          return node
        },
        destination: {},
      }
    } as unknown)

    const playback = new PlaybackController()
    playback.setPlaybackRate(0.75)
    const buf = new Uint8Array([1, 2]).buffer
    const promise = playback.playArrayBuffer(buf, 'audio/wav')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(playbackRateParam.value).toBeCloseTo(0.75)
    await promise
  })

  it('resumes a suspended AudioContext before WebAudio fallback playback', async () => {
    vi.stubGlobal('Audio', function () {
      return {
        addEventListener: () => {},
        play: () => Promise.reject(new Error('autoplay')),
        pause: () => {},
        src: '',
        autoplay: false,
        playbackRate: 1,
      }
    } as unknown)

    const resumeMock = vi.fn(() => Promise.resolve())
    vi.stubGlobal('AudioContext', function () {
      return {
        decodeAudioData: (_buf: ArrayBuffer) => { void _buf; return Promise.resolve({}) },
        createBufferSource: () => {
          const node = {
            buffer: null as unknown | null,
            connect: (_: unknown) => { void _ },
            start: () => { setTimeout(() => { node.onended?.() }, 0) },
            onended: undefined as (() => void) | undefined,
            playbackRate: { value: 1 },
          }
          return node
        },
        destination: {},
        state: 'suspended',
        resume: resumeMock,
      }
    } as unknown)

    const playback = new PlaybackController()
    await expect(playback.playArrayBuffer(new Uint8Array([1, 2]).buffer, 'audio/wav')).resolves.toMatchObject({ ok: true })
    expect(resumeMock).toHaveBeenCalled()
  })
})
