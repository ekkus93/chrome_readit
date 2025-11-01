import { decodeBase64ToUint8Array } from './player'

// PlaybackController encapsulates HTMLAudio + WebAudio fallback logic and
// exposes a small, Promise-based API suitable for unit testing.
export class PlaybackController {
  private currentAudio: HTMLAudioElement | null = null
  private currentAudioContextSource: { ctx: AudioContext; src: AudioBufferSourceNode } | null = null

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
  const blob = new Blob([u8.buffer as ArrayBuffer], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = new Audio()
    this.currentAudio = a

    return new Promise((resolve) => {
      let responded = false
  const finish = (ok: boolean, info?: Record<string, unknown>) => {
        if (responded) return
        responded = true
        try {
          a.pause()
  } catch (e) { void e }
        this.currentAudio = null
        try {
          URL.revokeObjectURL(url)
  } catch (e) { void e }
        resolve({ ok, ...info })
      }

      const done = () => finish(true)
      a.addEventListener('ended', done)

      a.addEventListener('error', async (err) => {
        void err
        // HTMLAudio failed; attempt WebAudio fallback
        try {
          try {
            URL.revokeObjectURL(url)
    } catch (e) { void e }
          this.currentAudio = null
          const win = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
          const AudioCtx = win.AudioContext || win.webkitAudioContext
          if (!AudioCtx) {
            finish(false, { error: 'webaudio-unavailable' })
            return
          }
          const ctx = new AudioCtx()
          const ab = u8.buffer.slice(0) as ArrayBuffer
          const audioBuffer = await ctx.decodeAudioData(ab)
          const src = ctx.createBufferSource()
          src.buffer = audioBuffer
          src.connect(ctx.destination)
          this.currentAudioContextSource = { ctx, src }
          src.onended = () => {
            try {
              this.currentAudioContextSource = null
            } catch (e) { void e }
            finish(true)
          }
          src.start(0)
        } catch (fallbackErr) {
          finish(false, { error: String(fallbackErr) })
        }
      })

      a.src = url
      const p = a.play()
      if (p && typeof (p as Promise<unknown>).catch === 'function') {
        ;(p as Promise<unknown>).catch(async (err) => {
          void err
          // play() rejected (autoplay/codec); attempt WebAudio fallback
          try {
            try {
              URL.revokeObjectURL(url)
            } catch (e) { void e }
            this.currentAudio = null
            const win = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
            const AudioCtx = win.AudioContext || win.webkitAudioContext
            if (!AudioCtx) {
              finish(false, { error: 'webaudio-unavailable' })
              return
            }
            const ctx = new AudioCtx()
            const ab = u8.buffer.slice(0) as ArrayBuffer
            const audioBuffer = await ctx.decodeAudioData(ab)
            const src = ctx.createBufferSource()
            src.buffer = audioBuffer
            src.connect(ctx.destination)
            this.currentAudioContextSource = { ctx, src }
            src.onended = () => {
              try {
                this.currentAudioContextSource = null
              } catch (e) { void e }
              finish(true)
            }
            src.start(0)
          } catch (fallbackErr) {
            finish(false, { error: String(fallbackErr) })
          }
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
    if (this.currentAudio) {
      try {
        this.currentAudio.pause()
        this.currentAudio.src = ''
  } catch (e) { void e }
      this.currentAudio = null
    }
    if (this.currentAudioContextSource) {
      try {
        this.currentAudioContextSource.src.stop?.()
  } catch (e) { void e }
      try {
        this.currentAudioContextSource.ctx.close?.()
  } catch (e) { void e }
      this.currentAudioContextSource = null
    }
  }
}
