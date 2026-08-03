import {
  PLAYBACK_CONTROL,
  PLAYBACK_STATUS,
  createPlaybackError,
  isPlaybackControlResponse,
  isPlaybackStatus,
  isStartPlaybackResponse,
  type PlaybackControlAction,
  type PlaybackControlResponse,
  type PlaybackError,
  type PlaybackSource,
  type PlaybackStatus,
  type StartPlaybackResponse,
} from './playback-protocol'

export type PlaybackStatusResult =
  | { ok: true; status: PlaybackStatus }
  | { ok: false; error: PlaybackError }

async function sendRuntimeMessage(message: unknown): Promise<unknown> {
  try {
    return await chrome.runtime.sendMessage(message)
  } catch {
    throw createPlaybackError('OFFSCREEN_INTERRUPTED', 'The extension playback service could not be reached.')
  }
}

export async function requestReadSelection(): Promise<StartPlaybackResponse> {
  try {
    const response = await sendRuntimeMessage({ kind: 'READ_SELECTION' })
    return isStartPlaybackResponse(response)
      ? response
      : {
          ok: false,
          accepted: false,
          error: createPlaybackError('OFFSCREEN_INTERRUPTED', 'The extension returned an invalid start response.'),
        }
  } catch (error) {
    return {
      ok: false,
      accepted: false,
      error: error as PlaybackError,
    }
  }
}

export async function requestReadText(text: string, source: PlaybackSource): Promise<StartPlaybackResponse> {
  try {
    const response = await sendRuntimeMessage({ kind: 'READ_TEXT', text, source })
    return isStartPlaybackResponse(response)
      ? response
      : {
          ok: false,
          accepted: false,
          error: createPlaybackError('OFFSCREEN_INTERRUPTED', 'The extension returned an invalid start response.'),
        }
  } catch (error) {
    return {
      ok: false,
      accepted: false,
      error: error as PlaybackError,
    }
  }
}

export async function sendPlaybackControl(
  action: PlaybackControlAction,
  expectedSessionId?: string,
): Promise<PlaybackControlResponse> {
  try {
    const response = await sendRuntimeMessage({
      kind: PLAYBACK_CONTROL,
      action,
      ...(expectedSessionId ? { expectedSessionId } : {}),
    })
    return isPlaybackControlResponse(response)
      ? response
      : {
          ok: false,
          error: createPlaybackError('OFFSCREEN_INTERRUPTED', 'The extension returned an invalid control response.'),
        }
  } catch (error) {
    return { ok: false, error: error as PlaybackError }
  }
}

export async function queryPlaybackStatus(): Promise<PlaybackStatusResult> {
  try {
    const response = await sendRuntimeMessage({ kind: PLAYBACK_STATUS })
    return isPlaybackStatus(response)
      ? { ok: true, status: response }
      : {
          ok: false,
          error: createPlaybackError('OFFSCREEN_INTERRUPTED', 'The extension returned an invalid playback status.'),
        }
  } catch (error) {
    return { ok: false, error: error as PlaybackError }
  }
}
