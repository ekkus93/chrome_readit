import {
  isOffscreenControlMessage,
  isOffscreenPlayAudioMessage,
  OFFSCREEN_PAUSE_AUDIO,
  OFFSCREEN_RESUME_AUDIO,
  OFFSCREEN_STOP_AUDIO,
} from './lib/offscreen-messaging'

const DEBUG = Boolean(import.meta.env.DEV) && import.meta.env.MODE !== 'test'

type PlaybackResult = { ok: boolean; error?: string }

type OffscreenPlaybackState = {
  initialized: boolean
  currentAudio: HTMLAudioElement | null
  currentObjectUrl: string | null
  playbackRate: number
  activeChunkToken: string | null
  recentChunkTokens: string[]
}

function decodeBase64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64)
  const len = bin.length
  const u8 = new Uint8Array(len)
  for (let i = 0; i < len; i += 1) u8[i] = bin.charCodeAt(i)
  return u8
}

function getOffscreenPlaybackState(): OffscreenPlaybackState {
  const globalState = globalThis as typeof globalThis & {
    __readitOffscreenPlaybackState?: OffscreenPlaybackState
  }

  if (!globalState.__readitOffscreenPlaybackState) {
    globalState.__readitOffscreenPlaybackState = {
      initialized: false,
      currentAudio: null,
      currentObjectUrl: null,
      playbackRate: 1,
      activeChunkToken: null,
      recentChunkTokens: [],
    }
  }

  return globalState.__readitOffscreenPlaybackState
}

const state = getOffscreenPlaybackState()

function rememberChunkToken(playbackToken: string | null): void {
  if (!playbackToken) return
  state.recentChunkTokens = [...state.recentChunkTokens, playbackToken].slice(-12)
}

function revokeCurrentObjectUrl(): void {
  if (!state.currentObjectUrl) return
  try {
    URL.revokeObjectURL(state.currentObjectUrl)
  } catch (err) {
    void err
  }
  state.currentObjectUrl = null
}

function stopCurrentAudio(): void {
  if (!state.currentAudio) {
    revokeCurrentObjectUrl()
    return
  }
  try {
    state.currentAudio.pause()
    state.currentAudio.src = ''
  } catch (err) {
    void err
  }
  state.currentAudio.onended = null
  state.currentAudio.onerror = null
  state.currentAudio = null
  revokeCurrentObjectUrl()
}

function finishChunk(audio: HTMLAudioElement, playbackToken: string | null, result: PlaybackResult): void {
  if (state.currentAudio !== audio || state.activeChunkToken !== playbackToken) return
  state.activeChunkToken = null
  rememberChunkToken(playbackToken)
  stopCurrentAudio()

  if (!playbackToken) return
  try {
    chrome.runtime.sendMessage({
      kind: 'PLAYBACK_FINISHED',
      playbackToken,
      ok: result.ok,
      error: result.error,
    }, () => {
      void chrome.runtime.lastError
    })
  } catch (err) {
    console.warn('[readit] offscreen PLAYBACK_FINISHED notify failed', err)
  }
}

function playOffscreenAudio(message: {
  audio: ArrayBuffer | string
  mime?: string
  rate?: number
  playbackToken?: string
}): void {
  const playbackToken = typeof message.playbackToken === 'string' ? message.playbackToken : null
  if (playbackToken && (state.activeChunkToken === playbackToken || state.recentChunkTokens.includes(playbackToken))) {
    if (DEBUG) console.debug('[readit] offscreen duplicate playback ignored', { playbackToken })
    return
  }

  stopCurrentAudio()

  const mime = message.mime ?? 'audio/wav'
  if (typeof message.rate === 'number') state.playbackRate = message.rate
  const u8 = typeof message.audio === 'string' ? decodeBase64ToUint8Array(message.audio) : new Uint8Array(message.audio)
  const blob = new Blob([u8], { type: mime })
  const objectUrl = URL.createObjectURL(blob)
  const audio = new Audio(objectUrl)

  state.currentAudio = audio
  state.currentObjectUrl = objectUrl
  state.activeChunkToken = playbackToken

  audio.playbackRate = state.playbackRate
  audio.autoplay = true
  audio.preload = 'auto'

  audio.onended = () => {
    finishChunk(audio, playbackToken, { ok: true })
  }
  audio.onerror = () => {
    finishChunk(audio, playbackToken, { ok: false, error: 'audio playback failed' })
  }

  const playPromise = audio.play()
  if (playPromise && typeof playPromise.catch === 'function') {
    void playPromise.catch((err) => {
      finishChunk(audio, playbackToken, { ok: false, error: String(err) })
    })
  }
}

if (!state.initialized) {
  state.initialized = true
  if (DEBUG) console.debug('[readit] offscreen playback document loaded')

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    try {
      if (isOffscreenPlayAudioMessage(message)) {
        const playbackToken = typeof message.playbackToken === 'string' ? message.playbackToken : null
        if (playbackToken && (state.activeChunkToken === playbackToken || state.recentChunkTokens.includes(playbackToken))) {
          sendResponse?.({ ok: true, duplicate: true })
          return true
        }
        playOffscreenAudio(message)
        sendResponse?.({ ok: true })
        return true
      }

      if (isOffscreenControlMessage(message)) {
        if (message.action === OFFSCREEN_PAUSE_AUDIO) {
          try { state.currentAudio?.pause() } catch (err) { void err }
        }
        if (message.action === OFFSCREEN_RESUME_AUDIO) {
          try { void state.currentAudio?.play() } catch (err) { void err }
        }
        if (message.action === OFFSCREEN_STOP_AUDIO) {
          state.activeChunkToken = null
          stopCurrentAudio()
        }
        sendResponse?.({ ok: true })
        return true
      }
    } catch (err) {
      console.warn('[readit] offscreen playback handler failed', err)
      sendResponse?.({ ok: false, error: String(err) })
      return true
    }

    return false
  })
}
