import {
  isLegacyPlaybackControlRequest,
  isMsg,
  type LegacyPlaybackControlRequest,
  type Msg,
} from '../lib/messaging'
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
  type PlaybackSource,
  type PlaybackStatus,
  type StartPlaybackRequest,
  type StartPlaybackResponse,
} from '../lib/playback-protocol'
import { getSettings } from '../lib/storage'

const UNSUPPORTED_PLAYBACK_ERROR = 'Playback not supported on this page'
const OFFSCREEN_DOCUMENT_PATH = 'src/offscreen.html'
const OFFSCREEN_JUSTIFICATION = 'Play selected text audio in an extension-owned document.'
const LAST_PLAYBACK_STATUS_KEY = 'readitLastPlaybackStatus'
const PROBE_TIMEOUT_MS = 5_000

let offscreenDocumentPromise: Promise<void> | null = null
let statusWriteChain: Promise<void> = Promise.resolve()
let latestQueuedStatus: PlaybackStatus | null = null
let persistenceDegraded = false

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTerminalState(status: PlaybackStatus): boolean {
  return status.state === 'completed' || status.state === 'cancelled' || status.state === 'failed' || status.state === 'idle'
}

function isActivePlaybackStatus(status: PlaybackStatus | null): status is PlaybackStatus {
  return status !== null
    && status.sessionId !== null
    && !isTerminalState(status)
}

function withPersistenceState(status: PlaybackStatus): PlaybackStatus {
  return persistenceDegraded ? { ...status, persistenceDegraded: true } : status
}

function interruptedPlaybackStatus(previous: PlaybackStatus, message: string): PlaybackStatus {
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

  // A starting state is the coordinator's authoritative acceptance of a new
  // session, including after an offscreen-document recreation where sequence
  // numbering starts over.
  if (candidate.state === 'starting') return true

  // Never let a late terminal record from an older session replace a newer
  // active session.
  if (isActivePlaybackStatus(current)) return false
  return true
}

async function readLastPlaybackStatus(): Promise<PlaybackStatus | null> {
  const sessionStorage = chrome.storage?.session
  if (!sessionStorage) {
    persistenceDegraded = true
    return latestQueuedStatus
  }
  try {
    const stored = await sessionStorage.get(LAST_PLAYBACK_STATUS_KEY)
    const status = stored[LAST_PLAYBACK_STATUS_KEY]
    const validated = isPlaybackStatus(status) ? status : null
    if (validated && shouldAcceptStatus(latestQueuedStatus, validated)) latestQueuedStatus = validated
    persistenceDegraded = false
    return latestQueuedStatus ?? validated
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
    const sessionStorage = chrome.storage?.session
    if (!sessionStorage) {
      persistenceDegraded = true
      return
    }
    try {
      await sessionStorage.set({ [LAST_PLAYBACK_STATUS_KEY]: status })
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
    getContexts?: (filter: {
      contextTypes: string[]
      documentUrls: string[]
    }) => Promise<unknown[]>
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

function invalidOffscreenResponse(message: string, requestId?: string): StartPlaybackResponse {
  return {
    ok: false,
    accepted: false,
    ...(requestId ? { requestId } : {}),
    error: createPlaybackError('OFFSCREEN_INTERRUPTED', message),
  }
}

function offscreenTransportError(error: unknown): ReturnType<typeof createPlaybackError> {
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
      : invalidOffscreenResponse('The offscreen playback document returned an invalid start response.', request.requestId)
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
    return {
      ok: false,
      accepted: false,
      error: createPlaybackError('NO_TEXT', 'No text was provided for playback.'),
    }
  }

  try {
    const settings = await getSettings()
    return await forwardStartRequest({
      kind: START_PLAYBACK,
      requestId: crypto.randomUUID(),
      source,
      text: normalizedText,
      settings: {
        ttsUrl: settings.ttsUrl,
        voice: settings.voice,
        rate: settings.rate,
      },
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
      return {
        ok: false,
        accepted: false,
        error: createPlaybackError('INVALID_REQUEST', UNSUPPORTED_PLAYBACK_ERROR),
      }
    }
    const selection = await captureSelection(tab)
    if (!selection) {
      return {
        ok: false,
        accepted: false,
        error: createPlaybackError('NO_TEXT', 'No selected text was found on the active page.'),
      }
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

async function routeControl(
  action: PlaybackControlAction,
  expectedSessionId?: string,
): Promise<PlaybackControlResponse> {
  const previousStatus = await readLastPlaybackStatus()
  try {
    const response = await sendToOffscreen({ kind: PLAYBACK_CONTROL, action, expectedSessionId })
    if (isPlaybackControlResponse(response)) {
      if (!response.ok && response.error.code === 'SESSION_NOT_FOUND' && isActivePlaybackStatus(previousStatus)) {
        const interrupted = interruptedPlaybackStatus(
          previousStatus,
          'The offscreen playback document was destroyed before the control request completed.',
        )
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
      const interrupted = interruptedPlaybackStatus(
        previousStatus,
        'Playback control failed after the offscreen document was interrupted.',
      )
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
    if (isPlaybackStatus(response)) {
      if (response.state === 'idle' && isActivePlaybackStatus(previousStatus)) {
        const interrupted = interruptedPlaybackStatus(
          previousStatus,
          'The active offscreen playback document was destroyed. Start a new reading to continue.',
        )
        await writeLastPlaybackStatus(interrupted)
        return withPersistenceState(interrupted)
      }
      await writeLastPlaybackStatus(response)
      return withPersistenceState(response)
    }
    return unavailablePlaybackStatus(
      'The offscreen playback document returned an invalid status response.',
      (previousStatus?.sequence ?? 0) + 1,
    )
  } catch (error) {
    console.warn('[readit] playback status query failed')
    if (isActivePlaybackStatus(previousStatus)) {
      const interrupted = interruptedPlaybackStatus(
        previousStatus,
        'The active offscreen playback document was interrupted.',
      )
      await writeLastPlaybackStatus(interrupted)
      return withPersistenceState(interrupted)
    }
    const transport = offscreenTransportError(error)
    return {
      ...unavailablePlaybackStatus(transport.message, (previousStatus?.sequence ?? 0) + 1),
      error: transport,
    }
  }
}

export function deriveApiSiblingUrl(ttsUrl: string, sibling: 'ping' | 'ready' | 'voices'): string | null {
  try {
    const url = new URL(ttsUrl)
    const pathname = url.pathname.replace(/\/+$/, '')
    url.pathname = pathname.endsWith('/api/tts')
      ? `${pathname.slice(0, -'/tts'.length)}/${sibling}`
      : `${pathname}/${sibling}`
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

async function probeTtsServer(): Promise<{ ok: boolean; status?: number; error?: string }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const settings = await getSettings()
    const readyUrl = deriveApiSiblingUrl(settings.ttsUrl, 'ready')
    if (!readyUrl) return { ok: false, error: 'The configured TTS URL is invalid.' }
    const response = await fetch(readyUrl, { method: 'GET', signal: controller.signal })
    return { ok: response.ok, status: response.status }
  } catch (error) {
    return {
      ok: false,
      error: controller.signal.aborted ? 'The TTS readiness probe timed out.' : 'The TTS readiness probe failed.',
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

function actionForLegacyControl(message: LegacyPlaybackControlRequest): PlaybackControlAction | null {
  if (message.kind === 'PAUSE_SPEECH') return 'pause'
  if (message.kind === 'RESUME_SPEECH') return 'resume'
  if (message.kind === 'CANCEL_SPEECH') return 'cancel'
  return null
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isPlaybackEvent(message)) {
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

  // Temporary compatibility adapter. Popup and Options are migrated to the
  // shared protocol in FIX2; keyboard commands are direct coordinator routes.
  if (isLegacyPlaybackControlRequest(message)) {
    if (message.kind === 'SPEECH_STATUS') void queryPlaybackStatus().then(sendResponse)
    else {
      const action = actionForLegacyControl(message)
      if (action) void routeControl(action).then(sendResponse)
    }
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
    chrome.contextMenus.create({
      id: 'read-selection',
      title: 'Read selection aloud',
      contexts: ['selection'],
    })
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
  deriveApiSiblingUrl,
  queryPlaybackStatus,
  routeControl,
  readLastPlaybackStatus,
  writeLastPlaybackStatus,
  shouldAcceptStatus,
}
