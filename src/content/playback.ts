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
      const finish = (ok: boolean, info?: any) => {
        if (responded) return
        responded = true
        try {
          a.pause()
        } catch {}
        this.currentAudio = null
        try {
          URL.revokeObjectURL(url)
        } catch {}
        resolve({ ok, ...info })
      }

      const done = () => finish(true)
      a.addEventListener('ended', done)

  a.addEventListener('error', async (_err) => {
        // HTMLAudio failed; attempt WebAudio fallback
        try {
          try {
            URL.revokeObjectURL(url)
          } catch {}
          this.currentAudio = null
          const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext
          if (!AudioCtx) {
            finish(false, { error: 'webaudio-unavailable' })
            return
          }
          const ctx = new AudioCtx()
          const audioBuffer = await ctx.decodeAudioData(u8.buffer.slice(0))
          const src = ctx.createBufferSource()
          src.buffer = audioBuffer
          src.connect(ctx.destination)
          this.currentAudioContextSource = { ctx, src }
          src.onended = () => {
            try {
              this.currentAudioContextSource = null
            } catch {}
            finish(true)
          }
          src.start(0)
        } catch (fallbackErr) {
          finish(false, { error: String(fallbackErr) })
        }
      })

      a.src = url
      const p = a.play()
      if (p && (p as Promise<any>).catch) {
        ;(p as Promise<any>).catch(async (_err) => {
          // play() rejected (autoplay/codec); attempt WebAudio fallback
          try {
            try {
              URL.revokeObjectURL(url)
            } catch {}
            this.currentAudio = null
            const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext
            if (!AudioCtx) {
              finish(false, { error: 'webaudio-unavailable' })
              return
            }
            const ctx = new AudioCtx()
            const audioBuffer = await ctx.decodeAudioData(u8.buffer.slice(0))
            const src = ctx.createBufferSource()
            src.buffer = audioBuffer
            src.connect(ctx.destination)
            this.currentAudioContextSource = { ctx, src }
            src.onended = () => {
              try {
                this.currentAudioContextSource = null
              } catch {}
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
      } catch {}
    } else if (this.currentAudioContextSource) {
      try {
        this.currentAudioContextSource.ctx.suspend?.()
      } catch {}
    }
  }

  async resume(): Promise<void> {
    if (this.currentAudio) {
      try {
        await this.currentAudio.play()
      } catch {}
    } else if (this.currentAudioContextSource) {
      try {
        await this.currentAudioContextSource.ctx.resume()
      } catch {}
    }
  }

  stop(): void {
    if (this.currentAudio) {
      try {
        this.currentAudio.pause()
        this.currentAudio.src = ''
      } catch {}
      this.currentAudio = null
    }
    if (this.currentAudioContextSource) {
      try {
        this.currentAudioContextSource.src.stop?.()
      } catch {}
      try {
        this.currentAudioContextSource.ctx.close?.()
      } catch {}
      this.currentAudioContextSource = null
    }
  }
}
