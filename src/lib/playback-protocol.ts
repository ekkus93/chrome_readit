export const START_PLAYBACK = 'START_PLAYBACK' as const
export const PLAYBACK_CONTROL = 'PLAYBACK_CONTROL' as const
export const PLAYBACK_STATUS = 'PLAYBACK_STATUS' as const
export const PLAYBACK_EVENT = 'PLAYBACK_EVENT' as const

export type PlaybackSource = 'selection' | 'popup-test' | 'options-test' | 'debug-fixture'
export type PlaybackState = 'idle' | 'starting' | 'synthesizing' | 'playing' | 'paused' | 'waiting' | 'completed' | 'cancelled' | 'failed'
export type PlaybackControlAction = 'pause' | 'resume' | 'cancel'

export type PlaybackErrorCode =
  | 'INVALID_REQUEST'
  | 'NO_TEXT'
  | 'TEXT_TOO_LONG'
  | 'INVALID_TTS_URL'
  | 'HOST_PLAY_ENDPOINT_FORBIDDEN'
  | 'TTS_HTTP_ERROR'
  | 'TTS_NON_AUDIO_RESPONSE'
  | 'TTS_EMPTY_RESPONSE'
  | 'TTS_RESPONSE_TOO_LARGE'
  | 'TTS_FETCH_FAILED'
  | 'AUDIO_PLAYBACK_FAILED'
  | 'OFFSCREEN_INTERRUPTED'
  | 'SESSION_SUPERSEDED'
  | 'SESSION_NOT_FOUND'
  | 'CANCELLED'

export type PlaybackError = {
  code: PlaybackErrorCode
  message: string
  status?: number
}

export type PlaybackSettingsSnapshot = {
  ttsUrl: string
  voice: string
  rate: number
}

export type StartPlaybackRequest = {
  kind: typeof START_PLAYBACK
  requestId: string
  source: PlaybackSource
  text: string
  settings: PlaybackSettingsSnapshot
}

export type StartPlaybackResponse =
  | { ok: true; accepted: true; requestId: string; sessionId: string }
  | { ok: false; accepted: false; requestId?: string; error: PlaybackError }

export type PlaybackControlRequest = {
  kind: typeof PLAYBACK_CONTROL
  action: PlaybackControlAction
  expectedSessionId?: string
}

export type PlaybackControlResponse =
  | { ok: true; sessionId: string | null; state: PlaybackState }
  | { ok: false; error: PlaybackError }

export type PlaybackStatusRequest = {
  kind: typeof PLAYBACK_STATUS
}

export type PlaybackStatus = {
  kind: typeof PLAYBACK_STATUS
  state: PlaybackState
  sessionId: string | null
  requestId: string | null
  source: PlaybackSource | null
  currentChunk: number
  totalChunks: number
  currentParagraph: number
  totalParagraphs: number
  error?: PlaybackError
}

export type PlaybackEventName =
  | 'accepted'
  | 'state-changed'
  | 'chunk-started'
  | 'chunk-ended'
  | 'completed'
  | 'cancelled'
  | 'failed'

export type PlaybackEvent = {
  kind: typeof PLAYBACK_EVENT
  event: PlaybackEventName
  atMs: number
  status: PlaybackStatus
  chunkId?: string
  transition?: 'continuation' | 'sentence' | 'paragraph' | 'end'
}

const PLAYBACK_SOURCES = new Set<PlaybackSource>(['selection', 'popup-test', 'options-test', 'debug-fixture'])
const CONTROL_ACTIONS = new Set<PlaybackControlAction>(['pause', 'resume', 'cancel'])
const PLAYBACK_STATES = new Set<PlaybackState>([
  'idle',
  'starting',
  'synthesizing',
  'playing',
  'paused',
  'waiting',
  'completed',
  'cancelled',
  'failed',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isPlaybackSettingsSnapshot(value: unknown): value is PlaybackSettingsSnapshot {
  if (!isRecord(value)) return false
  return isNonEmptyString(value.ttsUrl)
    && typeof value.voice === 'string'
    && typeof value.rate === 'number'
    && Number.isFinite(value.rate)
}

export function isStartPlaybackRequest(value: unknown): value is StartPlaybackRequest {
  if (!isRecord(value)) return false
  return value.kind === START_PLAYBACK
    && isNonEmptyString(value.requestId)
    && typeof value.source === 'string'
    && PLAYBACK_SOURCES.has(value.source as PlaybackSource)
    && typeof value.text === 'string'
    && isPlaybackSettingsSnapshot(value.settings)
}

export function isPlaybackControlRequest(value: unknown): value is PlaybackControlRequest {
  if (!isRecord(value)) return false
  if (value.kind !== PLAYBACK_CONTROL || typeof value.action !== 'string') return false
  if (!CONTROL_ACTIONS.has(value.action as PlaybackControlAction)) return false
  return value.expectedSessionId === undefined || isNonEmptyString(value.expectedSessionId)
}

export function isPlaybackStatusRequest(value: unknown): value is PlaybackStatusRequest {
  return isRecord(value) && value.kind === PLAYBACK_STATUS
}

export function isPlaybackStatus(value: unknown): value is PlaybackStatus {
  if (!isRecord(value) || value.kind !== PLAYBACK_STATUS) return false
  if (typeof value.state !== 'string' || !PLAYBACK_STATES.has(value.state as PlaybackState)) return false
  if (value.sessionId !== null && !isNonEmptyString(value.sessionId)) return false
  if (value.requestId !== null && !isNonEmptyString(value.requestId)) return false
  if (value.source !== null && (typeof value.source !== 'string' || !PLAYBACK_SOURCES.has(value.source as PlaybackSource))) return false
  return [value.currentChunk, value.totalChunks, value.currentParagraph, value.totalParagraphs]
    .every((entry) => typeof entry === 'number' && Number.isInteger(entry) && entry >= 0)
}

export function createPlaybackError(code: PlaybackErrorCode, message: string, status?: number): PlaybackError {
  return status === undefined ? { code, message } : { code, message, status }
}
