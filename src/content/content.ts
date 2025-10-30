import { isReadSelection, isReadText, isPlayAudio } from '../lib/messaging'

console.debug('[readit] content script loaded')

// Ask the background/service worker to obtain TTS audio (avoids CORS)
// and return the audio bytes which we then play in-page.
async function speak(text: string) {
  try {
    console.debug('[readit] content speak: requesting tts for', text.substring(0, 50) + '...')
    chrome.runtime.sendMessage({ action: 'request-tts', text }, (resp) => {
      try {
        console.debug('[readit] content speak: received response', resp)
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
        // If server returned a non-audio MIME (for example the play-only
        // endpoint returns JSON), avoid trying to play it. Fall back to
        // browser TTS when possible.
        if (!mime.startsWith('audio/')) {
          console.warn('[readit] speak: received non-audio response from TTS service', mime)
          // No automatic browser fallback — server-only playback is required.
          return
        }
        // audio may be an ArrayBuffer (structured clone) or a base64 string
        if (typeof audio === 'string') {
          console.debug('[readit] content speak: decoding base64 audio')
          try {
            const bin = atob(audio)
            const len = bin.length
            const u8 = new Uint8Array(len)
            for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i)
            if (u8.length === 0) {
              console.warn('[readit] speak: decoded audio buffer is empty', { mime })
              // No automatic fallback; surface the issue via console.
              return
            }
            const blob = new Blob([u8], { type: mime })
            const url = URL.createObjectURL(blob)
            const a = new Audio(url)
            a.autoplay = true
            a.play().catch((e) => {
              const hex = (() => { try { const v = u8.subarray(0,16); return Array.from(v).map(x=>x.toString(16).padStart(2,'0')).join(' ') } catch { return '<n/a>' } })()
              console.warn('[readit] audio play failed', { mime, prefixHex: hex, error: e })
            })
            setTimeout(() => URL.revokeObjectURL(url), 60_000)
          } catch (err) {
            console.warn('[readit] speak: failed to decode base64 audio', err)
          }
        } else {
          console.debug('[readit] content speak: playing ArrayBuffer audio')
          try {
            const buf = audio as ArrayBuffer
            const u8 = new Uint8Array(buf)
            if (u8.length === 0) {
              console.warn('[readit] speak: fetched audio buffer is empty', { mime })
              // No automatic fallback; surface the issue via console.
              return
            }
            const blob = new Blob([buf], { type: mime })
            const url = URL.createObjectURL(blob)
            const a = new Audio(url)
            a.autoplay = true
            a.play().catch((e) => {
              const hex = (() => { try { const v = u8.subarray(0,16); return Array.from(v).map(x=>x.toString(16).padStart(2,'0')).join(' ') } catch { return '<n/a>' } })()
              console.warn('[readit] audio play failed', { mime, prefixHex: hex, error: e })
            })
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
      console.debug('[readit] content PLAY_AUDIO: received audio message', { mime: msg.mime, audioType: typeof msg.audio, audioLength: typeof msg.audio === 'string' ? msg.audio.length : (msg.audio as ArrayBuffer)?.byteLength })
      try {
        const mime = msg.mime ?? 'audio/wav'
        if (typeof msg.audio === 'string') {
          // base64 path
          console.debug('[readit] content PLAY_AUDIO: decoding base64')
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
            if (p && p.catch) p.catch((e) => console.warn('[readit] PLAY_AUDIO base64 play failed', e))
            setTimeout(() => URL.revokeObjectURL(url), 60_000)
          } catch (err) {
            console.warn('[readit] PLAY_AUDIO base64 handler failed', err)
          }
        } else {
          // ArrayBuffer path
          console.debug('[readit] content PLAY_AUDIO: playing ArrayBuffer')
          try {
            const audioBuf = msg.audio
            const blob = new Blob([audioBuf], { type: mime })
            const url = URL.createObjectURL(blob)
            const a = new Audio()
            a.src = url
            a.autoplay = true
            const p = a.play()
            if (p && p.catch) p.catch((e) => console.warn('[readit] PLAY_AUDIO ArrayBuffer play failed', e))
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


