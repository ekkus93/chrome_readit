import { isMsg, type Msg } from '../lib/messaging'
import {
  PLAYBACK_CONTROL,
  PLAYBACK_STATUS,
  START_PLAYBACK,
  createPlaybackError,
  isPlaybackControlRequest,
  isPlaybackControlResponse,
  isPlaybackEvent,
  isPlaybackStatus,
  isPlaybackStatusRequest,
  isStartPlaybackRequest,
  isStartPlaybackResponse,
  type PlaybackControlAction,
  type PlaybackControlResponse,
  type PlaybackEvent,
  type PlaybackSource,
  type PlaybackStatus,
  type StartPlaybackRequest,
  type StartPlaybackResponse,
} from '../lib/playback-protocol'
import { getSettings } from '../lib/storage'
import { deriveTtsSiblingUrl } from '../lib/tts-endpoints'

const UNSUPPORTED_PLAYBACK_ERROR = 'Playback not supported on this page'
const OFFSCREEN_DOCUMENT_PATH = 'src/offscreen.html'
const OFFSCREEN_JUSTIFICATION = 'Play selected text audio in an extension-owned document.'
const LAST_PLAYBACK_STATUS_KEY = 'readitLastPlaybackStatus'
const PROBE_TIMEOUT_MS = 5_000
const DIAGNOSTICS_ENABLED = typeof __READIT_E2E__ !== 'undefined' && __READIT_E2E__
const MAX_DIAGNOSTIC_EVENTS = 200
const DIAGNOSTICS_START_TIMEOUT_MS = 2_000

type ActivePlaybackStatus = PlaybackStatus & {
  sessionId: string
  requestId: string
  source: PlaybackSource
}

type PlayerDiagnosticsSnapshot = {
  activePlayerCount: number
  maxActivePlayerCount: number
  playAttemptCount: number
  successfulPlayStartCount: number
  settlementCount: number
  cleanupFailureCount: number
  lastCleanupFailureStage: string | null
  invariantViolationCount: number
}

let offscreenDocumentPromise: Promise<void> | null = null
let statusWriteChain: Promise<void> = Promise.resolve()
let latestQueuedStatus: PlaybackStatus | null = null
let persistenceDegraded = false
const diagnosticEvents: PlaybackEvent[] = []
let latestPlayerDiagnostics: PlayerDiagnosticsSnapshot | null = null
const diagnosticSnapshotWaiters = new Set<() => void>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isPlayerDiagnostics(value: unknown): value is PlayerDiagnosticsSnapshot {
  if (!isRecord(value)) return false
  return isNonNegativeInteger(value.activePlayerCount)
    && isNonNegativeInteger(value.maxActivePlayerCount)
    && isNonNegativeInteger(value.playAttemptCount)
    && isNonNegativeInteger(value.successfulPlayStartCount)
    && isNonNegativeInteger(value.settlementCount)
    && isNonNegativeInteger(value.cleanupFailureCount)
    && (value.lastCleanupFailureStage === null || typeof value.lastCleanupFailureStage === 'string')
    && isNonNegativeInteger(value.invariantViolationCount)
}

function recordPlayerDiagnostics(value: unknown): void {
  if (!isPlayerDiagnostics(value)) return
  latestPlayerDiagnostics = value
  for (const notify of [...diagnosticSnapshotWaiters]) notify()
}

function waitForInitialDiagnostics(timeoutMs = DIAGNOSTICS_START_TIMEOUT_MS): Promise<boolean> {
  if (latestPlayerDiagnostics) return Promise.resolve(true)
  return new Promise((resolve) => {
    const onSnapshot = () => {
      clearTimeout(timeoutId)
      diagnosticSnapshotWaiters.delete(onSnapshot)
      resolve(true)
    }
    const timeoutId = setTimeout(() => {
      diagnosticSnapshotWaiters.delete(onSnapshot)
      resolve(false)
    }, timeoutMs)
    diagnosticSnapshotWaiters.add(onSnapshot)
  })
}

function isTerminalStatus(status: PlaybackStatus): boolean {
  return ['idle', 'completed', 'cancelled', 'failed'].includes(status.state)
}

function isActivePlaybackStatus(status: PlaybackStatus | null): status is ActivePlaybackStatus {
  return status !== null
    && status.sessionId !== null
    && status.requestId !== null
    && status.source !== null
    && !isTerminalStatus(status)
}

function withPersistenceState(status: PlaybackStatus): PlaybackStatus {
  return persistenceDegraded ? { ...status, persistenceDegraded: true } : status
}

function interruptedPlaybackStatus(previous: ActivePlaybackStatus, message: string): PlaybackStatus {
  return {
    ...previous,
    sequence: previous.sequence + 1,
    state: 'failed',
    persistenceDegraded,
    error: createPlaybackError('OFFSCREEN_INTERRUPTED', message),
  }
}

function shouldAcceptStatus(current: PlaybackStatus | null, candidate: PlaybackStatus): boolean {
  if (!current) return true
  if (current.sessionId === candidate.sessionId) return candidate.sequence > current.sequence
  if (candidate.state === 'starting') return true
  if (isActivePlaybackStatus(current)) return false
  return true
}

async function readLastPlaybackStatus(): Promise<PlaybackStatus | null> {
  const storage = chrome.storage?.session
  if (!storage) {
    persistenceDegraded = true
    return latestQueuedStatus
  }
  try {
    const stored = await storage.get(LAST_PLAYBACK_STATUS_KEY)
    const candidate = stored[LAST_PLAYBACK_STATUS_KEY]
    if (isPlaybackStatus(candidate) && shouldAcceptStatus(latestQueuedStatus, candidate)) {
      latestQueuedStatus = candidate
    }
    persistenceDegraded = false
    return latestQueuedStatus
  } catch {
    persistenceDegraded = true
    console.warn('[readit] durable playback status read failed')
    return latestQueuedStatus
  }
}

function writeLastPlaybackStatus(status: PlaybackStatus): Promise<void> {
  if (!shouldAcceptStatus(latestQueuedStatus, status)) return statusWriteChain
  latestQueuedStatus = status
  statusWriteChain = statusWriteChain.then(async () => {
    const storage = chrome.storage?.session
    if (!storage) {
      persistenceDegraded = true
      return
    }
    try {
      await storage.set({ [LAST_PLAYBACK_STATUS_KEY]: status })
      persistenceDegraded = false
    } catch {
      persistenceDegraded = true
      console.warn('[readit] durable playback status write failed')
    }
  })
  return statusWriteChain
}

async function getActiveHttpTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab?.id || !tab.url || !/^https?:|^file:/.test(tab.url)) return null
  return tab
}

async function captureSelection(tab: chrome.tabs.Tab): Promise<string> {
  if (!tab.id) throw new Error(UNSUPPORTED_PLAYBACK_ERROR)
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: () => window.getSelection?.()?.toString() ?? '',
  })
  const result = Array.isArray(results) ? results[0]?.result : undefined
  return typeof result === 'string' ? result.trim() : ''
}

async function hasOffscreenPlaybackDocument(): Promise<boolean> {
  const runtimeApi = chrome.runtime as typeof chrome.runtime & {
    getContexts?: (filter: { contextTypes: string[]; documentUrls: string[] }) => Promise<unknown[]>
  }
  if (typeof runtimeApi.getContexts === 'function') {
    const contexts = await runtimeApi.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
    })
    return contexts.length > 0
  }

  const offscreenApi = chrome.offscreen as typeof chrome.offscreen & {
    hasDocument?: () => Promise<boolean>
  }
  if (typeof offscreenApi?.hasDocument === 'function') return await offscreenApi.hasDocument()
  throw new Error('OFFSCREEN_UNSUPPORTED')
}

async function ensureOffscreenPlaybackDocument(): Promise<void> {
  if (!chrome.offscreen?.createDocument) throw new Error('OFFSCREEN_UNSUPPORTED')
  if (await hasOffscreenPlaybackDocument()) return
  if (offscreenDocumentPromise) return await offscreenDocumentPromise

  offscreenDocumentPromise = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: OFFSCREEN_JUSTIFICATION,
  }).finally(() => {
    offscreenDocumentPromise = null
  })
  await offscreenDocumentPromise
}

async function sendToOffscreen(message: unknown): Promise<unknown> {
  await ensureOffscreenPlaybackDocument()
  return await chrome.runtime.sendMessage(message)
}

function offscreenTransportError(error: unknown) {
  const unsupported = error instanceof Error && error.message === 'OFFSCREEN_UNSUPPORTED'
  return createPlaybackError(
    unsupported ? 'OFFSCREEN_UNSUPPORTED' : 'OFFSCREEN_INTERRUPTED',
    unsupported
      ? 'This Chrome version does not provide the required offscreen playback APIs.'
      : 'The offscreen playback document could not be reached.',
  )
}

async function forwardStartRequest(request: StartPlaybackRequest): Promise<StartPlaybackResponse> {
  try {
    const response = await sendToOffscreen(request)
    return isStartPlaybackResponse(response)
      ? response
      : {
          ok: false,
          accepted: false,
          requestId: request.requestId,
          error: createPlaybackError('OFFSCREEN_INTERRUPTED', 'The offscreen document returned an invalid start response.'),
        }
  } catch (error) {
    console.warn('[readit] offscreen playback start transport failed')
    return {
      ok: false,
      accepted: false,
      requestId: request.requestId,
      error: offscreenTransportError(error),
    }
  }
}

async function startPlayback(text: string, source: PlaybackSource): Promise<StartPlaybackResponse> {
  const normalizedText = text.trim()
  if (!normalizedText) {
    return { ok: false, accepted: false, error: createPlaybackError('NO_TEXT', 'No text was provided for playback.') }
  }
  try {
    const settings = await getSettings()
    return await forwardStartRequest({
      kind: START_PLAYBACK,
      requestId: crypto.randomUUID(),
      source,
      text: normalizedText,
      settings: { ttsUrl: settings.ttsUrl, voice: settings.voice, rate: settings.rate },
    })
  } catch {
    console.warn('[readit] playback settings could not be loaded')
    return {
      ok: false,
      accepted: false,
      error: createPlaybackError('INTERNAL_PLAYBACK_ERROR', 'Playback settings could not be loaded.'),
    }
  }
}

export async function sendToActiveTabOrInject(message: Msg): Promise<StartPlaybackResponse> {
  if (message.kind === 'READ_TEXT') return await startPlayback(message.text, message.source)
  try {
    const tab = await getActiveHttpTab()
    if (!tab) {
      return { ok: false, accepted: false, error: createPlaybackError('INVALID_REQUEST', UNSUPPORTED_PLAYBACK_ERROR) }
    }
    const selection = await captureSelection(tab)
    if (!selection) {
      return { ok: false, accepted: false, error: createPlaybackError('NO_TEXT', 'No selected text was found on the active page.') }
    }
    return await startPlayback(selection, 'selection')
  } catch {
    console.warn('[readit] selection capture failed')
    return {
      ok: false,
      accepted: false,
      error: createPlaybackError('INVALID_REQUEST', 'Failed to capture the selected text.'),
    }
  }
}

async function routeControl(action: PlaybackControlAction, expectedSessionId?: string): Promise<PlaybackControlResponse> {
  const previousStatus = await readLastPlaybackStatus()
  try {
    const response = await sendToOffscreen({
      kind: PLAYBACK_CONTROL,
      action,
      ...(expectedSessionId ? { expectedSessionId } : {}),
    })
    if (isPlaybackControlResponse(response)) {
      if (!response.ok && response.error.code === 'SESSION_NOT_FOUND' && isActivePlaybackStatus(previousStatus)) {
        const interrupted = interruptedPlaybackStatus(previousStatus, 'The offscreen document was destroyed before control completed.')
        await writeLastPlaybackStatus(interrupted)
        return { ok: false, error: interrupted.error! }
      }
      return response
    }
    return {
      ok: false,
      error: createPlaybackError('OFFSCREEN_INTERRUPTED', 'The offscreen document returned an invalid control response.'),
    }
  } catch (error) {
    if (isActivePlaybackStatus(previousStatus)) {
      const interrupted = interruptedPlaybackStatus(previousStatus, 'Playback control failed after offscreen interruption.')
      await writeLastPlaybackStatus(interrupted)
      return { ok: false, error: interrupted.error! }
    }
    return { ok: false, error: offscreenTransportError(error) }
  }
}

function unavailablePlaybackStatus(message: string, sequence = 0): PlaybackStatus {
  return {
    kind: PLAYBACK_STATUS,
    sequence,
    state: 'failed',
    sessionId: null,
    requestId: null,
    source: null,
    currentChunk: 0,
    totalChunks: 0,
    currentParagraph: 0,
    totalParagraphs: 0,
    persistenceDegraded,
    error: createPlaybackError('OFFSCREEN_INTERRUPTED', message),
  }
}

async function queryPlaybackStatus(): Promise<PlaybackStatus> {
  const previousStatus = await readLastPlaybackStatus()
  try {
    const response = await sendToOffscreen({ kind: PLAYBACK_STATUS })
    if (!isPlaybackStatus(response)) {
      return unavailablePlaybackStatus('The offscreen document returned an invalid status response.', (previousStatus?.sequence ?? 0) + 1)
    }
    if (response.state === 'idle' && isActivePlaybackStatus(previousStatus)) {
      const interrupted = interruptedPlaybackStatus(previousStatus, 'The active offscreen document was destroyed.')
      await writeLastPlaybackStatus(interrupted)
      return withPersistenceState(interrupted)
    }
    await writeLastPlaybackStatus(response)
    return withPersistenceState(response)
  } catch (error) {
    console.warn('[readit] playback status query failed')
    if (isActivePlaybackStatus(previousStatus)) {
      const interrupted = interruptedPlaybackStatus(previousStatus, 'The active offscreen document was interrupted.')
      await writeLastPlaybackStatus(interrupted)
      return withPersistenceState(interrupted)
    }
    const transport = offscreenTransportError(error)
    return { ...unavailablePlaybackStatus(transport.message, (previousStatus?.sequence ?? 0) + 1), error: transport }
  }
}

async function queryPlaybackDiagnostics() {
  try {
    await ensureOffscreenPlaybackDocument()
    await waitForInitialDiagnostics()
  } catch (error) {
    return { ok: false as const, error: offscreenTransportError(error).message }
  }
  return latestPlayerDiagnostics
    ? {
        ok: true as const,
        status: latestQueuedStatus,
        events: [...diagnosticEvents],
        player: { ...latestPlayerDiagnostics },
      }
    : { ok: false as const, error: 'No playback diagnostics were published before the bounded startup deadline.' }
}

export const deriveApiSiblingUrl = deriveTtsSiblingUrl

async function probeTtsServer(): Promise<{ ok: boolean; status?: number; error?: string }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const settings = await getSettings()
    const readyUrl = deriveTtsSiblingUrl(settings.ttsUrl, 'ready')
    if (!readyUrl) return { ok: false, error: 'The configured TTS URL is invalid.' }
    const response = await fetch(readyUrl, { method: 'GET', signal: controller.signal })
    return { ok: response.ok, status: response.status }
  } catch {
    return {
      ok: false,
      error: controller.signal.aborted ? 'The TTS readiness probe timed out.' : 'The TTS readiness probe failed.',
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isPlaybackEvent(message)) {
    if (DIAGNOSTICS_ENABLED) {
      diagnosticEvents.push(message)
      if (diagnosticEvents.length > MAX_DIAGNOSTIC_EVENTS) {
        diagnosticEvents.splice(0, diagnosticEvents.length - MAX_DIAGNOSTIC_EVENTS)
      }
      recordPlayerDiagnostics((message as PlaybackEvent & { player?: unknown }).player)
    }
    void writeLastPlaybackStatus(message.status)
    return false
  }
  if (isStartPlaybackRequest(message)) {
    void forwardStartRequest(message).then(sendResponse)
    return true
  }
  if (isPlaybackControlRequest(message)) {
    void routeControl(message.action, message.expectedSessionId).then(sendResponse)
    return true
  }
  if (isPlaybackStatusRequest(message)) {
    void queryPlaybackStatus().then(sendResponse)
    return true
  }
  if (DIAGNOSTICS_ENABLED && isRecord(message) && message.kind === 'PLAYBACK_DIAGNOSTICS') {
    void queryPlaybackDiagnostics().then(sendResponse)
    return true
  }
  if (isMsg(message)) {
    void sendToActiveTabOrInject(message).then(sendResponse)
    return true
  }
  if (isRecord(message) && message.kind === 'READ_TEXT') {
    sendResponse({
      ok: false,
      accepted: false,
      error: createPlaybackError('INVALID_REQUEST', 'READ_TEXT requires text and an explicit playback source.'),
    })
    return true
  }
  if (isRecord(message) && (message.action === 'probe-tts' || message.kind === 'probe-tts' || message.kind === 'TEST_TTS')) {
    void probeTtsServer().then(sendResponse)
    return true
  }
  return false
})

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'read-selection') await sendToActiveTabOrInject({ kind: 'READ_SELECTION' })
  if (command === 'pause-speech') await routeControl('pause')
  if (command === 'resume-speech') await routeControl('resume')
  if (command === 'cancel-speech') await routeControl('cancel')
})

chrome.runtime.onInstalled.addListener(() => {
  if (!chrome.contextMenus) return
  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError
    chrome.contextMenus.create({ id: 'read-selection', title: 'Read selection aloud', contexts: ['selection'] })
  })
})

chrome.contextMenus?.onClicked?.addListener(async (info) => {
  if (info.menuItemId !== 'read-selection') return
  const selectionText = typeof info.selectionText === 'string' ? info.selectionText.trim() : ''
  if (selectionText) await startPlayback(selectionText, 'selection')
  else await sendToActiveTabOrInject({ kind: 'READ_SELECTION' })
})

export const __testing = {
  ensureOffscreenPlaybackDocument,
  queryPlaybackDiagnostics,
  queryPlaybackStatus,
  routeControl,
  readLastPlaybackStatus,
  writeLastPlaybackStatus,
  shouldAcceptStatus,
}
