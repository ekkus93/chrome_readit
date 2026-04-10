export const OFFSCREEN_PLAY_AUDIO = 'OFFSCREEN_PLAY_AUDIO'
export const OFFSCREEN_PAUSE_AUDIO = 'OFFSCREEN_PAUSE_AUDIO'
export const OFFSCREEN_RESUME_AUDIO = 'OFFSCREEN_RESUME_AUDIO'
export const OFFSCREEN_STOP_AUDIO = 'OFFSCREEN_STOP_AUDIO'

export type OffscreenPlayAudioMessage = {
  action: typeof OFFSCREEN_PLAY_AUDIO
  audio: ArrayBuffer | string
  mime?: string
  rate?: number
  playbackToken?: string
}

export type OffscreenControlMessage =
  | { action: typeof OFFSCREEN_PAUSE_AUDIO }
  | { action: typeof OFFSCREEN_RESUME_AUDIO }
  | { action: typeof OFFSCREEN_STOP_AUDIO }

export type OffscreenMessage = OffscreenPlayAudioMessage | OffscreenControlMessage

export function isOffscreenPlayAudioMessage(message: unknown): message is OffscreenPlayAudioMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'action' in (message as Record<string, unknown>) &&
    (message as Record<string, unknown>).action === OFFSCREEN_PLAY_AUDIO &&
    'audio' in (message as Record<string, unknown>)
  )
}

export function isOffscreenControlMessage(message: unknown): message is OffscreenControlMessage {
  if (typeof message !== 'object' || message === null || !('action' in (message as Record<string, unknown>))) {
    return false
  }
  const action = (message as Record<string, unknown>).action
  return action === OFFSCREEN_PAUSE_AUDIO || action === OFFSCREEN_RESUME_AUDIO || action === OFFSCREEN_STOP_AUDIO
}
