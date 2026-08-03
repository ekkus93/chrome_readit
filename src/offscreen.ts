import {
  createPlaybackError,
  isPlaybackControlRequest,
  isPlaybackStatusRequest,
  isStartPlaybackRequest,
  type PlaybackEvent,
} from './lib/playback-protocol'
import { createBrowserPlaybackCoordinator, type PlaybackCoordinator } from './offscreen/playback-coordinator'

const DIAGNOSTICS_ENABLED = import.meta.env.DEV || import.meta.env.MODE === 'test'

type OffscreenRuntimeState = {
  initialized: boolean
  coordinator: PlaybackCoordinator
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function emitPlaybackEvent(event: PlaybackEvent): void {
  try {
    chrome.runtime.sendMessage(event, () => {
      // No UI listener is a normal condition. Reading lastError here prevents
      // Chrome from reporting an unhandled callback error without changing
      // playback behavior or hiding a user-initiated operation failure.
      void chrome.runtime.lastError
    })
  } catch {
    console.warn('[readit] playback event publication failed')
  }
}

function getRuntimeState(): OffscreenRuntimeState {
  const globalState = globalThis as typeof globalThis & {
    __readitOffscreenRuntimeState?: OffscreenRuntimeState
  }
  if (!globalState.__readitOffscreenRuntimeState) {
    globalState.__readitOffscreenRuntimeState = {
      initialized: false,
      coordinator: createBrowserPlaybackCoordinator(emitPlaybackEvent),
    }
  }
  return globalState.__readitOffscreenRuntimeState
}

function internalStartFailure(requestId: string) {
  return {
    ok: false as const,
    accepted: false as const,
    requestId,
    error: createPlaybackError('INTERNAL_PLAYBACK_ERROR', 'Playback could not be started because of an internal error.'),
  }
}

function internalControlFailure() {
  return {
    ok: false as const,
    error: createPlaybackError('INTERNAL_PLAYBACK_ERROR', 'Playback control failed because of an internal error.'),
  }
}

const runtimeState = getRuntimeState()

if (!runtimeState.initialized) {
  runtimeState.initialized = true
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (isStartPlaybackRequest(message)) {
      void runtimeState.coordinator.start(message)
        .then(sendResponse)
        .catch(() => {
          console.warn('[readit] coordinator start handler failed')
          sendResponse(internalStartFailure(message.requestId))
        })
      return true
    }

    if (isPlaybackControlRequest(message)) {
      void runtimeState.coordinator.control(message.action, message.expectedSessionId)
        .then(sendResponse)
        .catch(() => {
          console.warn('[readit] coordinator control handler failed')
          sendResponse(internalControlFailure())
        })
      return true
    }

    if (isPlaybackStatusRequest(message)) {
      try {
        sendResponse(runtimeState.coordinator.getStatus())
      } catch {
        console.warn('[readit] coordinator status handler failed')
        sendResponse({
          kind: 'PLAYBACK_STATUS',
          sequence: 0,
          state: 'failed',
          sessionId: null,
          requestId: null,
          source: null,
          currentChunk: 0,
          totalChunks: 0,
          currentParagraph: 0,
          totalParagraphs: 0,
          error: createPlaybackError('INTERNAL_PLAYBACK_ERROR', 'Playback status is unavailable because of an internal error.'),
        })
      }
      return true
    }

    if (DIAGNOSTICS_ENABLED && isRecord(message) && message.kind === 'PLAYBACK_DIAGNOSTICS') {
      sendResponse({
        ok: true,
        status: runtimeState.coordinator.getStatus(),
        events: runtimeState.coordinator.getDiagnosticEvents(),
        player: runtimeState.coordinator.getPlayerDiagnostics(),
      })
      return true
    }

    return false
  })
}

export const __testing = {
  getCoordinator: () => runtimeState.coordinator,
}
