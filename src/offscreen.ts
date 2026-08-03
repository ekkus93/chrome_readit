import {
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
      void chrome.runtime.lastError
    })
  } catch (error) {
    console.warn('[readit] failed to publish playback event', error)
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

const runtimeState = getRuntimeState()

if (!runtimeState.initialized) {
  runtimeState.initialized = true
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    try {
      if (isStartPlaybackRequest(message)) {
        void runtimeState.coordinator.start(message)
          .then(sendResponse)
          .catch((error) => sendResponse({
            ok: false,
            accepted: false,
            requestId: message.requestId,
            error: { code: 'INVALID_REQUEST', message: String(error) },
          }))
        return true
      }

      if (isPlaybackControlRequest(message)) {
        void runtimeState.coordinator.control(message.action, message.expectedSessionId)
          .then(sendResponse)
          .catch((error) => sendResponse({
            ok: false,
            error: { code: 'INVALID_REQUEST', message: String(error) },
          }))
        return true
      }

      if (isPlaybackStatusRequest(message)) {
        sendResponse(runtimeState.coordinator.getStatus())
        return true
      }

      if (DIAGNOSTICS_ENABLED && isRecord(message) && message.kind === 'PLAYBACK_DIAGNOSTICS') {
        sendResponse({
          ok: true,
          status: runtimeState.coordinator.getStatus(),
          events: runtimeState.coordinator.getDiagnosticEvents(),
        })
        return true
      }
    } catch (error) {
      console.warn('[readit] offscreen playback handler failed', error)
      sendResponse({
        ok: false,
        error: { code: 'INVALID_REQUEST', message: String(error) },
      })
      return true
    }

    return false
  })
}

export const __testing = {
  getCoordinator: () => runtimeState.coordinator,
}
