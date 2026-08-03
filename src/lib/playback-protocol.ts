export const START_PLAYBACK = 'START_PLAYBACK' as const
export const PLAYBACK_CONTROL = 'PLAYBACK_CONTROL' as const
export const PLAYBACK_STATUS = 'PLAYBACK_STATUS' as const
export const PLAYBACK_EVENT = 'PLAYBACK_EVENT' as const

export type PlaybackSource = 'selection' | 'popup-test' | 'options-test' | 'debug-fixture'
export type PlaybackState = 'idle' | 'starting' | 'synthesizing' | 'playing' | 'paused' | 'waiting' | 'completed' | 'cancelled' | 'failed'
export type PlaybackControlAction = 'pause' | 'resume' | 'cancel'
export type PlaybackCleanupStage = 'pause' | 'clear-source' | 'reload' | 'revoke-url' | 'accounting'
export type PlaybackTransition = 'continuation' | 'sentence' | 'paragraph' | 'end'

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
  | 'TTS_TIMEOUT'
  | 'AUDIO_PLAYBACK_FAILED'
  | 'AUDIO_CLEANUP_FAILED'
  | 'INTERNAL_PLAYBACK_ERROR'
  | 'OFFSCREEN_INTERRUPTED'
  | 'OFFSCREEN_UNSUPPORTED'
  | 'SESSION_SUPERSEDED'
  | 'SESSION_NOT_FOUND'
  | 'CANCELLED'

export type PlaybackError = {
  code: PlaybackErrorCode
  message: string
  status?: number
  stage?: PlaybackCleanupStage
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
  sequence: number
  state: PlaybackState
  sessionId: string | null
  requestId: string | null
  source: PlaybackSource | null
  currentChunk: number
  totalChunks: number
  currentParagraph: number
  totalParagraphs: number
  persistenceDegraded?: boolean
  error?: PlaybackError
}

export type PlaybackEventName =
  | 'accepted'
  | 'state-changed'
  | 'chunk-started'
  | 'chunk-ended'
  | 'completed'
  | 'cancelled'
  | 'superseded'
  | 'failed'

export type PlaybackEvent = {
  kind: typeof PLAYBACK_EVENT
  event: PlaybackEventName
  atMs: number
  status: PlaybackStatus
  chunkId?: string
  transition?: PlaybackTransition
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
const PLAYBACK_EVENT_NAMES = new Set<PlaybackEventName>([
  'accepted',
  'state-changed',
  'chunk-started',
  'chunk-ended',
  'completed',
  'cancelled',
  'superseded',
  'failed',
])
const PLAYBACK_ERROR_CODES = new Set<PlaybackErrorCode>([
  'INVALID_REQUEST',
  'NO_TEXT',
  'TEXT_TOO_LONG',
  'INVALID_TTS_URL',
  'HOST_PLAY_ENDPOINT_FORBIDDEN',
  'TTS_HTTP_ERROR',
  'TTS_NON_AUDIO_RESPONSE',
  'TTS_EMPTY_RESPONSE',
  'TTS_RESPONSE_TOO_LARGE',
  'TTS_FETCH_FAILED',
  'TTS_TIMEOUT',
  'AUDIO_PLAYBACK_FAILED',
  'AUDIO_CLEANUP_FAILED',
  'INTERNAL_PLAYBACK_ERROR',
  'OFFSCREEN_INTERRUPTED',
  'OFFSCREEN_UNSUPPORTED',
  'SESSION_SUPERSEDED',
  'SESSION_NOT_FOUND',
  'CANCELLED',
])
const CLEANUP_STAGES = new Set<PlaybackCleanupStage>([
  'pause',
  'clear-source',
  'reload',
  'revoke-url',
  'accounting',
])
const TRANSITIONS = new Set<PlaybackTransition>(['continuation', 'sentence', 'paragraph', 'end'])
const CHUNK_EVENTS = new Set<PlaybackEventName>(['chunk-started', 'chunk-ended'])
const TERMINAL_STATES = new Set<PlaybackState>(['completed', 'cancelled', 'failed'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isPlaybackSettingsSnapshot(value: unknown): value is PlaybackSettingsSnapshot {
  if (!isRecord(value)) return false
  return isNonEmptyString(value.ttsUrl)
    && typeof value.voice === 'string'
    && typeof value.rate === 'number'
    && Number.isFinite(value.rate)
}

function hasConsistentProgress(value: Record<string, unknown>): boolean {
  const { currentChunk, totalChunks, currentParagraph, totalParagraphs } = value
  if (!isNonNegativeInteger(currentChunk)
    || !isNonNegativeInteger(totalChunks)
    || !isNonNegativeInteger(currentParagraph)
    || !isNonNegativeInteger(totalParagraphs)) return false
  if (totalChunks === 0) return currentChunk === 0 && currentParagraph === 0 && totalParagraphs === 0
  return currentChunk >= 1
    && currentChunk <= totalChunks
    && totalParagraphs >= 1
    && currentParagraph >= 1
    && currentParagraph <= totalParagraphs
}

export function isPlaybackSource(value: unknown): value is PlaybackSource {
  return typeof value === 'string' && PLAYBACK_SOURCES.has(value as PlaybackSource)
}

export function isPlaybackError(value: unknown): value is PlaybackError {
  if (!isRecord(value) || typeof value.code !== 'string' || !PLAYBACK_ERROR_CODES.has(value.code as PlaybackErrorCode)) return false
  if (typeof value.message !== 'string') return false
  if (value.status !== undefined && (typeof value.status !== 'number' || !Number.isInteger(value.status))) return false
  if (value.stage !== undefined && (typeof value.stage !== 'string' || !CLEANUP_STAGES.has(value.stage as PlaybackCleanupStage))) return false
  return value.code === 'AUDIO_CLEANUP_FAILED' ? value.stage !== undefined : value.stage === undefined
}

export function isStartPlaybackRequest(value: unknown): value is StartPlaybackRequest {
  if (!isRecord(value)) return false
  return value.kind === START_PLAYBACK
    && isNonEmptyString(value.requestId)
    && isPlaybackSource(value.source)
    && typeof value.text === 'string'
    && isPlaybackSettingsSnapshot(value.settings)
}

export function isStartPlaybackResponse(value: unknown): value is StartPlaybackResponse {
  if (!isRecord(value) || typeof value.ok !== 'boolean' || typeof value.accepted !== 'boolean') return false
  if (value.ok && value.accepted) return isNonEmptyString(value.requestId) && isNonEmptyString(value.sessionId)
  return !value.ok && !value.accepted
    && (value.requestId === undefined || typeof value.requestId === 'string')
    && isPlaybackError(value.error)
}

export function isPlaybackControlRequest(value: unknown): value is PlaybackControlRequest {
  if (!isRecord(value)) return false
  if (value.kind !== PLAYBACK_CONTROL || typeof value.action !== 'string') return false
  if (!CONTROL_ACTIONS.has(value.action as PlaybackControlAction)) return false
  return value.expectedSessionId === undefined || isNonEmptyString(value.expectedSessionId)
}

export function isPlaybackControlResponse(value: unknown): value is PlaybackControlResponse {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false
  if (value.ok) {
    return (value.sessionId === null || isNonEmptyString(value.sessionId))
      && typeof value.state === 'string'
      && PLAYBACK_STATES.has(value.state as PlaybackState)
  }
  return isPlaybackError(value.error)
}

export function isPlaybackStatusRequest(value: unknown): value is PlaybackStatusRequest {
  return isRecord(value) && value.kind === PLAYBACK_STATUS
}

export function isPlaybackStatus(value: unknown): value is PlaybackStatus {
  if (!isRecord(value) || value.kind !== PLAYBACK_STATUS) return false
  if (!isNonNegativeInteger(value.sequence)) return false
  if (typeof value.state !== 'string' || !PLAYBACK_STATES.has(value.state as PlaybackState)) return false
  const state = value.state as PlaybackState
  if (value.sessionId !== null && !isNonEmptyString(value.sessionId)) return false
  if (value.requestId !== null && !isNonEmptyString(value.requestId)) return false
  if (value.source !== null && !isPlaybackSource(value.source)) return false
  if (value.persistenceDegraded !== undefined && typeof value.persistenceDegraded !== 'boolean') return false
  if (value.error !== undefined && !isPlaybackError(value.error)) return false
  if (!hasConsistentProgress(value)) return false

  const hasIdentity = value.sessionId !== null && value.requestId !== null && value.source !== null
  const hasNoIdentity = value.sessionId === null && value.requestId === null && value.source === null
  if (!hasIdentity && !hasNoIdentity) return false
  if (state === 'idle' && (!hasNoIdentity || value.error !== undefined)) return false
  if (state !== 'idle' && !hasIdentity && state !== 'failed') return false
  if (state === 'failed' && value.error === undefined) return false
  if (state === 'completed' && value.error !== undefined) return false
  if (state === 'cancelled' && value.error === undefined) return false
  if (!TERMINAL_STATES.has(state) && value.error !== undefined) return false
  return true
}

export function isPlaybackEvent(value: unknown): value is PlaybackEvent {
  if (!isRecord(value) || value.kind !== PLAYBACK_EVENT) return false
  if (typeof value.event !== 'string' || !PLAYBACK_EVENT_NAMES.has(value.event as PlaybackEventName)) return false
  if (typeof value.atMs !== 'number' || !Number.isFinite(value.atMs)) return false
  if (!isPlaybackStatus(value.status)) return false

  const event = value.event as PlaybackEventName
  const isChunkEvent = CHUNK_EVENTS.has(event)
  if (isChunkEvent) {
    if (!isNonEmptyString(value.chunkId)) return false
    if (typeof value.transition !== 'string' || !TRANSITIONS.has(value.transition as PlaybackTransition)) return false
  } else if (value.chunkId !== undefined || value.transition !== undefined) {
    return false
  }

  if ((event === 'accepted' && value.status.state !== 'starting')
    || (event === 'completed' && value.status.state !== 'completed')
    || (event === 'cancelled' && value.status.state !== 'cancelled')
    || (event === 'superseded' && (value.status.state !== 'cancelled' || value.status.error?.code !== 'SESSION_SUPERSEDED'))
    || (event === 'failed' && value.status.state !== 'failed')
    || (event === 'chunk-started' && value.status.state !== 'playing')) return false

  return true
}

export function createPlaybackError(
  code: PlaybackErrorCode,
  message: string,
  status?: number,
  stage?: PlaybackCleanupStage,
): PlaybackError {
  return {
    code,
    message,
    ...(status === undefined ? {} : { status }),
    ...(stage === undefined ? {} : { stage }),
  }
}
