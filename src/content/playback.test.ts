import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PlaybackController } from './playback'

describe('PlaybackController', () => {
  let _originalWindow: any
  beforeEach(() => {
    // ensure code that references `window` has a value in this test env
    _originalWindow = (global as any).window
    if (!_originalWindow) (global as any).window = (global as any)
    // use vitest helpers to stub globals; restoreAllMocks will undo
    vi.restoreAllMocks()
  })

  afterEach(() => {
    // restore window only if we set it
    if (!_originalWindow) delete (global as any).window
    vi.restoreAllMocks()
  })

  it('plays via HTMLAudio when play() resolves and ends', async () => {
    // mock Audio to capture listeners and simulate ended
    const listeners: any = {}
    vi.stubGlobal('Audio', function () {
      return {
        addEventListener: (ev: string, cb: Function) => {
          listeners[ev] = listeners[ev] || []
          listeners[ev].push(cb)
        },
        play: () => Promise.resolve(),
        pause: () => {},
        src: '',
        autoplay: false,
      }
    } as any)

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
    const listeners: any = {}
    vi.stubGlobal('Audio', function () {
      return {
        addEventListener: (ev: string, cb: Function) => {
          listeners[ev] = listeners[ev] || []
          listeners[ev].push(cb)
        },
        play: () => Promise.reject(new Error('autoplay')),
        pause: () => {},
        src: '',
        autoplay: false,
      }
    } as any)

    // mock AudioContext + decodeAudioData and createBufferSource
    vi.stubGlobal('AudioContext', function () {
      return {
        decodeAudioData: (_buf: ArrayBuffer) => Promise.resolve({}),
        createBufferSource: () => {
          const src: any = {
            buffer: null,
            connect: (_: any) => {},
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
    } as any)

    const playback = new PlaybackController()
    const buf = new Uint8Array([1, 2, 3, 4]).buffer
  const res = await playback.playArrayBuffer(buf, 'audio/wav')
  expect(res.ok).toBe(true)
  })

  it('returns webaudio-unavailable when fallback missing', async () => {
    // mock Audio.play to reject
    vi.stubGlobal('Audio', function () {
      return {
        addEventListener: (_ev: string, _cb: Function) => {},
        play: () => Promise.reject(new Error('autoplay')),
        pause: () => {},
        src: '',
        autoplay: false,
      }
    } as any)

    // Ensure no AudioContext available
    vi.stubGlobal('AudioContext', undefined as any)
    vi.stubGlobal('webkitAudioContext', undefined as any)

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
    const listeners: any = {}
    vi.stubGlobal('Audio', function () {
      return {
        addEventListener: (ev: string, cb: Function) => {
          listeners[ev] = listeners[ev] || []
          listeners[ev].push(cb)
        },
        play: () => Promise.resolve(),
        pause: () => {},
        src: '',
        autoplay: false,
      }
    } as any)

    const playback = new PlaybackController()
    // ~200KB buffer
    const big = new Uint8Array(200 * 1024)
    for (let i = 0; i < big.length; i++) big[i] = i % 256
    const p = playback.playArrayBuffer(big.buffer, 'audio/wav')
    // simulate ended
    listeners['ended'][0]()
    const res = await p
    expect(res.ok).toBe(true)
  })

  it('supports pause/resume for WebAudio fallback', async () => {
    // make Audio.play reject to force WebAudio path
    const listeners: any = {}
    vi.stubGlobal('Audio', function () {
      return {
        addEventListener: (ev: string, cb: Function) => {
          listeners[ev] = listeners[ev] || []
          listeners[ev].push(cb)
        },
        play: () => Promise.reject(new Error('autoplay')),
        pause: () => {},
        src: '',
        autoplay: false,
      }
    } as any)

    let createdCtx: any = null
    let createdSrc: any = null
    vi.stubGlobal('AudioContext', function () {
      const ctx: any = {
        decodeAudioData: (_buf: ArrayBuffer) => Promise.resolve({}),
        createBufferSource: () => {
          const src: any = {
            buffer: null,
            connect: (_: any) => {},
            start: () => {},
            onended: undefined,
            stop: () => {},
          }
          createdSrc = src
          return src
        },
        destination: {},
        suspend: vi.fn(() => Promise.resolve()),
        resume: vi.fn(() => Promise.resolve()),
      }
      createdCtx = ctx
      return ctx
    } as any)

    const playback = new PlaybackController()
    const buf = new Uint8Array([1, 2, 3, 4]).buffer
    // start playback (this will schedule a fallback to WebAudio)
    const p = playback.playArrayBuffer(buf, 'audio/wav')

    // Give the internal fallback a tick to create context/source
    await new Promise((r) => setTimeout(r, 0))
    // Now pause and resume via controller
    playback.pause()
    expect(createdCtx.suspend).toHaveBeenCalled()
    await playback.resume()
    expect(createdCtx.resume).toHaveBeenCalled()

    // finish playback
    if (createdSrc && typeof createdSrc.onended === 'function') createdSrc.onended()
    const res = await p
    expect(res.ok).toBe(true)
  })

  it('handles rapid stop followed by new play (race) correctly', async () => {
    // First Audio mock: will trigger error when src is cleared (stop)
    vi.stubGlobal('Audio', function () {
      const evs: Record<string, Function[]> = {}
      let _src = ''
      const obj: any = {
        addEventListener: (ev: string, cb: Function) => { evs[ev] = evs[ev] || []; evs[ev].push(cb) },
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
      return obj
    } as any)

    // No AudioContext so fallback will respond with webaudio-unavailable
    vi.stubGlobal('AudioContext', undefined as any)
    vi.stubGlobal('webkitAudioContext', undefined as any)

    const playback = new PlaybackController()
    const buf = new Uint8Array([5, 6, 7, 8]).buffer
    const p1 = playback.playArrayBuffer(buf, 'audio/wav')
    // Immediately stop (race)
    playback.stop()
    const r1 = await p1
    expect(r1.ok).toBe(false)
    expect(r1.error).toBe('webaudio-unavailable')

    // Now install a fresh Audio mock for the next play that will succeed
    let secondListeners: any = {}
    vi.stubGlobal('Audio', function () {
      const evs: Record<string, Function[]> = {}
      const obj: any = {
        addEventListener: (ev: string, cb: Function) => { evs[ev] = evs[ev] || []; evs[ev].push(cb) },
        play: () => Promise.resolve(),
        pause: () => {},
        src: '',
        autoplay: false,
      }
      secondListeners = evs
      return obj
    } as any)

    // Ensure AudioContext available but not used
    vi.stubGlobal('AudioContext', undefined as any)

    const p2 = playback.playArrayBuffer(buf, 'audio/wav')
    // simulate ended event on second audio
    if (secondListeners['ended'] && secondListeners['ended'][0]) secondListeners['ended'][0]()
    const r2 = await p2
    expect(r2.ok).toBe(true)
  })
})
