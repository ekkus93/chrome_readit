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
  isPlaybackControlResponse,
  isPlaybackEvent,
  isPlaybackStatus,
  isStartPlaybackResponse,
  type PlaybackControlAction,
  type PlaybackControlResponse,
  type PlaybackSource,
  type PlaybackStatus,
  type StartPlaybackResponse,
} from '../lib/playback-protocol'
import { getSettings } from '../lib/storage'

const UNSUPPORTED_PLAYBACK_ERROR = 'Playback not supported on this page'
const OFFSCREEN_DOCUMENT_PATH = 'src/offscreen.html'
const OFFSCREEN_JUSTIFICATION = 'Play selected text audio in an extension-owned document.'
const LAST_PLAYBACK_STATUS_KEY = 'readitLastPlaybackStatus'

let offscreenDocumentPromise: Promise<void> | null = null
let offscreenDocumentKnown = false

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isActivePlaybackStatus(status: PlaybackStatus | null): status is PlaybackStatus {
  return status !== null
    && status.sessionId !== null
    && status.state !== 'idle'
    && status.state !== 'completed'
    && status.state !== 'cancelled'
    && status.state !== 'failed'
}

function interruptedPlaybackStatus(previous: PlaybackStatus, message: string): PlaybackStatus {
  return {
    ...previous,
    state: 'failed',
    error: createPlaybackError('OFFSCREEN_INTERRUPTED', message),
  }
}

async function readLastPlaybackStatus(): Promise<PlaybackStatus | null> {
  const sessionStorage = chrome.storage?.session
  if (!sessionStorage) return null
  try {
    const stored = await sessionStorage.get(LAST_PLAYBACK_STATUS_KEY)
    const status = stored[LAST_PLAYBACK_STATUS_KEY]
    return isPlaybackStatus(status) ? status : null
  } catch (error) {
    console.warn('[readit] failed to read durable playback status', error)
    return null
  }
}

async function writeLastPlaybackStatus(status: PlaybackStatus): Promise<void> {
  const sessionStorage = chrome.storage?.session
  if (!sessionStorage) return
  try {
    await sessionStorage.set({ [LAST_PLAYBACK_STATUS_KEY]: status })
  } catch (error) {
    console.warn('[readit] failed to persist playback status', error)
  }
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
  return offscreenDocumentKnown
}

async function ensureOffscreenPlaybackDocument(): Promise<void> {
  if (!chrome.offscreen?.createDocument) throw new Error('Chrome offscreen documents are unavailable.')
  if (await hasOffscreenPlaybackDocument()) {
    offscreenDocumentKnown = true
    return
  }
  if (offscreenDocumentPromise) return await offscreenDocumentPromise

  offscreenDocumentPromise = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: OFFSCREEN_JUSTIFICATION,
  }).then(() => {
    offscreenDocumentKnown = true
  }).finally(() => {
    offscreenDocumentPromise = null
  })

  await offscreenDocumentPromise
}

async function sendToOffscreen(message: unknown): Promise<unknown> {
  await ensureOffscreenPlaybackDocument()
  try {
    return await chrome.runtime.sendMessage(message)
  } catch (error) {
    offscreenDocumentKnown = false
    throw error
  }
}

function invalidOffscreenResponse(message: string): StartPlaybackResponse {
  return {
    ok: false,
    accepted: false,
    error: createPlaybackError('OFFSCREEN_INTERRUPTED', message),
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
    const requestId = crypto.randomUUID()
    const response = await sendToOffscreen({
      kind: START_PLAYBACK,
      requestId,
      source,
      text: normalizedText,
      settings: {
        ttsUrl: settings.ttsUrl,
        voice: settings.voice,
        rate: settings.rate,
      },
    })
    return isStartPlaybackResponse(response)
      ? response
      : invalidOffscreenResponse('The offscreen playback document returned an invalid start response.')
  } catch (error) {
    console.warn('[readit] failed to start offscreen playback', error)
    return invalidOffscreenResponse(`Unable to start offscreen playback: ${String(error)}`)
  }
}

export async function sendToActiveTabOrInject(message: Msg): Promise<StartPlaybackResponse> {
  if (message.kind === 'READ_TEXT') {
    return await startPlayback(message.text, message.source ?? 'debug-fixture')
  }

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
  } catch (error) {
    console.warn('[readit] selection capture failed', error)
    return {
      ok: false,
      accepted: false,
      error: createPlaybackError('INVALID_REQUEST', `Failed to capture selection: ${String(error)}`),
    }
  }
}

async function routeControl(action: PlaybackControlAction): Promise<PlaybackControlResponse> {
  const previousStatus = await readLastPlaybackStatus()
  try {
    const response = await sendToOffscreen({ kind: PLAYBACK_CONTROL, action })
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
        `Playback control failed after the offscreen document was interrupted: ${String(error)}`,
      )
      await writeLastPlaybackStatus(interrupted)
      return { ok: false, error: interrupted.error! }
    }
    return {
      ok: false,
      error: createPlaybackError('OFFSCREEN_INTERRUPTED', `Playback control failed: ${String(error)}`),
    }
  }
}

function unavailablePlaybackStatus(message: string): PlaybackStatus {
  return {
    kind: PLAYBACK_STATUS,
    state: 'idle',
    sessionId: null,
    requestId: null,
    source: null,
    currentChunk: 0,
    totalChunks: 0,
    currentParagraph: 0,
    totalParagraphs: 0,
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
        return interrupted
      }
      await writeLastPlaybackStatus(response)
      return response
    }
  } catch (error) {
    console.warn('[readit] playback status query failed', error)
    if (isActivePlaybackStatus(previousStatus)) {
      const interrupted = interruptedPlaybackStatus(
        previousStatus,
        `The active offscreen playback document was interrupted: ${String(error)}`,
      )
      await writeLastPlaybackStatus(interrupted)
      return interrupted
    }
  }
  return unavailablePlaybackStatus('Playback status is unavailable.')
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
  try {
    const settings = await getSettings()
    const readyUrl = deriveApiSiblingUrl(settings.ttsUrl, 'ready')
    if (!readyUrl) return { ok: false, error: 'invalid ttsUrl' }
    const response = await fetch(readyUrl, { method: 'GET' })
    return { ok: response.ok, status: response.status }
  } catch (error) {
    return { ok: false, error: String(error) }
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

  if (isMsg(message)) {
    void sendToActiveTabOrInject(message).then(sendResponse)
    return true
  }

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
}
