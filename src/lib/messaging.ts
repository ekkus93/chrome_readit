import { isPlaybackSource, type PlaybackSource } from './playback-protocol'

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
