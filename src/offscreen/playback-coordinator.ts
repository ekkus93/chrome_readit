import { packPlaybackChunks, type PlaybackChunk } from '../lib/chunk-packing'
import { clampPlaybackRate, getTransitionGapMs } from '../lib/playback-pacing'
import {
  PLAYBACK_EVENT,
  PLAYBACK_STATUS,
  createPlaybackError,
  type PlaybackControlResponse,
  type PlaybackError,
  type PlaybackEvent,
  type PlaybackState,
  type PlaybackStatus,
  type StartPlaybackRequest,
  type StartPlaybackResponse,
} from '../lib/playback-protocol'
import { isHostPlayTtsUrl } from '../lib/storage'
import { normalizeSelectedText } from '../lib/text-normalization'
import { fetchTtsAudio, TtsClientError, type TtsAudio } from '../lib/tts-client'

export type CoordinatorDependencies = {
  createAudio: () => HTMLAudioElement
  createObjectUrl: (blob: Blob) => string
  revokeObjectUrl: (url: string) => void
  fetchAudio: typeof fetchTtsAudio
  createSessionId: () => string
  now: () => number
  sleep: (milliseconds: number) => Promise<void>
  emit: (event: PlaybackEvent) => void
}

type Session = {
  id: string
  requestId: string
  source: StartPlaybackRequest['source']
  settings: StartPlaybackRequest['settings']
  chunks: PlaybackChunk[]
  state: PlaybackState
  stateBeforePause: PlaybackState
  currentIndex: number
  paused: boolean
  cancelled: boolean
  fetchControllers: Set<AbortController>
  error?: PlaybackError
}

type ActivePlayback = {
  sessionId: string
  chunkId: string
  settle: (error?: Error) => void
  settled: boolean
}

type AudioFetchResult =
  | { ok: true; audio: TtsAudio }
  | { ok: false; error: unknown }

class SessionInterruptedError extends Error {}

function isTerminalState(state: PlaybackState): boolean {
  return state === 'completed' || state === 'cancelled' || state === 'failed' || state === 'idle'
}

function validNormalTtsUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !isHostPlayTtsUrl(value)
  } catch {
    return false
  }
}

export class PlaybackCoordinator {
  private readonly audio: HTMLAudioElement
  private readonly diagnostics: PlaybackEvent[] = []
  private readonly dependencies: CoordinatorDependencies
  private session: Session | null = null
  private currentObjectUrl: string | null = null
  private activePlayback: ActivePlayback | null = null

  constructor(dependencies: CoordinatorDependencies) {
    this.dependencies = dependencies
    this.audio = dependencies.createAudio()
    this.audio.preload = 'auto'
  }

  getStatus(): PlaybackStatus {
    const session = this.session
    if (!session) {
      return {
        kind: PLAYBACK_STATUS,
        state: 'idle',
        sessionId: null,
        requestId: null,
        source: null,
        currentChunk: 0,
        totalChunks: 0,
        currentParagraph: 0,
        totalParagraphs: 0,
      }
    }

    const currentChunk = session.chunks[session.currentIndex]
    const totalParagraphs = session.chunks.length === 0
      ? 0
      : Math.max(...session.chunks.map((chunk) => chunk.paragraphIndex)) + 1

    return {
      kind: PLAYBACK_STATUS,
      state: session.state,
      sessionId: session.id,
      requestId: session.requestId,
      source: session.source,
      currentChunk: session.chunks.length === 0 ? 0 : session.currentIndex + 1,
      totalChunks: session.chunks.length,
      currentParagraph: currentChunk ? currentChunk.paragraphIndex + 1 : 0,
      totalParagraphs,
      ...(session.error ? { error: session.error } : {}),
    }
  }

  getDiagnosticEvents(): readonly PlaybackEvent[] {
    return this.diagnostics
  }

  async start(request: StartPlaybackRequest): Promise<StartPlaybackResponse> {
    const normalized = normalizeSelectedText(request.text)
    if (!normalized.ok) {
      return { ok: false, accepted: false, requestId: request.requestId, error: normalized.error }
    }
    if (!validNormalTtsUrl(request.settings.ttsUrl)) {
      const code = isHostPlayTtsUrl(request.settings.ttsUrl)
        ? 'HOST_PLAY_ENDPOINT_FORBIDDEN'
        : 'INVALID_TTS_URL'
      return {
        ok: false,
        accepted: false,
        requestId: request.requestId,
        error: createPlaybackError(code, 'The configured TTS URL cannot be used for extension playback.'),
      }
    }

    const chunks = packPlaybackChunks(normalized.value.text)
    await this.supersedeCurrent()

    const session: Session = {
      id: this.dependencies.createSessionId(),
      requestId: request.requestId,
      source: request.source,
      settings: { ...request.settings, rate: clampPlaybackRate(request.settings.rate) },
      chunks,
      state: 'starting',
      stateBeforePause: 'starting',
      currentIndex: 0,
      paused: false,
      cancelled: false,
      fetchControllers: new Set(),
    }
    this.session = session
    this.emit('accepted')
    void this.run(session)

    return { ok: true, accepted: true, requestId: request.requestId, sessionId: session.id }
  }

  async control(action: 'pause' | 'resume' | 'cancel', expectedSessionId?: string): Promise<PlaybackControlResponse> {
    const session = this.session
    if (!session || (expectedSessionId && expectedSessionId !== session.id)) {
      return {
        ok: false,
        error: createPlaybackError('SESSION_NOT_FOUND', 'The requested playback session is no longer active.'),
      }
    }

    if (action === 'pause') this.pauseSession(session)
    if (action === 'resume') await this.resumeSession(session)
    if (action === 'cancel') await this.cancelSession(session, true)

    return { ok: true, sessionId: session.id, state: session.state }
  }

  private isCurrent(session: Session): boolean {
    return this.session?.id === session.id && !session.cancelled
  }

  private setState(session: Session, state: PlaybackState): void {
    if (!this.isCurrent(session) && state !== 'cancelled') return
    session.state = state
    if (state !== 'paused') session.stateBeforePause = state
    this.emit('state-changed')
  }

  private emit(event: PlaybackEvent['event'], chunk?: PlaybackChunk): void {
    const entry: PlaybackEvent = {
      kind: PLAYBACK_EVENT,
      event,
      atMs: this.dependencies.now(),
      status: this.getStatus(),
      ...(chunk ? { chunkId: `${this.session?.id ?? 'none'}:${chunk.globalChunkIndex}`, transition: chunk.transitionAfter } : {}),
    }
    this.diagnostics.push(entry)
    if (this.diagnostics.length > 100) this.diagnostics.splice(0, this.diagnostics.length - 100)
    this.dependencies.emit(entry)
  }

  private async supersedeCurrent(): Promise<void> {
    const current = this.session
    if (!current) {
      this.stopAudio(new SessionInterruptedError('superseded'))
      return
    }
    if (!isTerminalState(current.state)) await this.cancelSession(current, false)
    else this.stopAudio(new SessionInterruptedError('superseded'))
    this.session = null
  }

  private pauseSession(session: Session): void {
    if (!this.isCurrent(session) || session.paused || isTerminalState(session.state)) return
    session.paused = true
    session.stateBeforePause = session.state
    if (this.activePlayback?.sessionId === session.id) this.audio.pause()
    session.state = 'paused'
    this.emit('state-changed')
  }

  private async resumeSession(session: Session): Promise<void> {
    if (!this.isCurrent(session) || !session.paused || isTerminalState(session.state)) return
    session.paused = false
    session.state = session.stateBeforePause
    if (this.activePlayback?.sessionId === session.id) {
      try {
        await this.audio.play()
      } catch (error) {
        throw new TtsClientError(createPlaybackError('AUDIO_PLAYBACK_FAILED', 'Audio playback could not resume.'), error)
      }
    }
    this.emit('state-changed')
  }

  private async cancelSession(session: Session, emitEvent: boolean): Promise<void> {
    if (session.cancelled || isTerminalState(session.state)) return
    session.cancelled = true
    session.paused = false
    session.fetchControllers.forEach((controller) => controller.abort())
    session.fetchControllers.clear()
    this.stopAudio(new SessionInterruptedError('cancelled'))
    session.state = 'cancelled'
    session.error = createPlaybackError('CANCELLED', 'Playback was cancelled.')
    if (emitEvent) this.emit('cancelled')
  }

  private stopAudio(error?: Error): void {
    const active = this.activePlayback
    if (active && !active.settled) {
      active.settled = true
      active.settle(error ?? new SessionInterruptedError('stopped'))
    }
    this.activePlayback = null
    this.audio.onended = null
    this.audio.onerror = null
    try {
      this.audio.pause()
      this.audio.removeAttribute('src')
      this.audio.load()
    } catch {
      // Cleanup remains idempotent in partially implemented media environments.
    }
    if (this.currentObjectUrl) {
      this.dependencies.revokeObjectUrl(this.currentObjectUrl)
      this.currentObjectUrl = null
    }
  }

  private async fetchChunk(session: Session, chunk: PlaybackChunk): Promise<TtsAudio> {
    if (!this.isCurrent(session)) throw new SessionInterruptedError('session is inactive')
    const controller = new AbortController()
    session.fetchControllers.add(controller)
    try {
      return await this.dependencies.fetchAudio({
        url: session.settings.ttsUrl,
        text: chunk.text,
        voice: session.settings.voice,
        signal: controller.signal,
      })
    } finally {
      session.fetchControllers.delete(controller)
    }
  }

  private fetchChunkSettled(session: Session, chunk: PlaybackChunk): Promise<AudioFetchResult> {
    return this.fetchChunk(session, chunk).then(
      (audio) => ({ ok: true, audio }),
      (error: unknown) => ({ ok: false, error }),
    )
  }

  private async playChunk(session: Session, chunk: PlaybackChunk, audioData: TtsAudio): Promise<void> {
    if (!this.isCurrent(session)) throw new SessionInterruptedError('session is inactive')
    this.stopAudio()

    const objectUrl = this.dependencies.createObjectUrl(new Blob([audioData.bytes], { type: audioData.mime }))
    this.currentObjectUrl = objectUrl
    this.audio.src = objectUrl
    this.audio.playbackRate = session.settings.rate

    await new Promise<void>((resolve, reject) => {
      const active: ActivePlayback = {
        sessionId: session.id,
        chunkId: chunk.id,
        settled: false,
        settle: (error) => {
          if (error) reject(error)
          else resolve()
        },
      }
      this.activePlayback = active

      const finish = (error?: Error) => {
        if (this.activePlayback !== active || active.settled) return
        active.settled = true
        this.activePlayback = null
        this.audio.onended = null
        this.audio.onerror = null
        if (this.currentObjectUrl === objectUrl) {
          this.dependencies.revokeObjectUrl(objectUrl)
          this.currentObjectUrl = null
        }
        this.audio.removeAttribute('src')
        try { this.audio.load() } catch { /* ignored */ }
        active.settle(error)
      }

      this.audio.onended = () => finish()
      this.audio.onerror = () => finish(new Error('audio playback failed'))

      try {
        const playPromise = this.audio.play()
        void playPromise.catch((error) => finish(error instanceof Error ? error : new Error(String(error))))
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private async waitWhilePaused(session: Session): Promise<void> {
    while (this.isCurrent(session) && session.paused) await this.dependencies.sleep(25)
    if (!this.isCurrent(session)) throw new SessionInterruptedError('session is inactive')
  }

  private async waitForTransition(session: Session, milliseconds: number): Promise<void> {
    if (milliseconds <= 0) return
    this.setState(session, 'waiting')
    let remaining = milliseconds

    while (remaining > 0) {
      await this.waitWhilePaused(session)
      const step = Math.min(25, remaining)
      const before = this.dependencies.now()
      await this.dependencies.sleep(step)
      if (!this.isCurrent(session)) throw new SessionInterruptedError('session is inactive')
      if (!session.paused) remaining -= Math.max(1, Math.min(step, this.dependencies.now() - before))
    }
  }

  private async run(session: Session): Promise<void> {
    try {
      this.setState(session, 'synthesizing')
      let currentAudioPromise = this.fetchChunkSettled(session, session.chunks[0])

      for (let index = 0; index < session.chunks.length; index += 1) {
        await this.waitWhilePaused(session)
        if (!this.isCurrent(session)) return
        session.currentIndex = index
        const chunk = session.chunks[index]
        const currentResult = await currentAudioPromise
        if (!currentResult.ok) throw currentResult.error
        if (!this.isCurrent(session)) return

        const nextChunk = session.chunks[index + 1]
        const nextAudioPromise = nextChunk ? this.fetchChunkSettled(session, nextChunk) : null

        this.setState(session, 'playing')
        this.emit('chunk-started', chunk)
        await this.playChunk(session, chunk, currentResult.audio)
        if (!this.isCurrent(session)) return
        this.emit('chunk-ended', chunk)

        if (nextAudioPromise) {
          await this.waitForTransition(session, getTransitionGapMs(chunk.transitionAfter, session.settings.rate))
          currentAudioPromise = nextAudioPromise
          this.setState(session, 'synthesizing')
        }
      }

      if (!this.isCurrent(session)) return
      this.stopAudio()
      session.state = 'completed'
      this.emit('completed')
    } catch (error) {
      if (error instanceof SessionInterruptedError || session.cancelled || !this.isCurrent(session)) return
      this.stopAudio()
      const detail = error instanceof TtsClientError
        ? error.detail
        : createPlaybackError('AUDIO_PLAYBACK_FAILED', error instanceof Error ? error.message : String(error))
      session.error = detail
      session.state = 'failed'
      this.emit('failed')
    }
  }
}

export function createBrowserPlaybackCoordinator(emit: (event: PlaybackEvent) => void): PlaybackCoordinator {
  return new PlaybackCoordinator({
    createAudio: () => new Audio(),
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    fetchAudio: fetchTtsAudio,
    createSessionId: () => crypto.randomUUID(),
    now: () => performance.now(),
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    emit,
  })
}
