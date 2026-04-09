import { isPlayAudio } from '../lib/messaging'
import { decodeBase64ToUint8Array, prefixHexFromU8 } from './player'
import { PlaybackController } from './playback'

// Temporary diagnostics flag - enable while debugging playback/selection issues.
// Set to false when not needed to avoid noisy logs.
const DEBUG = true

type ContentBridgeState = {
  initialized: boolean
  playback: PlaybackController
}

function getContentBridgeState(): ContentBridgeState {
  const globalState = globalThis as typeof globalThis & {
    __readitContentBridgeState?: ContentBridgeState
  }

  if (!globalState.__readitContentBridgeState) {
    globalState.__readitContentBridgeState = {
      initialized: false,
      playback: new PlaybackController(),
    }
  }

  return globalState.__readitContentBridgeState
}

const bridgeState = getContentBridgeState()
const playback = bridgeState.playback

function applyPlaybackRate(rate: unknown) {
  if (typeof rate !== 'number' || Number.isNaN(rate)) return
  playback.setPlaybackRate(rate)
}

async function hydratePlaybackRateFromStorage() {
  try {
    if (!chrome?.storage?.sync) return
    const stored = await chrome.storage.sync.get(['settings'])
    applyPlaybackRate(stored?.settings?.rate)
  } catch (err) {
    console.warn('[readit] failed to hydrate playback rate', err)
  }
}

if (bridgeState.initialized) {
  console.debug('[readit] content script already initialized')
} else {
  bridgeState.initialized = true
  console.debug('[readit] content script loaded')

  void hydratePlaybackRateFromStorage()

  try {
    chrome?.storage?.onChanged?.addListener?.((changes, areaName) => {
      if (areaName !== 'sync') return
      if (!changes?.settings) return
      const next = changes.settings.newValue
      if (next && typeof next === 'object' && 'rate' in next) applyPlaybackRate((next as Record<string, unknown>).rate)
    })
  } catch (err) {
    console.warn('[readit] failed to register storage rate listener', err)
  }

  chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
    try {
      console.debug('[readit] content script received message', msg, 'from', sender)

      if (isPlayAudio(msg)) {
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
          const playbackToken = typeof (msg as Record<string, unknown>).playbackToken === 'string'
            ? String((msg as Record<string, unknown>).playbackToken)
            : null
          if (typeof (msg as Record<string, unknown>).rate === 'number') applyPlaybackRate((msg as Record<string, unknown>).rate)

          const notifyPlaybackFinished = (result: { ok: boolean; error?: string }) => {
            if (!playbackToken) return
            try {
              chrome.runtime.sendMessage({
                kind: 'PLAYBACK_FINISHED',
                playbackToken,
                ok: result.ok,
                error: result.error,
              }, () => {
                void chrome.runtime.lastError
              })
            } catch (err) {
              console.warn('[readit] PLAYBACK_FINISHED notify failed', err)
            }
          }

          if (typeof msg.audio === 'string') {
            void playback.playBase64(msg.audio as string, mime).then((r) => {
              notifyPlaybackFinished(r)
              sendResponse?.(r)
            })
          } else {
            void playback.playArrayBuffer(msg.audio as ArrayBuffer, mime).then((r) => {
              notifyPlaybackFinished(r)
              sendResponse?.(r)
            })
          }
          return true
        } catch (err) {
          console.warn('[readit] PLAY_AUDIO handler error', err)
        }
      }

      if (typeof msg === 'object' && msg !== null && (msg as Record<string, unknown>).kind === 'PAUSE_SPEECH') {
        try {
          playback.pause()
          sendResponse?.({ ok: true, paused: true })
        } catch (err) {
          console.warn('[readit] PAUSE_SPEECH handler failed', err)
          sendResponse?.({ ok: false, error: String(err) })
        }
        return true
      }

      if (typeof msg === 'object' && msg !== null && (msg as Record<string, unknown>).kind === 'RESUME_SPEECH') {
        try {
          void playback.resume().then(() => sendResponse?.({ ok: true, resumed: true })).catch((e) => sendResponse?.({ ok: false, error: String(e) }))
        } catch (err) {
          console.warn('[readit] RESUME_SPEECH handler failed', err)
          sendResponse?.({ ok: false, error: String(err) })
        }
        return true
      }

      if (typeof msg === 'object' && msg !== null && (msg as Record<string, unknown>).kind === 'STOP_SPEECH') {
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
    return false
  })
}
