import { isReadSelection, isReadText, isPlayAudio } from '../lib/messaging'
import { decodeBase64ToUint8Array, prefixHexFromU8 } from './player'
import { PlaybackController } from './playback'

console.debug('[readit] content script loaded')

// Temporary diagnostics flag - enable while debugging playback/selection issues.
// Set to false when not needed to avoid noisy logs.
const DEBUG = true

// Central playback controller (HTMLAudio + WebAudio fallback)
const playback = new PlaybackController()

// Ask the background/service worker to obtain TTS audio (avoids CORS)
// and return the audio bytes which we then play in-page.
async function speak(text: string) {
  try {
    console.debug('[readit] content speak: requesting tts for', text.substring(0, 50) + '...')
    chrome.runtime.sendMessage({ action: 'request-tts', text }, async (resp) => {
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

        // Delegate actual playback to the central controller so behavior is
        // consistent and testable.
        if (typeof audio === 'string') {
          try {
            const r = await playback.playBase64(audio as string, mime)
            if (!r.ok) console.warn('[readit] speak: playback failed', r)
          } catch (err) {
            console.warn('[readit] speak: playback error', err)
          }
        } else {
          try {
            const r = await playback.playArrayBuffer(audio as ArrayBuffer, mime)
            if (!r.ok) console.warn('[readit] speak: playback failed', r)
          } catch (err) {
            console.warn('[readit] speak: playback error', err)
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

chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
  try {
    console.debug('[readit] content script received message', msg, 'from', sender)

    if (isReadSelection(msg)) {
      const sel = window.getSelection()?.toString().trim()
      console.debug('[readit] selection text:', sel)
      if (sel) speak(sel)
    } else if (isReadText(msg)) {
      const t = msg.text?.trim()
      if (t) speak(t)
    } else if (isPlayAudio(msg)) {
      // Extra diagnostics when enabled
      try {
        if (DEBUG) {
          if (typeof msg.audio === 'string') {
            try {
              const u8 = decodeBase64ToUint8Array(msg.audio as string)
              console.debug('[readit][DBG] PLAY_AUDIO received (base64)', { mime: msg.mime, audioLength: u8.length, prefixHex: prefixHexFromU8(u8) })
            } catch (e) {
              console.debug('[readit][DBG] PLAY_AUDIO base64 diagnostics decode failed', e)
            }
          } else {
            const buf = msg.audio as ArrayBuffer
            const u8 = new Uint8Array(buf)
            console.debug('[readit][DBG] PLAY_AUDIO received (arraybuffer)', { mime: msg.mime, audioLength: u8.byteLength, prefixHex: prefixHexFromU8(u8) })
          }
        }
      } catch (dbgErr) {
        console.debug('[readit][DBG] PLAY_AUDIO diagnostics failed', dbgErr)
      }

      console.debug('[readit] content PLAY_AUDIO: received audio message', { mime: msg.mime, audioType: typeof msg.audio, audioLength: typeof msg.audio === 'string' ? msg.audio.length : (msg.audio as ArrayBuffer)?.byteLength })
      try {
        const mime = msg.mime ?? 'audio/wav'
        // Stop any previously playing audio (we'll replace it with the new chunk)
        try { playback.stop() } catch {}

        if (typeof msg.audio === 'string') {
          void playback.playBase64(msg.audio as string, mime).then((r) => sendResponse?.(r))
        } else {
          void playback.playArrayBuffer(msg.audio as ArrayBuffer, mime).then((r) => sendResponse?.(r))
        }
        // Return true to indicate we'll call sendResponse asynchronously
        return true
      } catch (err) {
        console.warn('[readit] PLAY_AUDIO handler error', err)
      }
    }
    // Support pause/resume/stop messages so the background can control playback
    else if (typeof msg === 'object' && msg !== null && (msg as any).kind === 'PAUSE_SPEECH') {
      try {
        playback.pause()
        sendResponse?.({ ok: true, paused: true })
      } catch (err) {
        console.warn('[readit] PAUSE_SPEECH handler failed', err)
        sendResponse?.({ ok: false, error: String(err) })
      }
      return true
    } else if (typeof msg === 'object' && msg !== null && (msg as any).kind === 'RESUME_SPEECH') {
      try {
        void playback.resume().then(() => sendResponse?.({ ok: true, resumed: true })).catch((e) => sendResponse?.({ ok: false, error: String(e) }))
      } catch (err) {
        console.warn('[readit] RESUME_SPEECH handler failed', err)
        sendResponse?.({ ok: false, error: String(err) })
      }
      return true
    }
    // Support a stop message so the background can cancel queued playback
    else if (typeof msg === 'object' && msg !== null && (msg as any).kind === 'STOP_SPEECH') {
      try {
        playback.stop()
        sendResponse?.({ ok: true, stopped: true })
      } catch (err) {
        console.warn('[readit] STOP_SPEECH handler failed', err)
        sendResponse?.({ ok: false, error: String(err) })
      }
      return true
    }
  } catch (err) {
    console.warn('[readit] content script handler error', err)
  }
  // no async response
  return false
})


