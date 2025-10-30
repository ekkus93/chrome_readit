import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PlaybackController } from './playback'

describe('PlaybackController', () => {
  let _originalWindow: unknown
  beforeEach(() => {
    // ensure code that references `window` has a value in this test env
    _originalWindow = (globalThis as unknown as { window?: unknown }).window
    if (!_originalWindow) (globalThis as unknown as Record<string, unknown>).window = (globalThis as unknown as Record<string, unknown>)
    // use vitest helpers to stub globals; restoreAllMocks will undo
    vi.restoreAllMocks()
  })

  afterEach(() => {
    // restore window only if we set it
    if (!_originalWindow) delete (globalThis as unknown as Record<string, unknown>).window
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

  it('returns webaudio-unavailable when fallback missing', async () => {
    // mock Audio.play to reject
    vi.stubGlobal('Audio', function () {
      return {
        addEventListener: (_ev: string, _cb: (...args: unknown[]) => void) => { void _ev; void _cb },
        play: () => Promise.reject(new Error('autoplay')),
        pause: () => {},
        src: '',
        autoplay: false,
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
    expect(r1.error).toBe('webaudio-unavailable')

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
})
