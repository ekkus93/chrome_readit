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

const UNSUPPORTED_PLAYBACK_ERROR = 'Playback not supported on this page'
const CONTENT_SCRIPT_FILE = 'src/content/content.ts'

async function requireActivePlaybackTab(): Promise<chrome.tabs.Tab> {
  const tab = await getActiveHttpTab()
  if (!tab?.id) throw new Error(UNSUPPORTED_PLAYBACK_ERROR)
  return tab
}

async function ensurePlaybackBridge(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_FILE],
    })
  } catch (err) {
    throw new Error(`${UNSUPPORTED_PLAYBACK_ERROR}: ${String(err)}`)
  }
}

async function sendTabMessageWithBootstrap(tabId: number, message: Record<string, unknown>): Promise<unknown> {
  try {
    return await chrome.tabs.sendMessage(tabId, message)
  } catch (err) {
    console.warn('[readit] tab sendMessage failed; attempting playback bridge bootstrap', err)
    await ensurePlaybackBridge(tabId)
    return await chrome.tabs.sendMessage(tabId, message)
  }
}

// Temporary diagnostics flag - enable when debugging TTS/selection issues.
// Set to false when not actively debugging to avoid noisy logs.
const DEBUG = true

const MIN_RATE = 0.5
const MAX_RATE = 10
let cachedPlaybackRate = 1

function clampPlaybackRate(value: unknown, fallback = 1): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(MAX_RATE, Math.max(MIN_RATE, num))
}

function getCurrentPlaybackRate(): number {
  return cachedPlaybackRate
}

async function primePlaybackRateCache() {
  try {
    const initial = await getSettings()
    if (initial && typeof initial === 'object') {
      cachedPlaybackRate = clampPlaybackRate((initial as Record<string, unknown>).rate, cachedPlaybackRate)
    }
  } catch (err) {
    console.warn('[readit] primePlaybackRateCache failed', err)
  }
}

void primePlaybackRateCache()

try {
  chrome.storage?.onChanged?.addListener?.((changes, area) => {
    if (area !== 'sync') return
    const next = changes.settings?.newValue
    if (next && typeof next === 'object' && 'rate' in next) {
      cachedPlaybackRate = clampPlaybackRate((next as Record<string, unknown>).rate, cachedPlaybackRate)
    }
  })
} catch (err) {
  console.warn('[readit] failed to attach playback rate storage listener', err)
}

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

type PlaybackSession = {
  id: number
  tabId: number
  cancelRequested: boolean
  paused: boolean
  chunks: string[]
  currentIndex: number
}

let nextSessionId = 1
let activeSession: PlaybackSession | null = null

function isSessionActive(sessionId: number): boolean {
  return activeSession?.id === sessionId
}

function createPlaybackSession(tabId: number, chunks: string[]): PlaybackSession {
  return {
    id: nextSessionId++,
    tabId,
    cancelRequested: false,
    paused: false,
    chunks,
    currentIndex: 0,
  }
}

function finishPlaybackSession(sessionId: number): void {
  if (isSessionActive(sessionId)) activeSession = null
}

async function stopSessionPlayback(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { kind: 'STOP_SPEECH' })
  } catch (err) {
    void err
  }
}

async function cancelPlaybackSession(session: PlaybackSession | null): Promise<void> {
  if (!session) return
  session.cancelRequested = true
  session.paused = false
  if (isSessionActive(session.id)) activeSession = null
  await stopSessionPlayback(session.tabId)
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
  cachedPlaybackRate = clampPlaybackRate(s.rate, cachedPlaybackRate)
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

async function processChunksSequentially(session: PlaybackSession, voice?: string) {
  // Producer-consumer: fetch audio for chunks ahead of playback
  const sessionId = session.id
  const { tabId, chunks } = session

  const audioMap = new Map<number, { b64: string; mime: string }>()
  let nextFetchIndex = 0
  let nextSendIndex = 0
  let producerDone = false

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  const producer = async () => {
    try {
      while (nextFetchIndex < chunks.length && isSessionActive(sessionId) && !session.cancelRequested) {
        // Pause fetching while paused to respect user intent
        while (session.paused && isSessionActive(sessionId) && !session.cancelRequested) await sleep(200)
        if (!isSessionActive(sessionId) || session.cancelRequested) break

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
          session.cancelRequested = true
          break
        }
        if (!isSessionActive(sessionId) || session.cancelRequested) break
        audioMap.set(i, fetched)
      }
    } catch (err) {
      console.warn('[readit] producer failed', err)
      session.cancelRequested = true
    } finally {
      producerDone = true
    }
  }

  const consumer = async () => {
    try {
      while (nextSendIndex < chunks.length && isSessionActive(sessionId) && !session.cancelRequested) {
        session.currentIndex = nextSendIndex

        // Wait for the audio to be available (or for producer to finish)
        while (!audioMap.has(nextSendIndex) && !producerDone && isSessionActive(sessionId) && !session.cancelRequested) {
          await sleep(100)
          // If paused, wait until resumed
          while (session.paused && isSessionActive(sessionId) && !session.cancelRequested) await sleep(200)
        }
        if (!isSessionActive(sessionId) || session.cancelRequested) break

        const entry = audioMap.get(nextSendIndex)
        if (!entry) {
          // No audio available (producer finished or failed). Abort.
          console.warn('[readit] no audio available for chunk', nextSendIndex)
          session.cancelRequested = true
          break
        }

        // Send to content script and wait for ack or timeout
        const playbackRate = getCurrentPlaybackRate()
          try {
                  // Try the normal content-script path first. If the tab has a
                  // content script registered and listening this will resolve.
                  const sendPromise = (async () => {
                    return await sendTabMessageWithBootstrap(tabId, { kind: 'PLAY_AUDIO', audio: entry.b64, mime: entry.mime, rate: playbackRate })
                  })()
                  const timeout = new Promise((res) => setTimeout(() => res({ timeout: true }), CHUNK_TIMEOUT_MS))
                  const res = await Promise.race([sendPromise, timeout])
                  if (res && typeof res === 'object' && res !== null && 'timeout' in (res as Record<string, unknown>) && (res as Record<string, unknown>).timeout) console.warn('[readit] chunk ack timeout; proceeding')
                } catch (err) {
                  console.warn('[readit] send chunk failed after playback bridge bootstrap', err)
                  session.cancelRequested = true
                  break
                }

        // Free memory for this chunk and move to next
        audioMap.delete(nextSendIndex)
        nextSendIndex++
      }
    } catch (err) {
      console.warn('[readit] consumer failed', err)
      session.cancelRequested = true
    }
  }

  // Start both concurrently and wait for completion
  const prod = producer()
  const cons = consumer()
  await Promise.all([prod, cons])

  if (session.cancelRequested && isSessionActive(sessionId)) {
    await stopSessionPlayback(tabId)
  }
  finishPlaybackSession(sessionId)
}

export async function sendToActiveTabOrInject(msg: Msg) {
  try {
    const s = await getSettings()
    cachedPlaybackRate = clampPlaybackRate(s.rate, cachedPlaybackRate)
    let textArg: string | null = null
    if (msg.kind === 'READ_TEXT') textArg = msg.text
    else {
      const tab = await requireActivePlaybackTab()
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

    const tab = await requireActivePlaybackTab()
    await cancelPlaybackSession(activeSession)
    const session = createPlaybackSession(tab.id, splitTextIntoChunks(textArg, MAX_CHUNK_CHARS))
    activeSession = session
    await processChunksSequentially(session, s.voice)
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
        const state = activeSession ? (activeSession.cancelRequested ? 'cancelled' : activeSession.paused ? 'paused' : 'playing') : 'idle'
        sendResponse({ ok: true, state, current: activeSession ? activeSession.currentIndex + 1 : 0, total: activeSession ? activeSession.chunks.length : 0 })
        return true
      }
      if (anyReq.action === 'cancel-speech' || anyReq.kind === 'cancel-speech') {
        ;(async () => {
          if (activeSession) {
            await cancelPlaybackSession(activeSession)
            return
          }
          try {
            const tabId = (await getActiveHttpTab())?.id
            if (tabId) await chrome.tabs.sendMessage(tabId, { kind: 'STOP_SPEECH' })
          } catch (err) {
            void err
          }
        })()
        sendResponse({ ok: true })
        return true
      }
      if (anyReq.action === 'pause-speech' || anyReq.kind === 'pause-speech') {
        ;(async () => {
          try {
            if (activeSession) activeSession.paused = true
            const tabId = activeSession?.tabId ?? (await getActiveHttpTab())?.id
            if (tabId) await chrome.tabs.sendMessage(tabId, { kind: 'PAUSE_SPEECH' })
          } catch (e) { void e }
        })()
        sendResponse({ ok: true })
        return true
      }
      if (anyReq.action === 'resume-speech' || anyReq.kind === 'resume-speech') {
        ;(async () => {
          try {
            if (activeSession) activeSession.paused = false
            const tabId = activeSession?.tabId ?? (await getActiveHttpTab())?.id
            if (tabId) await chrome.tabs.sendMessage(tabId, { kind: 'RESUME_SPEECH' })
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
          cachedPlaybackRate = clampPlaybackRate(s.rate, cachedPlaybackRate)
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
    if (command === 'pause-speech') {
      if (activeSession) activeSession.paused = true
      const tabId = activeSession?.tabId ?? (await getActiveHttpTab())?.id
      try { if (tabId) await chrome.tabs.sendMessage(tabId, { kind: 'PAUSE_SPEECH' }) } catch (e) { void e }
      return
    }
    if (command === 'resume-speech') {
      if (activeSession) activeSession.paused = false
      const tabId = activeSession?.tabId ?? (await getActiveHttpTab())?.id
      try { if (tabId) await chrome.tabs.sendMessage(tabId, { kind: 'RESUME_SPEECH' }) } catch (e) { void e }
      return
    }
    if (command === 'cancel-speech') {
      if (activeSession) {
        activeSession.paused = false
        await cancelPlaybackSession(activeSession)
        return
      }
      const tabId = (await getActiveHttpTab())?.id
      try { if (tabId) await chrome.tabs.sendMessage(tabId, { kind: 'STOP_SPEECH' }) } catch (e) { void e }
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
        cachedPlaybackRate = clampPlaybackRate(s.rate, cachedPlaybackRate)
        if (!s.ttsUrl) {
          sendResponse({ ok: false, error: 'no ttsUrl configured' })
          return
        }
        try {
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
        cachedPlaybackRate = clampPlaybackRate(s.rate, cachedPlaybackRate)
        if (!s.ttsUrl) {
          sendResponse({ ok: false, error: 'no ttsUrl configured' })
          return
        }
        try {
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
              await chrome.tabs.sendMessage(tab.id, { kind: 'PLAY_AUDIO', audio: buf, mime: contentType, rate: getCurrentPlaybackRate() })
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
        cachedPlaybackRate = clampPlaybackRate(s.rate, cachedPlaybackRate)
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
