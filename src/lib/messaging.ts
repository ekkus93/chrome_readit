import { isPlaybackSource, type PlaybackSource } from './playback-protocol'

export type LegacyPlaybackControlRequest =
  | { kind: 'SPEECH_STATUS' }
  | { kind: 'PAUSE_SPEECH' }
  | { kind: 'RESUME_SPEECH' }
  | { kind: 'CANCEL_SPEECH' }

export type Msg =
  | { kind: 'READ_SELECTION' }
  | { kind: 'READ_TEXT'; text: string; source: PlaybackSource }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isReadSelection(value: unknown): value is { kind: 'READ_SELECTION' } {
  return isRecord(value) && value.kind === 'READ_SELECTION'
}

export function isReadText(value: unknown): value is { kind: 'READ_TEXT'; text: string; source: PlaybackSource } {
  return isRecord(value)
    && value.kind === 'READ_TEXT'
    && typeof value.text === 'string'
    && isPlaybackSource(value.source)
}

export function isMsg(value: unknown): value is Msg {
  return isReadSelection(value) || isReadText(value)
}

export function isLegacyPlaybackControlRequest(value: unknown): value is LegacyPlaybackControlRequest {
  if (!isRecord(value) || typeof value.kind !== 'string') return false
  return value.kind === 'SPEECH_STATUS'
    || value.kind === 'PAUSE_SPEECH'
    || value.kind === 'RESUME_SPEECH'
    || value.kind === 'CANCEL_SPEECH'
}
