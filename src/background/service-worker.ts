import type { Msg } from '../lib/messaging'
import { getSettings } from '../lib/storage'
// lib/messaging guards are available for other modules; this background
// worker does not directly reference them here to keep runtime size small.

// When building, proper Chrome typings from @types/chrome will provide
// accurate types for the extension APIs. Avoid in-file shims where
// possible so the real types are used instead.

async function getActiveHttpTab() {
  // Use lastFocusedWindow so when messages originate from extension UIs
  // (popup/options) we still find the user's last focused browser tab
  // rather than the extension popup window itself.
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab?.id || !tab.url) return null
  // only inject on regular pages
  if (!/^https?:|^file:/.test(tab.url)) return null
  return tab
}

// Temporary diagnostics flag - enable when debugging TTS/selection issues.
// Set to false when not actively debugging to avoid noisy logs.
const DEBUG = true

function prefixHexFromBuffer(buf: ArrayBuffer | null | undefined, len = 32) {
  if (!buf) return '<empty>'
  try {
    const u = new Uint8Array(buf)
    const slice = u.subarray(0, Math.min(len, u.length))
    return Array.from(slice).map((b) => b.toString(16).padStart(2, '0')).join(' ')
  } catch (e) { void e; return '<err>' }
}

// Wait for the player window to announce readiness. The player page
// sends { action: 'player_ready' } when its script runs. Resolve when
// that message arrives or when the timeout elapses.


// Replace the background worker implementation with a chunking + queueing
// implementation that avoids splitting sentences where possible and supports
// pause/resume/cancel and a simple speech-status API for the popup.

const MAX_CHUNK_CHARS = 400
// Allow tests to override the chunk timeout via globalThis.__CHUNK_TIMEOUT_MS
const CHUNK_TIMEOUT_MS = ((globalThis as unknown as { __CHUNK_TIMEOUT_MS?: number }).__CHUNK_TIMEOUT_MS) ?? 60_000 // default 1 minute
const PREFETCH_COUNT = 2 // how many chunks to fetch ahead of playback

let cancelRequested = false
let paused = false
let currentChunks: string[] | null = null
let currentIndex = 0

function resetQueue() {
  currentChunks = null
  currentIndex = 0
  cancelRequested = false
  paused = false
}

function splitTextIntoChunks(text: string, maxLen = MAX_CHUNK_CHARS): string[] {
  const out: string[] = []
  let remaining = text.trim()
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { out.push(remaining); break }
    const slice = remaining.slice(0, maxLen)
    const boundary = Math.max(slice.lastIndexOf('.'), slice.lastIndexOf('!'), slice.lastIndexOf('?'), slice.lastIndexOf('\n'), slice.lastIndexOf(';'))
    let cut = boundary
    if (cut <= 0) {
      const ws = slice.lastIndexOf(' ')
      cut = ws > 0 ? ws : maxLen
    }
    const part = remaining.slice(0, cut).trim()
    if (part) out.push(part)
    remaining = remaining.slice(cut).trim()
  }
  return out
}

function arrayBufferToBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf)
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const sub = bytes.subarray(i, i + CHUNK)
    binary += String.fromCharCode.apply(null, Array.from(sub))
  }
  return btoa(binary)
}

async function fetchTtsAudio(text: string, voice?: string): Promise<{ b64: string; mime: string } | null> {
  const s = await getSettings()
  if (!s.ttsUrl) return null
  try {
    const resp = await fetch(s.ttsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice: voice ?? s.voice }) })
    if (!resp.ok) return null
    const mime = resp.headers.get('content-type') || 'audio/wav'
    const buf = await resp.arrayBuffer()
    if (DEBUG) console.debug('[readit][DBG] fetchTtsAudio response', { mime, prefixHex: prefixHexFromBuffer(buf) })
    return { b64: arrayBufferToBase64(buf), mime }
  } catch (err) { console.warn('[readit] fetchTtsAudio failed', err); return null }
}

async function processChunksSequentially(tab: chrome.tabs.Tab, chunks: string[], voice?: string) {
  // Producer-consumer: fetch audio for chunks ahead of playback
  cancelRequested = false
  paused = false
  currentChunks = chunks
  currentIndex = 0

  const audioMap = new Map<number, { b64: string; mime: string }>()
  let nextFetchIndex = 0
  let nextSendIndex = 0
  let producerDone = false

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  const producer = async () => {
    try {
      while (nextFetchIndex < chunks.length && !cancelRequested) {
        // Pause fetching while paused to respect user intent
        while (paused && !cancelRequested) await sleep(200)
        if (cancelRequested) break

        // Don't prefetch beyond the configured window
        if (audioMap.size >= PREFETCH_COUNT) {
          await sleep(100)
          continue
        }

        const i = nextFetchIndex
        nextFetchIndex++
        const fetched = await fetchTtsAudio(chunks[i], voice)
        if (!fetched) {
          console.warn('[readit] failed to fetch chunk', i)
          // Abort the whole pipeline on fetch failure
          cancelRequested = true
          break
        }
        audioMap.set(i, fetched)
      }
    } catch (err) {
      console.warn('[readit] producer failed', err)
      cancelRequested = true
    } finally {
      producerDone = true
    }
  }

  const consumer = async () => {
    try {
      while (nextSendIndex < chunks.length && !cancelRequested) {
        currentIndex = nextSendIndex

  // Wait for the audio to be available (or for producer to finish)
        while (!audioMap.has(nextSendIndex) && !producerDone && !cancelRequested) {
          await sleep(100)
          // If paused, wait until resumed
          while (paused && !cancelRequested) await sleep(200)
        }
        if (cancelRequested) break

        const entry = audioMap.get(nextSendIndex)
        if (!entry) {
          // No audio available (producer finished or failed). Abort.
          console.warn('[readit] no audio available for chunk', nextSendIndex)
          cancelRequested = true
          break
        }

        // Send to content script and wait for ack or timeout
                try {
                  // Try the normal content-script path first. If the tab has a
                  // content script registered and listening this will resolve.
                  const sendPromise = (async () => { if (!tab.id) return null; return await chrome.tabs.sendMessage(tab.id, { kind: 'PLAY_AUDIO', audio: entry.b64, mime: entry.mime }) })()
                  const timeout = new Promise((res) => setTimeout(() => res({ timeout: true }), CHUNK_TIMEOUT_MS))
                  const res = await Promise.race([sendPromise, timeout])
                  if (res && typeof res === 'object' && res !== null && 'timeout' in (res as Record<string, unknown>) && (res as Record<string, unknown>).timeout) console.warn('[readit] chunk ack timeout; proceeding')
                } catch (err) {
                  // If sendMessage fails because no content script exists in the
                  // page, attempt to play the chunk by injecting a small script
                  // that creates an HTMLAudio element with a data: URI. This
                  // avoids cancelling the entire pipeline for pages where the
                  // manifest content script wasn't present or was blocked.
                  console.warn('[readit] send chunk failed - attempting executeScript fallback', err)
                  try {
                    if (tab.id) {
                      await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        world: 'MAIN',
                        func: (b64: string, mime: string) => {
                          try {
                            const audio = new Audio(`data:${mime};base64,${b64}`)
                            // play() returns a promise; swallow failures
                            void audio.play().catch(() => { /* ignore */ })
                            return true
                          } catch (e) { return false }
                        },
                        args: [entry.b64, entry.mime],
                      })
                    }
                  } catch (ex) {
                    console.warn('[readit] executeScript fallback failed', ex)
                    cancelRequested = true
                    break
                  }
                }

        // Free memory for this chunk and move to next
        audioMap.delete(nextSendIndex)
        nextSendIndex++
      }
    } catch (err) {
      console.warn('[readit] consumer failed', err)
      cancelRequested = true
    }
  }

  // Start both concurrently and wait for completion
  const prod = producer()
  const cons = consumer()
  await Promise.all([prod, cons])

  if (cancelRequested) {
    try { if (tab.id) await chrome.tabs.sendMessage(tab.id, { kind: 'STOP_SPEECH' }) } catch (e) { void e }
    resetQueue()
    return
  }

  // Finished successfully
  resetQueue()
}

export async function sendToActiveTabOrInject(msg: Msg) {
  try {
    const s = await getSettings()
    let textArg: string | null = null
    if (msg.kind === 'READ_TEXT') textArg = msg.text
    else {
      const tab = await getActiveHttpTab()
      if (!tab) return
        try {
          const r = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, world: 'MAIN', func: () => window.getSelection?.()?.toString().trim() ?? '' })
          if (Array.isArray(r) && r.length > 0) {
            const first = r[0] as unknown as Record<string, unknown>
            if ('result' in first) textArg = String(first.result ?? '')
          } else if (r && typeof r === 'object' && 'result' in (r as unknown as Record<string, unknown>)) {
            const obj = r as unknown as Record<string, unknown>
            textArg = String(obj.result ?? '')
          }
        } catch (err) { console.warn('[readit] executeScript failed', err); return }
      if (DEBUG) console.debug('[readit][DBG] selection from tab', { tabId: tab.id, tabUrl: tab.url, textLength: textArg?.length ?? 0 })
    }
    if (!textArg || !s.ttsUrl) return

    if (s.ttsUrl?.toString().endsWith('/play')) { try { await fetch(s.ttsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: textArg, voice: s.voice }) }) } catch (err) { console.warn('[readit] play-only POST failed', err) } ; return }

    const tab = await getActiveHttpTab()
    if (tab && tab.id && textArg.length > MAX_CHUNK_CHARS) { const chunks = splitTextIntoChunks(textArg, MAX_CHUNK_CHARS); await processChunksSequentially(tab, chunks, s.voice); return }

    const fetched = await fetchTtsAudio(textArg, s.voice)
    if (!fetched) return
    try {
      if (DEBUG) console.debug('[readit][DBG] forward audio prepared', { mime: fetched.mime, b64len: fetched.b64.length, firstBytesBase64: fetched.b64.slice(0, 64) })
      if (tab && tab.id) {
        try {
          await chrome.tabs.sendMessage(tab.id, { kind: 'PLAY_AUDIO', audio: fetched.b64, mime: fetched.mime })
        } catch (err) {
          // Fallback: attempt to play via executeScript (inject small in-page player)
          console.warn('[readit] forward audio sendMessage failed; trying executeScript fallback', err)
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              world: 'MAIN',
              func: (b64: string, mime: string) => {
                try {
                  const audio = new Audio(`data:${mime};base64,${b64}`)
                  void audio.play().catch(() => { /* ignore */ })
                  return true
                } catch (e) { return false }
              },
              args: [fetched.b64, fetched.mime],
            })
          } catch (ex) {
            console.warn('[readit] executeScript fallback failed for forward audio', ex)
          }
        }
      }
    } catch (err) { console.warn('[readit] forward audio failed', err) }
  } catch (err) { console.warn('[readit] sendToActiveTabOrInject failed', err) }
}

// Runtime message handlers: control the queue and expose status to the popup
chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  try {
    // control messages are simple objects like { action: 'pause' } or
    // typed Msg objects coming from the popup.
    if (req && typeof req === 'object') {
      const anyReq = req as unknown as Record<string, unknown>
      if (anyReq.action === 'speech-status' || anyReq.kind === 'speech-status') {
        const state = cancelRequested ? 'cancelled' : paused ? 'paused' : currentChunks ? 'playing' : 'idle'
        sendResponse({ ok: true, state, current: currentIndex + 1, total: currentChunks ? currentChunks.length : 0 })
        return true
      }
        if (anyReq.action === 'cancel-speech' || anyReq.kind === 'cancel-speech') {
        cancelRequested = true
        paused = false
        // Also notify the active tab to stop any in-page playback immediately.
        ;(async () => {
          try {
            const tab = await getActiveHttpTab()
            if (tab?.id) await chrome.tabs.sendMessage(tab.id, { kind: 'STOP_SPEECH' })
          } catch (e) { void e }
        })()
        sendResponse({ ok: true })
        return true
      }
      if (anyReq.action === 'pause-speech' || anyReq.kind === 'pause-speech') {
        paused = true
        // Notify active tab to pause current audio playback
        ;(async () => {
          try {
            const tab = await getActiveHttpTab()
            if (tab?.id) await chrome.tabs.sendMessage(tab.id, { kind: 'PAUSE_SPEECH' })
          } catch (e) { void e }
        })()
        sendResponse({ ok: true })
        return true
      }
      if (anyReq.action === 'resume-speech' || anyReq.kind === 'resume-speech') {
        paused = false
        // Notify active tab to resume current audio playback
        ;(async () => {
          try {
            const tab = await getActiveHttpTab()
            if (tab?.id) await chrome.tabs.sendMessage(tab.id, { kind: 'RESUME_SPEECH' })
          } catch (e) { void e }
        })()
        sendResponse({ ok: true })
        return true
      }
      // Note: request-tts / test-tts are handled by the dedicated async
      // onMessage handler below which returns audio in the response. Do
      // not short-circuit those messages here with an OK-only ack — that
      // caused callers (Options) to receive { ok: true } with no audio.
      if (anyReq.action === 'probe-tts' || anyReq.kind === 'probe-tts' || anyReq.kind === 'TEST_TTS') {
        ;(async () => {
          const s = await getSettings()
          try {
            if (!s.ttsUrl) { sendResponse({ ok: false, error: 'no ttsUrl' }); return }
            const resp = await fetch(s.ttsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'test', voice: s.voice }) })
            sendResponse({ ok: resp.ok, status: resp.status })
          } catch (err) { sendResponse({ ok: false, error: String(err) }) }
        })()
        return true
      }
    }
  } catch (err) {
    console.warn('[readit] runtime.onMessage handler failed', err)
    sendResponse({ ok: false, error: String(err) })
    return true
  }
  return false
})

// Keyboard shortcuts
chrome.commands.onCommand.addListener(async (command: string) => {
  try {
    if (command === 'read-selection') {
      await sendToActiveTabOrInject({ kind: 'READ_SELECTION' })
      return
    }

    // Pause / Resume / Cancel shortcuts map directly to the same
    // control actions exposed via runtime messages. We update internal
    // flags and also notify the active tab so in-page playback is
    // controlled immediately.
    const tab = await getActiveHttpTab()
    if (command === 'pause-speech') {
      paused = true
      try { if (tab?.id) await chrome.tabs.sendMessage(tab.id, { kind: 'PAUSE_SPEECH' }) } catch (e) { void e }
      return
    }
    if (command === 'resume-speech') {
      paused = false
      try { if (tab?.id) await chrome.tabs.sendMessage(tab.id, { kind: 'RESUME_SPEECH' }) } catch (e) { void e }
      return
    }
    if (command === 'cancel-speech') {
      cancelRequested = true
      paused = false
      try { if (tab?.id) await chrome.tabs.sendMessage(tab.id, { kind: 'STOP_SPEECH' }) } catch (e) { void e }
      // resetQueue will be performed by running code path where appropriate
      // but ensure state is reset here for safety.
      resetQueue()
      return
    }
  } catch (err) {
    console.warn('[readit] commands.onCommand handler failed', err)
  }
})

// New message handler that supports async sendResponse for test-tts and
// request-tts actions coming from extension pages / content scripts.
chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  // Only claim the async response channel (return true) for messages
  // we actually handle asynchronously. If we return true but never call
  // sendResponse the caller will see the channel-closed error reported
  // by the popup. Inspect the message synchronously first.
  // Inspect message shape synchronously and decide whether we should
  // claim the async response channel. Avoid `any` and use narrow runtime
  // checks so the linter and TypeScript remain satisfied.
  const maybeMsg = msg as unknown
  if (typeof maybeMsg !== 'object' || maybeMsg === null) return false
  const maybeRec = maybeMsg as Record<string, unknown>
  const maybeAction = typeof maybeRec.action === 'string' ? maybeRec.action : undefined
  const maybeKind = typeof maybeRec.kind === 'string' ? maybeRec.kind : undefined
  const wantsAsync = maybeAction === 'request-tts' || maybeAction === 'test-tts' || maybeAction === 'play-via-player' || maybeKind === 'READ_SELECTION' || maybeKind === 'READ_TEXT'
  if (!wantsAsync) return false

  ;(async () => {
      try {
        if (typeof msg !== 'object' || msg === null) {
          // nothing to do
          return
        }
      const m = msg as Record<string, unknown>
      const action = typeof m.action === 'string' ? m.action : undefined

      // Support messages from popup to read the current selection or a
      // provided text string. These originate with { kind: 'READ_SELECTION' }
      // or { kind: 'READ_TEXT', text: '...' } and should trigger the same
      // pipeline used by keyboard shortcuts / context menu.
      if (m.kind === 'READ_SELECTION' || m.kind === 'READ_TEXT') {
        try {
          if (m.kind === 'READ_TEXT') {
            // caller supplied explicit text
            await sendToActiveTabOrInject({ kind: 'READ_TEXT', text: String(m.text ?? '') } as Msg)
          } else {
            // read selection from the active tab
            await sendToActiveTabOrInject({ kind: 'READ_SELECTION' } as Msg)
          }
          sendResponse({ ok: true })
        } catch (err) {
          console.warn('[readit] read-selection handling failed', err)
          sendResponse({ ok: false, error: String(err) })
        }
        return
      }

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
              body: JSON.stringify({ text, voice: s.voice }),
            })
            if (!resp.ok) {
              sendResponse({ ok: false, error: `tts service returned ${resp.status}` })
              return
            }
            // Try to parse JSON status; return played flag so callers can
            // present friendly UI.
            let js: ({ played?: boolean } & Record<string, unknown>) | null = null
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
          if (DEBUG) console.debug('[readit][DBG] request-tts fetched', { contentType, prefixHex: prefixHexFromBuffer(buf) })
          
          // Convert ArrayBuffer to base64 for message passing
          const bytes = new Uint8Array(buf)
          let binary = ''
          const CHUNK_SIZE = 0x8000
          for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
            const chunk = bytes.subarray(i, i + CHUNK_SIZE)
            binary += String.fromCharCode.apply(null, Array.from(chunk))
          }
          const b64 = btoa(binary)
          
          sendResponse({ ok: true, audio: b64, mime: contentType })
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
            let js: Record<string, unknown> | null = null
            try { js = await resp.json() } catch (e) { void e; js = null }
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
          if (DEBUG) console.debug('[readit][DBG] test-tts fetched', { contentType, prefixHex: prefixHexFromBuffer(buf) })
          if (tab && tab.id) {
            try {
              // Forward the raw ArrayBuffer to the content script so it can
              // perform structured-clone playback. Tests expect the forwarded
              // audio to be an ArrayBuffer with the same byteLength.
              await chrome.tabs.sendMessage(tab.id, { kind: 'PLAY_AUDIO', audio: buf, mime: contentType })
              console.debug('[readit] test-tts: forwarded ArrayBuffer audio to content script')
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
      } catch (e) { void e }
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
