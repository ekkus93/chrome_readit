// Minimal player page script. It announces readiness to the background
// and listens for a 'play-audio' message containing { audio, mime }.

console.debug('[readit] player loaded')

chrome.runtime.sendMessage({ action: 'player_ready' })

chrome.runtime.onMessage.addListener((msg: any) => {
  try {
    if (!msg || typeof msg !== 'object') return
    if (msg.action === 'play-audio') {
      const audio = msg.audio
      const mime = msg.mime || 'audio/wav'
      if (!audio) {
        console.warn('[readit] player: no audio provided')
        return
      }
      // If the incoming message contains a non-audio MIME (e.g. server
      // returned JSON for a play-only endpoint), avoid creating an Audio
      // element from it — that causes NotSupportedError. Try browser
      // speechSynthesis fallback when possible.
      if (!mime.startsWith('audio/')) {
        console.warn('[readit] player: received non-audio payload', mime)
        try {
          const voices = window.speechSynthesis.getVoices()
          if (voices && voices.length > 0 && typeof msg.text === 'string') {
            const u = new SpeechSynthesisUtterance(msg.text)
            window.speechSynthesis.cancel()
            window.speechSynthesis.speak(u)
            // close after a short delay to allow playback to start
            setTimeout(() => { try { window.close() } catch { /* ignore */ } }, 1000)
            return
          }
        } catch (e) {
          console.warn('[readit] player: fallback speechSynthesis failed', e)
        }
        return
      }
      // audio may be ArrayBuffer or base64 string
      if (typeof audio === 'string') {
        try {
          const bin = atob(audio)
          const len = bin.length
          const u8 = new Uint8Array(len)
          for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i)
          const blob = new Blob([u8], { type: mime })
          const url = URL.createObjectURL(blob)
          const a = new Audio(url)
          a.autoplay = true
          // Guard against empty buffers
          if (u8.length === 0) {
            console.warn('[readit] player: decoded audio buffer is empty', { mime })
            try { window.close() } catch {}
            return
          }
          a.play().catch((e) => {
            const hex = (() => { try { const v = u8.subarray(0,16); return Array.from(v).map(x=>x.toString(16).padStart(2,'0')).join(' ') } catch { return '<n/a>' } })()
            console.warn('[readit] player play failed', { mime, prefixHex: hex, error: e })
          })
          a.onended = () => {
            // close window after playback
            try {
              window.close()
            } catch {
              /* ignore */
            }
          }
          setTimeout(() => URL.revokeObjectURL(url), 60_000)
        } catch (err) {
          console.warn('[readit] player: failed to decode base64', err)
        }
      } else {
        try {
          const buf = audio as ArrayBuffer
          const u8 = new Uint8Array(buf)
          if (u8.length === 0) {
            console.warn('[readit] player: fetched audio buffer is empty', { mime })
            try { window.close() } catch {}
            return
          }
          const blob = new Blob([buf], { type: mime })
          const url = URL.createObjectURL(blob)
          const a = new Audio(url)
          a.autoplay = true
          a.play().catch((e) => {
            try {
              const u8 = new Uint8Array(buf)
              const hex = (() => { try { const v = u8.subarray(0,16); return Array.from(v).map(x=>x.toString(16).padStart(2,'0')).join(' ') } catch { return '<n/a>' } })()
              console.warn('[readit] player play failed', { mime, prefixHex: hex, error: e })
            } catch {
              console.warn('[readit] player play failed', { mime, error: e })
            }
          })
          a.onended = () => {
            try {
              window.close()
            } catch {
              /* ignore */
            }
          }
          setTimeout(() => URL.revokeObjectURL(url), 60_000)
        } catch (err) {
          console.warn('[readit] player: failed to play buffer', err)
        }
      }
    }
  } catch (err) {
    console.warn('[readit] player handler error', err)
  }
})
