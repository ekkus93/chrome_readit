import { decodeBase64ToUint8Array } from './player'

const MIN_RATE = 0.5
const MAX_RATE = 10.0
const DEBUG = Boolean(import.meta.env.DEV) && import.meta.env.MODE !== 'test'

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1
  return Math.min(MAX_RATE, Math.max(MIN_RATE, rate))
}

// PlaybackController encapsulates HTMLAudio + WebAudio fallback logic and
// exposes a small, Promise-based API suitable for unit testing.
export class PlaybackController {
  private currentAudio: HTMLAudioElement | null = null
  private currentAudioContextSource: { ctx: AudioContext; src: AudioBufferSourceNode } | null = null
  private currentObjectUrl: string | null = null
  private playbackRate = 1
  private activePlaybackToken = 0
  private activePlaybackResolver: ((result: { ok: boolean; error?: string }) => void) | null = null

  private debug(event: string, details: Record<string, unknown> = {}): void {
    if (!DEBUG) return
    console.debug('[readit][DBG] playback', { event, ...details })
  }

  private revokeCurrentObjectUrl(): void {
    if (!this.currentObjectUrl) return
    try {
      URL.revokeObjectURL(this.currentObjectUrl)
    } catch (e) {
      void e
    }
    this.currentObjectUrl = null
  }

  private clearCurrentAudio(): void {
    if (!this.currentAudio) return
    try {
      this.currentAudio.pause()
      this.currentAudio.src = ''
    } catch (e) {
      void e
    }
    this.currentAudio = null
    this.revokeCurrentObjectUrl()
  }

  private cleanupWebAudioSource(sourceRef: { ctx: AudioContext; src: AudioBufferSourceNode } | null, stopSource = false): void {
    if (!sourceRef) return
    if (this.currentAudioContextSource === sourceRef) {
      this.currentAudioContextSource = null
    }
    if (stopSource) {
      try {
        sourceRef.src.stop?.()
      } catch (e) {
        void e
      }
    }
    try {
      sourceRef.ctx.close?.()
    } catch (e) {
      void e
    }
  }

  private async playViaWebAudio(u8: Uint8Array, playbackToken: number): Promise<{ ok: boolean; error?: string }> {
    const win = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
    const AudioCtx = win.AudioContext || win.webkitAudioContext
    if (!AudioCtx) {
      return { ok: false, error: 'webaudio-unavailable' }
    }

    const ctx = new AudioCtx()
    let sourceRef: { ctx: AudioContext; src: AudioBufferSourceNode } | null = null
    try {
      const audioBuffer = await ctx.decodeAudioData(u8.buffer.slice(0) as ArrayBuffer)
      const src = ctx.createBufferSource()
      src.buffer = audioBuffer
      try {
        src.playbackRate.value = this.playbackRate
      } catch (e) {
        void e
      }
      src.connect(ctx.destination)
      sourceRef = { ctx, src }
      this.currentAudioContextSource = sourceRef
      this.debug('webaudio-start', { playbackToken, rate: this.playbackRate })

      return await new Promise((resolve) => {
        src.onended = () => {
          if (this.activePlaybackToken !== playbackToken) {
            this.debug('webaudio-stale-end', { playbackToken, activePlaybackToken: this.activePlaybackToken })
            this.cleanupWebAudioSource(sourceRef)
            resolve({ ok: false, error: 'stopped' })
            return
          }
          this.debug('webaudio-end', { playbackToken })
          this.cleanupWebAudioSource(sourceRef)
          resolve({ ok: true })
        }
        src.start(0)
      })
    } catch (err) {
      this.debug('webaudio-error', { playbackToken, error: String(err) })
      this.cleanupWebAudioSource(sourceRef ?? { ctx, src: { stop: () => {}, playbackRate: { value: this.playbackRate } } as AudioBufferSourceNode })
      return { ok: false, error: String(err) }
    }
  }

  setPlaybackRate(rate: number): void {
    const clamped = clampRate(rate)
    this.playbackRate = clamped
    if (this.currentAudio) {
      try { this.currentAudio.playbackRate = clamped } catch (e) { void e }
    }
    if (this.currentAudioContextSource) {
      try { this.currentAudioContextSource.src.playbackRate.value = clamped } catch (e) { void e }
    }
  }

  getPlaybackRate(): number {
    return this.playbackRate
  }

  async playBase64(b64: string, mime = 'audio/wav'): Promise<{ ok: boolean; error?: string }> {
    try {
      const u8 = decodeBase64ToUint8Array(b64)
      if (u8.length === 0) return { ok: false, error: 'empty audio' }
      return await this.playUint8Array(u8, mime)
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  async playArrayBuffer(buf: ArrayBuffer, mime = 'audio/wav'): Promise<{ ok: boolean; error?: string }> {
    const u8 = new Uint8Array(buf)
    if (u8.length === 0) return { ok: false, error: 'empty audio' }
    return await this.playUint8Array(u8, mime)
  }

  private async playUint8Array(u8: Uint8Array, mime: string): Promise<{ ok: boolean; error?: string }> {
    this.stop()

    const blob = new Blob([u8.buffer as ArrayBuffer], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = new Audio()
    a.playbackRate = this.playbackRate
    this.currentObjectUrl = url
    this.currentAudio = a
    const playbackToken = ++this.activePlaybackToken
    this.debug('htmlaudio-start', { playbackToken, mime, rate: this.playbackRate })

    return new Promise((resolve) => {
      this.activePlaybackResolver = resolve
      let responded = false
      let fallbackStarted = false
      const finish = (ok: boolean, info?: Record<string, unknown>) => {
        if (responded || this.activePlaybackToken !== playbackToken) return
        responded = true
        if (this.activePlaybackResolver === resolve) this.activePlaybackResolver = null
        this.debug('playback-finish', { playbackToken, ok, error: info?.error })
        this.clearCurrentAudio()
        resolve({ ok, ...info })
      }

      const tryWebAudioFallback = async () => {
        if (fallbackStarted || this.activePlaybackToken !== playbackToken) return
        fallbackStarted = true
        const hadHtmlAudio = Boolean(this.currentAudio)
        this.debug('fallback-start', {
          playbackToken,
          hadHtmlAudio,
          objectUrlActive: Boolean(this.currentObjectUrl),
        })
        this.clearCurrentAudio()
        const result = await this.playViaWebAudio(u8, playbackToken)
        this.debug('fallback-finish', { playbackToken, ok: result.ok, error: result.error })
        finish(result.ok, result.ok ? undefined : { error: result.error })
      }

      const done = () => {
        this.debug('htmlaudio-end', { playbackToken })
        finish(true)
      }
      a.addEventListener('ended', done)

      a.addEventListener('error', async (err) => {
        void err
        this.debug('htmlaudio-error', { playbackToken })
        await tryWebAudioFallback()
      })

      a.src = url
      const p = a.play()
      if (p && typeof (p as Promise<unknown>).catch === 'function') {
        ;(p as Promise<unknown>).catch(async (err) => {
          void err
          this.debug('htmlaudio-play-rejected', { playbackToken })
          await tryWebAudioFallback()
        })
      }
    })
  }

  pause(): void {
    if (this.currentAudio) {
      try {
        this.currentAudio.pause()
              } catch (e) { void e }
    } else if (this.currentAudioContextSource) {
      try {
        this.currentAudioContextSource.ctx.suspend?.()
  } catch (e) { void e }
    }
  }

  async resume(): Promise<void> {
    if (this.currentAudio) {
      try {
        await this.currentAudio.play()
  } catch (e) { void e }
    } else if (this.currentAudioContextSource) {
      try {
        await this.currentAudioContextSource.ctx.resume()
  } catch (e) { void e }
    }
  }

  stop(): void {
    const resolver = this.activePlaybackResolver
    this.activePlaybackResolver = null
    this.activePlaybackToken += 1
    this.debug('stop', { activePlaybackToken: this.activePlaybackToken })
    this.clearCurrentAudio()
    if (this.currentAudioContextSource) {
      this.cleanupWebAudioSource(this.currentAudioContextSource, true)
    }
    resolver?.({ ok: false, error: 'stopped' })
  }
}
