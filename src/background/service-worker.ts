import type { Msg } from '../lib/messaging'
import { getSettings } from '../lib/storage'
import { isMsg, isReadText } from '../lib/messaging'

// When building, proper Chrome typings from @types/chrome will provide
// accurate types for the extension APIs. Avoid in-file shims where
// possible so the real types are used instead.

async function getActiveHttpTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || !tab.url) return null
  // only inject on regular pages
  if (!/^https?:|^file:/.test(tab.url)) return null
  return tab
}

// Wait for the player window to announce readiness. The player page
// sends { action: 'player_ready' } when its script runs. Resolve when
// that message arrives or when the timeout elapses.


export async function sendToActiveTabOrInject(msg: Msg) {
  // For reliability and to avoid injecting audio into arbitrary web pages,
  // the extension fetches TTS audio in the background and plays it inside
  // a dedicated extension-controlled player window. This avoids CORS / PNA
  // issues and prevents audio from being forcibly embedded into third-party
  // pages.
  try {
    const s = await getSettings()
    let textArg: string | null = null
    if (msg.kind === 'READ_TEXT') {
      textArg = msg.text
    } else if (!isReadText(msg)) {
      // READ_SELECTION: read the selection from the active page using
      // scripting.executeScript (reading text is safe and non-invasive).
      const tab = await getActiveHttpTab()
      if (!tab) {
        console.warn('[readit] No eligible tab to read selection from')
        return
      }
      try {
        const r = await chrome.scripting.executeScript({
          target: { tabId: tab.id! },
          world: 'MAIN',
          func: () => window.getSelection?.()?.toString().trim() ?? '',
        })
        let sel: unknown = undefined
        if (Array.isArray(r) && r.length > 0) {
          const first = r[0] as { result?: unknown }
          sel = first.result
        } else if (r && typeof r === 'object' && 'result' in (r as unknown as Record<string, unknown>)) {
          sel = (r as unknown as Record<string, unknown>).result
        }
        if (typeof sel === 'string' && sel) textArg = sel
        else {
          console.warn('[readit] no selection available')
          return
        }
      } catch (err) {
        console.warn('[readit] failed to read selection via executeScript', err)
        return
      }
    }

    if (!textArg) {
      console.warn('[readit] no text to read')
      return
    }

    if (!s.ttsUrl) {
      console.warn('[readit] no ttsUrl configured')
      return
    }

    // If this is a play-only endpoint (server-side playback), POST and
    // don't attempt to read or forward audio bytes — the server will
    // play audio on the host. This avoids unnecessary transfers and keeps
    // the behavior consistent when users configure `/api/tts/play`.
    if (s.ttsUrl?.toString().endsWith('/play')) {
      try {
        const respPlay = await fetch(s.ttsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: textArg, voice: s.voice }),
        })
        if (!respPlay.ok) {
          console.warn('[readit] play-only tts service returned non-ok', respPlay.status)
        } else {
          // Optionally parse JSON status for debugging
          try {
            const js = await respPlay.json().catch(() => null)
            console.debug('[readit] play-only endpoint responded', js)
          } catch {
            /* ignore */
          }
        }
      } catch (err) {
        console.warn('[readit] failed to call play-only tts endpoint', err)
      }
      return
    }

    // Fetch TTS from configured service in the background (avoids page CORS)
    let resp: Response
    try {
      resp = await fetch(s.ttsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textArg }),
      })
    } catch (err) {
      console.warn('[readit] failed to fetch tts audio', err)
      return
    }
    if (!resp.ok) {
      console.warn('[readit] tts service returned non-ok', resp.status)
      return
    }
    const contentType = resp.headers.get('content-type') || 'audio/wav'
    const buf = await resp.arrayBuffer()

    // Send audio to the active page's content script so audio plays in-page.
    // This removes the legacy extension popup player window and avoids
    // creating small browser windows when doing TTS.
    try {
      const tab = await getActiveHttpTab()
      if (tab && tab.id) {
        try {
          await chrome.tabs.sendMessage(tab.id, { kind: 'PLAY_AUDIO', audio: buf, mime: contentType })
          console.debug('[readit] forwarded audio to content script')
        } catch (e) {
          // If structured clone for ArrayBuffer fails, fall back to base64
          try {
            const bytes = new Uint8Array(buf)
            let binary = ''
            const CHUNK = 0x8000
            for (let i = 0; i < bytes.length; i += CHUNK) {
              const sub = bytes.subarray(i, i + CHUNK)
              binary += String.fromCharCode.apply(null, Array.from(sub))
            }
            const b64 = btoa(binary)
            await chrome.tabs.sendMessage(tab.id, { kind: 'PLAY_AUDIO', audio: b64, mime: contentType })
            console.debug('[readit] forwarded base64 audio to content script')
          } catch (e2) {
            console.warn('[readit] failed to send audio to content script', e2)
          }
        }
      } else {
        // No eligible tab to receive audio; log and skip playing rather
        // than opening a popup window.
        console.warn('[readit] no eligible tab to play audio in; skipping playback')
      }
    } catch (e3) {
      console.warn('[readit] failed to forward audio to content script', e3)
    }
  } catch (err) {
    console.warn('[readit] sendToActiveTabOrInject failed', err)
  }
}

// Keyboard shortcut
chrome.commands.onCommand.addListener(async (command: string) => {
  if (command === 'read-selection') {
    await sendToActiveTabOrInject({ kind: 'READ_SELECTION' })
  }
})

// Allow other extension contexts (popup/options) to request a read via
// runtime messages. Route these through the same helper so injection
// fallback is centralized.
chrome.runtime.onMessage.addListener((msg: unknown) => {
  // No async sendResponse usage — background no longer proxies to an
  // external helper. Messages are handled synchronously or routed to
  // sendToActiveTabOrInject which performs in-tab speaking/injection.
  ;(async () => {
    try {
      // No external helper proxy or probe: extension now relies solely on
      // in-browser speechSynthesis. Page-level requests should use the
      // existing extension messages (READ_TEXT / READ_SELECTION) which are
      // handled by the content script. We intentionally do not perform any
      // fetches to localhost or other servers.

      // Use shared guards from lib/messaging for the normal read messages
      if (isMsg(msg)) {
        await sendToActiveTabOrInject(msg)
      }
    } catch (err) {
      console.warn('[readit] runtime message handler failed', err)
    }
  })()

  // Also handle extension page test requests for the configured TTS service.
  // The options page sends { action: 'test-tts', text } and expects a response.
  return true
})

// New message handler that supports async sendResponse for test-tts and
// request-tts actions coming from extension pages / content scripts.
chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  ;(async () => {
    try {
      if (typeof msg !== 'object' || msg === null) {
        // nothing to do
        return
      }
      const m = msg as Record<string, unknown>
      const action = (m as any).action as string | undefined

      if (action === 'request-tts') {
        const text = typeof m.text === 'string' ? m.text : String(m.text ?? '')
        if (!text) {
          sendResponse({ ok: false, error: 'empty text' })
          return
        }
        const s = await getSettings()
        if (!s.ttsUrl) {
          sendResponse({ ok: false, error: 'no ttsUrl configured' })
          return
        }
        try {
          // If the configured URL is a play-only endpoint (server-side playback),
          // POST and treat the response as JSON status instead of audio. This
          // avoids attempting to play non-audio responses in the extension UI.
          if (s.ttsUrl?.toString().endsWith('/play')) {
            const resp = await fetch(s.ttsUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text }),
            })
            if (!resp.ok) {
              sendResponse({ ok: false, error: `tts service returned ${resp.status}` })
              return
            }
            // Try to parse JSON status; return played flag so callers can
            // present friendly UI.
            let js: any = null
            try { js = await resp.json() } catch { js = null }
            sendResponse({ ok: true, played: js?.played === true, info: js })
            return
          }

          const resp = await fetch(s.ttsUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, voice: s.voice }),
          })
          if (!resp.ok) {
            sendResponse({ ok: false, error: `tts service returned ${resp.status}` })
            return
          }
          const contentType = resp.headers.get('content-type') || 'audio/wav'
          const buf = await resp.arrayBuffer()
          sendResponse({ ok: true, audio: buf, mime: contentType })
          return
        } catch (err) {
          sendResponse({ ok: false, error: String(err) })
          return
        }
      }

      if (action === 'test-tts') {
        const text = typeof m.text === 'string' ? m.text : String(m.text ?? '')
        if (!text) {
          sendResponse({ ok: false, error: 'empty text' })
          return
        }
        const s = await getSettings()
        if (!s.ttsUrl) {
          sendResponse({ ok: false, error: 'no ttsUrl configured' })
          return
        }
        try {
          // If the configured URL is a play-only endpoint, call it and
          // surface the JSON status to the caller; also attempt to forward
          // playback to the content script when the endpoint returned
          // audio (non-play-only).
          if (s.ttsUrl?.toString().endsWith('/play')) {
            const resp = await fetch(s.ttsUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text, voice: s.voice }),
            })
            if (!resp.ok) {
              sendResponse({ ok: false, error: `tts service returned ${resp.status}` })
              return
            }
            let js: any = null
            try { js = await resp.json() } catch { js = null }
            // Forward a simple OK response; content script playback is not
            // applicable for play-only endpoints since audio is played on
            // the server.
            sendResponse({ ok: true, played: js?.played === true, info: js })
            return
          }

          const resp = await fetch(s.ttsUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, voice: s.voice }),
          })
          if (!resp.ok) {
            sendResponse({ ok: false, error: `tts service returned ${resp.status}` })
            return
          }
          const contentType = resp.headers.get('content-type') || 'audio/wav'
          const buf = await resp.arrayBuffer()
          const tab = await getActiveHttpTab()
          if (tab && tab.id) {
            try {
              await chrome.tabs.sendMessage(tab.id, { kind: 'PLAY_AUDIO', audio: buf, mime: contentType })
              console.debug('[readit] test-tts: forwarded audio to content script')
            } catch (err) {
              console.warn('[readit] test-tts: failed to send audio to content script', err)
            }
          }
          sendResponse({ ok: true, audio: buf, mime: contentType })
          return
        } catch (err) {
          sendResponse({ ok: false, error: String(err) })
          return
        }
      }

      if (action === 'play-via-player') {
        // Legacy entrypoint kept for callers that still use play-via-player.
        // Instead of opening a player window, return the fetched audio so
        // the caller (popup/options) can play it in-page. This removes the
        // spawned window behavior.
        const text = typeof m.text === 'string' ? m.text : String(m.text ?? '')
        if (!text) {
          sendResponse({ ok: false, error: 'empty text' })
          return
        }
        const s = await getSettings()
        if (!s.ttsUrl) {
          sendResponse({ ok: false, error: 'no ttsUrl configured' })
          return
        }
        try {
          const resp = await fetch(s.ttsUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          })
          if (!resp.ok) {
            sendResponse({ ok: false, error: `tts service returned ${resp.status}` })
            return
          }
          const contentType = resp.headers.get('content-type') || 'audio/wav'
          const buf = await resp.arrayBuffer()
          sendResponse({ ok: true, audio: buf, mime: contentType })
          return
        } catch (err) {
          sendResponse({ ok: false, error: String(err) })
          return
        }
      }
    } catch (err) {
      console.warn('[readit] test-tts handler failed', err)
      try {
        sendResponse({ ok: false, error: String(err) })
      } catch (_) {
        // ignore if sendResponse is already closed
      }
    }
  })()

  return true
})

// Context menu
chrome.runtime.onInstalled.addListener(() => {
  if (!chrome.contextMenus) return
  chrome.contextMenus.create({
    id: 'read-selection',
    title: 'Read selection aloud',
    contexts: ['selection'],
  })
})
if (chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener(async (info: chrome.contextMenus.OnClickData) => {
    if (info.menuItemId === 'read-selection') {
      await sendToActiveTabOrInject({ kind: 'READ_SELECTION' })
    }
  })
}
