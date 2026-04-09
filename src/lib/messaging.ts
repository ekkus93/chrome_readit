export type PlayAudioMsg = {
  kind: 'PLAY_AUDIO'
  audio: ArrayBuffer | string
  mime?: string
  rate?: number
  playbackToken?: string
}

export type PlaybackControlRequest =
  | { kind: 'SPEECH_STATUS' }
  | { kind: 'PAUSE_SPEECH' }
  | { kind: 'RESUME_SPEECH' }
  | { kind: 'CANCEL_SPEECH' }

export type Msg =
  | { kind: 'READ_SELECTION' }
  | { kind: 'READ_TEXT'; text: string }
  | PlayAudioMsg

export function sendToContent(tabId: number, msg: Msg) {
  return chrome.tabs.sendMessage(tabId, msg)
}

// Type guards for runtime validation of messages coming from other contexts
export function isReadSelection(m: unknown): m is { kind: 'READ_SELECTION' } {
  return typeof m === 'object' && m !== null && 'kind' in (m as Record<string, unknown>) && (m as Record<string, unknown>).kind === 'READ_SELECTION'
}

export function isReadText(m: unknown): m is { kind: 'READ_TEXT'; text: string } {
  return (
    typeof m === 'object' &&
    m !== null &&
    'kind' in (m as Record<string, unknown>) &&
    (m as Record<string, unknown>).kind === 'READ_TEXT' &&
    'text' in (m as Record<string, unknown>) &&
    typeof (m as Record<string, unknown>).text === 'string'
  )
}

export function isMsg(m: unknown): m is Msg {
  return isReadSelection(m) || isReadText(m) || isPlayAudio(m)
}

export function isPlayAudio(m: unknown): m is PlayAudioMsg {
  return (
    typeof m === 'object' &&
    m !== null &&
    'kind' in (m as Record<string, unknown>) &&
    (m as Record<string, unknown>).kind === 'PLAY_AUDIO' &&
    'audio' in (m as Record<string, unknown>)
  )
}
