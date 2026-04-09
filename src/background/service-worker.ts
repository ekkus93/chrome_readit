import type { Msg } from '../lib/messaging'
import { encodeArrayBufferToBase64 } from '../lib/base64'
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

const DEBUG = Boolean(import.meta.env.DEV) && import.meta.env.MODE !== 'test'

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

function isControlRequest(anyReq: Record<string, unknown>, kind: 'SPEECH_STATUS' | 'CANCEL_SPEECH' | 'PAUSE_SPEECH' | 'RESUME_SPEECH'): boolean {
  return anyReq.kind === kind
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
    if (typeof changes.rate?.newValue === 'number') {
      cachedPlaybackRate = clampPlaybackRate(changes.rate.newValue, cachedPlaybackRate)
      return
    }
    const nextLegacySettings = changes.settings?.newValue
    if (nextLegacySettings && typeof nextLegacySettings === 'object' && 'rate' in nextLegacySettings) {
      cachedPlaybackRate = clampPlaybackRate((nextLegacySettings as Record<string, unknown>).rate, cachedPlaybackRate)
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

// Replace the background worker implementation with a chunking + queueing
// implementation that avoids splitting sentences where possible and supports
// pause/resume/cancel and a simple speech-status API for the popup.

const MAX_CHUNK_CHARS = 400
// Allow tests to override the chunk timeout via globalThis.__CHUNK_TIMEOUT_MS
const CHUNK_TIMEOUT_MS = ((globalThis as unknown as { __CHUNK_TIMEOUT_MS?: number }).__CHUNK_TIMEOUT_MS) ?? 60_000 // default 1 minute
const DEFAULT_CHUNK_GAP_MS = ((globalThis as unknown as { __CHUNK_GAP_MS?: number }).__CHUNK_GAP_MS) ?? 150
const PARAGRAPH_CHUNK_GAP_MS = ((globalThis as unknown as { __CHUNK_PARAGRAPH_GAP_MS?: number }).__CHUNK_PARAGRAPH_GAP_MS) ?? 700

type PlaybackTransition = 'sentence' | 'paragraph' | 'end'

type PlaybackChunk = {
  text: string
  paragraphIndex: number
  chunkIndexInParagraph: number
  transitionAfter: PlaybackTransition
}

type PlaybackSession = {
  id: number
  requestId: number
  tabId: number
  cancelRequested: boolean
  paused: boolean
  chunks: PlaybackChunk[]
  currentIndex: number
  fetchControllers: Set<AbortController>
}

type ReadPipelineResult = {
  ok: boolean
  error?: string
}

let nextSessionId = 1
let activeSession: PlaybackSession | null = null
let latestPlaybackRequestId = 0
let pendingPlaybackAck: {
  token: string
  resolve: (result: { ok: boolean; error?: string }) => void
  timeoutId: ReturnType<typeof setTimeout>
} | null = null

function clearPendingPlaybackAck(result: { ok: boolean; error?: string }): boolean {
  if (!pendingPlaybackAck) return false
  clearTimeout(pendingPlaybackAck.timeoutId)
  const { resolve } = pendingPlaybackAck
  pendingPlaybackAck = null
  resolve(result)
  return true
}

function isSessionActive(sessionId: number): boolean {
  return activeSession?.id === sessionId
}

function isLatestPlaybackRequest(requestId: number): boolean {
  return requestId === latestPlaybackRequestId
}

function createPlaybackSession(requestId: number, tabId: number, chunks: PlaybackChunk[]): PlaybackSession {
  return {
    id: nextSessionId++,
    requestId,
    tabId,
    cancelRequested: false,
    paused: false,
    chunks,
    currentIndex: 0,
    fetchControllers: new Set(),
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
  session.fetchControllers.forEach((controller) => controller.abort())
  session.fetchControllers.clear()
  if (isSessionActive(session.id)) activeSession = null
  if (pendingPlaybackAck?.token.startsWith(`${session.id}:`)) {
    clearTimeout(pendingPlaybackAck.timeoutId)
    const { resolve } = pendingPlaybackAck
    pendingPlaybackAck = null
    resolve({ ok: false, error: 'cancelled' })
  }
  await stopSessionPlayback(session.tabId)
}

function createPlaybackToken(sessionId: number, chunkIndex: number): string {
  return `${sessionId}:${chunkIndex}`
}

function resolvePendingPlaybackAck(token: string, result: { ok: boolean; error?: string }): boolean {
  if (!pendingPlaybackAck || pendingPlaybackAck.token !== token) return false
  return clearPendingPlaybackAck(result)
}

function waitForPlaybackAck(token: string): Promise<{ ok: boolean; error?: string }> {
  if (pendingPlaybackAck) {
    const staleToken = pendingPlaybackAck.token
    console.warn('[readit] replacing pending playback acknowledgement', { staleToken, nextToken: token })
    clearPendingPlaybackAck({ ok: false, error: `superseded by ${token}` })
  }

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      if (!pendingPlaybackAck || pendingPlaybackAck.token !== token) return
      pendingPlaybackAck = null
      resolve({ ok: false, error: 'playback acknowledgement timeout' })
    }, CHUNK_TIMEOUT_MS)

    pendingPlaybackAck = { token, resolve, timeoutId }
  })
}

export const __testing = {
  waitForPlaybackAck,
  resolvePendingPlaybackAck,
  splitTextIntoChunks,
  getGapAfterTransition,
  resetPlaybackAckState() {
    if (pendingPlaybackAck) {
      clearTimeout(pendingPlaybackAck.timeoutId)
      pendingPlaybackAck = null
    }
  },
}

function getGapAfterTransition(transitionAfter: PlaybackTransition): number {
  if (transitionAfter === 'paragraph') return PARAGRAPH_CHUNK_GAP_MS
  if (transitionAfter === 'sentence') return DEFAULT_CHUNK_GAP_MS
  return 0
}

function splitTextIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

function splitParagraphIntoChunkTexts(paragraph: string, maxLen = MAX_CHUNK_CHARS): string[] {
  const out: string[] = []
  let remaining = paragraph.trim()
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      out.push(remaining)
      break
    }
    const slice = remaining.slice(0, maxLen)
    const boundary = Math.max(slice.lastIndexOf('.'), slice.lastIndexOf('!'), slice.lastIndexOf('?'), slice.lastIndexOf(';'))
    let cut = boundary >= 0 ? boundary + 1 : boundary
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

function splitTextIntoChunks(text: string, maxLen = MAX_CHUNK_CHARS): PlaybackChunk[] {
  const paragraphs = splitTextIntoParagraphs(text)
  const out: PlaybackChunk[] = []

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const chunkTexts = splitParagraphIntoChunkTexts(paragraph, maxLen)
    chunkTexts.forEach((chunkText, chunkIndexInParagraph) => {
      const isLastChunkInParagraph = chunkIndexInParagraph === chunkTexts.length - 1
      const isLastParagraph = paragraphIndex === paragraphs.length - 1
      out.push({
        text: chunkText,
        paragraphIndex,
        chunkIndexInParagraph,
        transitionAfter: isLastChunkInParagraph
          ? (isLastParagraph ? 'end' : 'paragraph')
          : 'sentence',
      })
    })
  })

  return out
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === 'AbortError'
    : typeof err === 'object' && err !== null && 'name' in err && (err as { name?: unknown }).name === 'AbortError'
}

async function fetchTtsAudio(text: string, voice?: string, signal?: AbortSignal): Promise<{ b64: string; mime: string } | null> {
  const s = await getSettings()
  cachedPlaybackRate = clampPlaybackRate(s.rate, cachedPlaybackRate)
  if (!s.ttsUrl) return null
  try {
    const resp = await fetch(s.ttsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: voice ?? s.voice }),
      signal,
    })
    if (!resp.ok) return null
    const mime = resp.headers.get('content-type') || 'audio/wav'
    const buf = await resp.arrayBuffer()
    if (DEBUG) console.debug('[readit][DBG] fetchTtsAudio response', { mime, prefixHex: prefixHexFromBuffer(buf) })
    return { b64: encodeArrayBufferToBase64(buf), mime }
  } catch (err) {
    if (isAbortError(err)) return null
    console.warn('[readit] fetchTtsAudio failed', err)
    return null
  }
}

async function processChunksSequentially(session: PlaybackSession, voice?: string) {
  const sessionId = session.id
  const requestId = session.requestId
  const { tabId, chunks } = session

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const sessionCanContinue = () => isSessionActive(sessionId) && isLatestPlaybackRequest(requestId) && !session.cancelRequested
  const fetchChunkAudio = (text: string): Promise<{ b64: string; mime: string } | null> => {
    const controller = new AbortController()
    session.fetchControllers.add(controller)
    return fetchTtsAudio(text, voice, controller.signal).finally(() => {
      session.fetchControllers.delete(controller)
    })
  }
  const waitForChunkGap = async (gapMs: number): Promise<boolean> => {
    let remainingMs = gapMs
    while (remainingMs > 0) {
      if (!sessionCanContinue()) return false
      if (session.paused) return true
      const step = Math.min(25, remainingMs)
      await sleep(step)
      remainingMs -= step
    }
    return sessionCanContinue() || session.paused
  }

  try {
    let nextEntryPromise: Promise<{ b64: string; mime: string } | null> | null = fetchChunkAudio(chunks[0].text)

    for (let chunkIndex = 0; chunkIndex < chunks.length && sessionCanContinue(); chunkIndex += 1) {
      session.currentIndex = chunkIndex

      while (session.paused && sessionCanContinue()) await sleep(200)
      if (!sessionCanContinue()) break

      const entry = await nextEntryPromise
      if (!entry) {
        if (!sessionCanContinue() || session.cancelRequested) break
        console.warn('[readit] failed to fetch chunk', chunkIndex)
        session.cancelRequested = true
        break
      }
      if (!sessionCanContinue()) break

      nextEntryPromise = chunkIndex + 1 < chunks.length
        ? fetchChunkAudio(chunks[chunkIndex + 1].text)
        : null

      const chunk = chunks[chunkIndex]
      const playbackRate = getCurrentPlaybackRate()
      const playbackToken = createPlaybackToken(sessionId, chunkIndex)
      const ackPromise = waitForPlaybackAck(playbackToken)
      const gapAfterMs = getGapAfterTransition(chunk.transitionAfter)

      if (DEBUG) {
        console.debug('[readit][DBG] queue start chunk', {
          sessionId,
          requestId,
          chunkIndex,
          paragraphIndex: chunk.paragraphIndex,
          chunkIndexInParagraph: chunk.chunkIndexInParagraph,
          playbackToken,
          transitionAfter: chunk.transitionAfter,
          gapAfterMs,
        })
      }

      try {
        const sendResult = await sendTabMessageWithBootstrap(tabId, {
          kind: 'PLAY_AUDIO',
          audio: entry.b64,
          mime: entry.mime,
          rate: playbackRate,
          playbackToken,
        })

        if (sendResult && typeof sendResult === 'object' && sendResult !== null && 'ok' in (sendResult as Record<string, unknown>)) {
          const dispatchOk = Boolean((sendResult as Record<string, unknown>).ok)
          if (!dispatchOk) {
            resolvePendingPlaybackAck(playbackToken, {
              ok: false,
              error: typeof (sendResult as Record<string, unknown>).error === 'string'
                ? String((sendResult as Record<string, unknown>).error)
                : 'playback dispatch failed',
            })
          }
        }
      } catch (err) {
        resolvePendingPlaybackAck(playbackToken, { ok: false, error: String(err) })
      }

      const ack = await ackPromise
      if (DEBUG) {
        console.debug('[readit][DBG] queue finish chunk', {
          sessionId,
          requestId,
          chunkIndex,
          paragraphIndex: chunk.paragraphIndex,
          playbackToken,
          transitionAfter: chunk.transitionAfter,
          gapAfterMs,
          ok: ack.ok,
          error: ack.error,
        })
      }
      if (!ack.ok) {
        if (!session.cancelRequested) {
          console.warn('[readit] playback acknowledgement failed', ack.error)
          session.cancelRequested = true
        }
        break
      }

      if (chunkIndex + 1 < chunks.length) {
        const shouldContinue = await waitForChunkGap(gapAfterMs)
        if (!shouldContinue) break
      }
    }
  } catch (err) {
    console.warn('[readit] processChunksSequentially failed', err)
    session.cancelRequested = true
  }

  if (session.cancelRequested && isSessionActive(sessionId)) {
    await stopSessionPlayback(tabId)
  }
  finishPlaybackSession(sessionId)
}

export async function sendToActiveTabOrInject(msg: Msg): Promise<ReadPipelineResult> {
  try {
    const playbackRequestId = ++latestPlaybackRequestId
    const s = await getSettings()
    cachedPlaybackRate = clampPlaybackRate(s.rate, cachedPlaybackRate)
    let textArg: string | null = null
    let playbackTab: chrome.tabs.Tab | null = null
    if (msg.kind === 'READ_TEXT') textArg = msg.text
    else {
      try {
        playbackTab = await requireActivePlaybackTab()
      } catch (err) {
        const error = String(err)
        console.warn('[readit] read-selection failed', error)
        return { ok: false, error }
      }
      try {
        const r = await chrome.scripting.executeScript({ target: { tabId: playbackTab.id! }, world: 'MAIN', func: () => window.getSelection?.()?.toString().trim() ?? '' })
        if (Array.isArray(r) && r.length > 0) {
          const first = r[0] as unknown as Record<string, unknown>
          if ('result' in first) textArg = String(first.result ?? '')
        } else if (r && typeof r === 'object' && 'result' in (r as unknown as Record<string, unknown>)) {
          const obj = r as unknown as Record<string, unknown>
          textArg = String(obj.result ?? '')
        }
      } catch (err) {
        console.warn('[readit] executeScript failed', err)
        return { ok: false, error: `Failed to capture selection: ${String(err)}` }
      }
      if (DEBUG) console.debug('[readit][DBG] selection from tab', { tabId: playbackTab.id, tabUrl: playbackTab.url, textLength: textArg?.length ?? 0 })
    }
    const normalizedText = textArg?.trim() ?? ''
    if (!normalizedText) {
      return { ok: false, error: msg.kind === 'READ_SELECTION' ? 'No selected text on the active page.' : 'No text to read.' }
    }
    if (!s.ttsUrl) {
      return { ok: false, error: 'No TTS service URL is configured.' }
    }

    const tab = playbackTab ?? await requireActivePlaybackTab()
    if (playbackRequestId !== latestPlaybackRequestId) return { ok: false, error: 'Playback request was superseded.' }
    await cancelPlaybackSession(activeSession)
    if (playbackRequestId !== latestPlaybackRequestId) return { ok: false, error: 'Playback request was superseded.' }
    const session = createPlaybackSession(playbackRequestId, tab.id, splitTextIntoChunks(normalizedText, MAX_CHUNK_CHARS))
    activeSession = session
    await processChunksSequentially(session, s.voice)
    if (session.cancelRequested) {
      return { ok: false, error: 'Playback stopped before completion.' }
    }
    return { ok: true }
  } catch (err) {
    console.warn('[readit] sendToActiveTabOrInject failed', err)
    return { ok: false, error: String(err) }
  }
}

// Runtime message handlers: control the queue and expose status to the popup
chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  try {
    // Control messages come from extension UI contexts; playback messages
    // also arrive back from the content script with completion state.
    if (req && typeof req === 'object') {
        const anyReq = req as unknown as Record<string, unknown>
      if (isControlRequest(anyReq, 'SPEECH_STATUS')) {
        const state = activeSession ? (activeSession.cancelRequested ? 'cancelled' : activeSession.paused ? 'paused' : 'playing') : 'idle'
        sendResponse({ ok: true, state, current: activeSession ? activeSession.currentIndex + 1 : 0, total: activeSession ? activeSession.chunks.length : 0 })
        return true
      }
      if (isControlRequest(anyReq, 'CANCEL_SPEECH')) {
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
      if (isControlRequest(anyReq, 'PAUSE_SPEECH')) {
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
      if (isControlRequest(anyReq, 'RESUME_SPEECH')) {
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
      if (anyReq.kind === 'PLAYBACK_FINISHED' && typeof anyReq.playbackToken === 'string') {
        if (DEBUG) {
          console.debug('[readit][DBG] playback ack', {
            playbackToken: anyReq.playbackToken,
            ok: Boolean(anyReq.ok),
            error: typeof anyReq.error === 'string' ? anyReq.error : undefined,
          })
        }
        resolvePendingPlaybackAck(anyReq.playbackToken, {
          ok: Boolean(anyReq.ok),
          error: typeof anyReq.error === 'string' ? anyReq.error : undefined,
        })
        sendResponse({ ok: true })
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
  const wantsAsync = maybeAction === 'request-tts' || maybeAction === 'test-tts' || maybeKind === 'READ_SELECTION' || maybeKind === 'READ_TEXT'
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
          const result = m.kind === 'READ_TEXT'
            ? await sendToActiveTabOrInject({ kind: 'READ_TEXT', text: String(m.text ?? '') } as Msg)
            : await sendToActiveTabOrInject({ kind: 'READ_SELECTION' } as Msg)
          sendResponse(result)
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
          
          sendResponse({ ok: true, audio: encodeArrayBufferToBase64(buf), mime: contentType })
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
          if (DEBUG) console.debug('[readit][DBG] test-tts fetched', { contentType, prefixHex: prefixHexFromBuffer(buf) })
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
