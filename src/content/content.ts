import { isReadSelection, isReadText, isPlayAudio } from '../lib/messaging'

// Ask the background/service worker to obtain TTS audio (avoids CORS)
// and return the audio bytes which we then play in-page.
async function speak(text: string) {
  try {
    chrome.runtime.sendMessage({ action: 'request-tts', text }, (resp) => {
      try {
        if (!resp) {
          console.warn('[readit] speak: no response from background')
          return
        }
        if (!resp.ok) {
          console.warn('[readit] speak: background tts failed', resp.error)
          return
        }
        const audio = resp.audio
        const mime = resp.mime || 'audio/wav'
        if (!audio) {
          console.warn('[readit] speak: no audio in response')
          return
        }
        // audio may be an ArrayBuffer (structured clone) or a base64 string
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
            const p = a.play()
            if (p && p.catch) p.catch((e) => console.warn('[readit] audio play failed', e))
            setTimeout(() => URL.revokeObjectURL(url), 60_000)
          } catch (err) {
            console.warn('[readit] speak: failed to decode base64 audio', err)
          }
        } else {
          try {
            const buf = audio as ArrayBuffer
            const blob = new Blob([buf], { type: mime })
            const url = URL.createObjectURL(blob)
            const a = new Audio(url)
            a.autoplay = true
            const p = a.play()
            if (p && p.catch) p.catch((e) => console.warn('[readit] audio play failed', e))
            setTimeout(() => URL.revokeObjectURL(url), 60_000)
          } catch (err) {
            console.warn('[readit] speak: failed to play audio buffer', err)
          }
        }
      } catch (err) {
        console.warn('[readit] speak handler error', err)
      }
    })
  } catch (err) {
    console.warn('[readit] speak: failed to request tts from background', err)
  }
}

chrome.runtime.onMessage.addListener((msg: unknown, sender) => {
  try {
    // Debug logging to help diagnose silent failures when the user triggers
    // the read-selection command or uses the popup. Check this log in the
    // page console (or the content script console) to verify message arrival.
    console.debug('[readit] content script received message', msg, 'from', sender)

    if (isReadSelection(msg)) {
      const sel = window.getSelection()?.toString().trim()
      console.debug('[readit] selection text:', sel)
      if (sel) speak(sel)
    } else if (isReadText(msg)) {
      const t = msg.text?.trim()
      if (t) speak(t)
    } else if (isPlayAudio(msg)) {
      try {
        const mime = msg.mime ?? 'audio/wav'
        if (typeof msg.audio === 'string') {
          // base64 path
          try {
            const bin = atob(msg.audio)
            const len = bin.length
            const u8 = new Uint8Array(len)
            for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i)
            const blob = new Blob([u8], { type: mime })
            const url = URL.createObjectURL(blob)
            const a = new Audio(url)
            a.autoplay = true
            const p = a.play()
            if (p && p.catch) p.catch((e) => console.warn('[readit] audio play failed', e))
            setTimeout(() => URL.revokeObjectURL(url), 60_000)
          } catch (err) {
            console.warn('[readit] PLAY_AUDIO base64 handler failed', err)
          }
        } else {
          // ArrayBuffer path
          try {
            const audioBuf = msg.audio
            const blob = new Blob([audioBuf], { type: mime })
            const url = URL.createObjectURL(blob)
            const a = new Audio()
            a.src = url
            a.autoplay = true
            const p = a.play()
            if (p && p.catch) p.catch((e) => console.warn('[readit] audio play failed', e))
            setTimeout(() => URL.revokeObjectURL(url), 60_000)
          } catch (err) {
            console.warn('[readit] PLAY_AUDIO handler failed', err)
          }
        }
      } catch (err) {
        console.warn('[readit] PLAY_AUDIO handler error', err)
      }
    }
  } catch (err) {
    console.warn('[readit] content script handler error', err)
  }
  // no async response
  return false
})

