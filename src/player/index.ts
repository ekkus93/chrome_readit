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
          a.play().catch((e) => console.warn('[readit] player play failed', e))
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
          const blob = new Blob([buf], { type: mime })
          const url = URL.createObjectURL(blob)
          const a = new Audio(url)
          a.autoplay = true
          a.play().catch((e) => console.warn('[readit] player play failed', e))
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
