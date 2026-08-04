import { packPlaybackChunks, type PlaybackChunk } from '../lib/chunk-packing'
import { clampPlaybackRate, getTransitionGapMs } from '../lib/playback-pacing'
import {
  PLAYBACK_EVENT,
  PLAYBACK_STATUS,
  createPlaybackError,
  type PlaybackCleanupStage,
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
  attemptId: number
  objectUrl: string
  settle: (error?: Error) => void
  settled: boolean
  started: boolean
  audible: boolean
}

type AudioFetchResult =
  | { ok: true; audio: TtsAudio }
  | { ok: false; error: unknown }

export type PlayerDiagnostics = {
  activePlayerCount: number
  maxActivePlayerCount: number
  playAttemptCount: number
  successfulPlayStartCount: number
  settlementCount: number
  cleanupFailureCount: number
  lastCleanupFailureStage: PlaybackCleanupStage | null
  invariantViolationCount: number
}

class SessionInterruptedError extends Error {}

class AudioCleanupError extends Error {
  readonly detail: PlaybackError

  constructor(detail: PlaybackError, cause?: unknown) {
    super(detail.message, cause === undefined ? undefined : { cause })
    this.name = 'AudioCleanupError'
    this.detail = detail
  }
}

class AudioPlaybackError extends Error {
  readonly detail: PlaybackError

  constructor(message: string, cause?: unknown) {
    const detail = createPlaybackError('AUDIO_PLAYBACK_FAILED', message)
    super(detail.message, cause === undefined ? undefined : { cause })
    this.name = 'AudioPlaybackError'
    this.detail = detail
  }
}

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
  private readonly wakeWaiters = new Set<() => void>()
  private readonly playerDiagnostics: PlayerDiagnostics = {
    activePlayerCount: 0,
    maxActivePlayerCount: 0,
    playAttemptCount: 0,
    successfulPlayStartCount: 0,
    settlementCount: 0,
    cleanupFailureCount: 0,
    lastCleanupFailureStage: null,
    invariantViolationCount: 0,
  }
  private session: Session | null = null
  private currentObjectUrl: string | null = null
  private activePlayback: ActivePlayback | null = null
  private nextSequence = 0
  private nextPlayAttemptId = 0

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
        sequence: this.nextSequence,
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
      sequence: this.nextSequence,
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

  getPlayerDiagnostics(): PlayerDiagnostics {
    return { ...this.playerDiagnostics }
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
    const supersedeError = await this.supersedeCurrent()
    if (supersedeError) {
      return {
        ok: false,
        accepted: false,
        requestId: request.requestId,
        error: supersedeError,
      }
    }

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
    if (action === 'cancel') await this.cancelSession(session, true, false)

    if (session.state === 'failed' && session.error) return { ok: false, error: session.error }
    return { ok: true, sessionId: session.id, state: session.state }
  }

  private isCurrent(session: Session): boolean {
    return this.session?.id === session.id && !session.cancelled
  }

  private setState(session: Session, state: PlaybackState): void {
    if (!this.isCurrent(session)) return
    session.state = state
    if (state !== 'paused') session.stateBeforePause = state
    this.emit('state-changed')
  }

  private emit(event: PlaybackEvent['event'], chunk?: PlaybackChunk): void {
    this.nextSequence += 1
    const entry: PlaybackEvent = {
      kind: PLAYBACK_EVENT,
      event,
      atMs: this.dependencies.now(),
      status: this.getStatus(),
      ...(chunk ? { chunkId: `${this.session?.id ?? 'none'}:${chunk.globalChunkIndex}`, transition: chunk.transitionAfter } : {}),
    }
    this.diagnostics.push(entry)
    if (this.diagnostics.length > 200) this.diagnostics.splice(0, this.diagnostics.length - 200)
    this.dependencies.emit(entry)
  }

  private wakeAll(): void {
    const waiters = [...this.wakeWaiters]
    this.wakeWaiters.clear()
    waiters.forEach((wake) => wake())
  }

  private waitForSignal(milliseconds?: number): Promise<'signal' | 'timeout'> {
    return new Promise((resolve) => {
      let settled = false
      const finish = (result: 'signal' | 'timeout') => {
        if (settled) return
        settled = true
        this.wakeWaiters.delete(onSignal)
        resolve(result)
      }
      const onSignal = () => finish('signal')
      this.wakeWaiters.add(onSignal)
      if (milliseconds !== undefined) {
        void this.dependencies.sleep(Math.max(0, milliseconds)).then(
          () => finish('timeout'),
          () => finish('timeout'),
        )
      }
    })
  }

  private cleanupError(stage: PlaybackCleanupStage, cause?: unknown): AudioCleanupError {
    this.playerDiagnostics.cleanupFailureCount += 1
    this.playerDiagnostics.lastCleanupFailureStage = stage
    return new AudioCleanupError(
      createPlaybackError(
        'AUDIO_CLEANUP_FAILED',
        `Audio cleanup failed during ${stage}.`,
        undefined,
        stage,
      ),
      cause,
    )
  }

  private decrementActivePlayer(): AudioCleanupError | null {
    if (this.playerDiagnostics.activePlayerCount <= 0) {
      this.playerDiagnostics.invariantViolationCount += 1
      return this.cleanupError('accounting')
    }
    this.playerDiagnostics.activePlayerCount -= 1
    return null
  }

  private incrementAudiblePlayer(active: ActivePlayback, initialStart: boolean): void {
    if (active.settled || active.audible || this.activePlayback !== active) return
    active.audible = true
    if (initialStart) {
      active.started = true
      this.playerDiagnostics.successfulPlayStartCount += 1
    }
    this.playerDiagnostics.activePlayerCount += 1
    this.playerDiagnostics.maxActivePlayerCount = Math.max(
      this.playerDiagnostics.maxActivePlayerCount,
      this.playerDiagnostics.activePlayerCount,
    )
    if (this.playerDiagnostics.activePlayerCount > 1) {
      this.playerDiagnostics.invariantViolationCount += 1
      this.settleActivePlayback(
        active,
        new AudioCleanupError(createPlaybackError(
          'AUDIO_CLEANUP_FAILED',
          'The single-player playback invariant was violated.',
          undefined,
          'accounting',
        )),
        false,
      )
    }
  }

  private markPlayStarted(active: ActivePlayback): void {
    this.incrementAudiblePlayer(active, true)
  }

  private settleActivePlayback(active: ActivePlayback, error?: Error, alreadyEnded = false): PlaybackError | null {
    if (active.settled) return null
    active.settled = true
    if (this.activePlayback === active) this.activePlayback = null
    this.audio.onended = null
    this.audio.onerror = null

    let cleanupFailure: AudioCleanupError | null = null
    let stopped = alreadyEnded
    if (!alreadyEnded) {
      try {
        this.audio.pause()
        stopped = true
      } catch (cause) {
        cleanupFailure = this.cleanupError('pause', cause)
      }
    }

    if (active.audible && stopped) {
      active.audible = false
      cleanupFailure ??= this.decrementActivePlayer()
    }

    // If pause failed, retain src and object URL so every later request can
    // retry cleanup. Discarding those handles would allow an uncertain player
    // to escape the fail-closed gate.
    if (stopped) {
      try {
        this.audio.removeAttribute('src')
      } catch (cause) {
        cleanupFailure ??= this.cleanupError('clear-source', cause)
      }

      try {
        this.audio.load()
      } catch {
        this.playerDiagnostics.cleanupFailureCount += 1
        this.playerDiagnostics.lastCleanupFailureStage = 'reload'
      }

      if (this.currentObjectUrl === active.objectUrl) {
        try {
          this.dependencies.revokeObjectUrl(active.objectUrl)
          this.currentObjectUrl = null
        } catch (cause) {
          cleanupFailure ??= this.cleanupError('revoke-url', cause)
        }
      }
    }

    this.playerDiagnostics.settlementCount += 1
    const settledError = cleanupFailure ?? error
    active.settle(settledError ?? undefined)
    return cleanupFailure?.detail ?? null
  }

  private cleanupOrphanedSource(): PlaybackError | null {
    if (!this.currentObjectUrl) {
      if (this.playerDiagnostics.activePlayerCount > 0) return this.cleanupError('accounting').detail
      return null
    }

    try {
      this.audio.pause()
    } catch (cause) {
      return this.cleanupError('pause', cause).detail
    }

    let failure: AudioCleanupError | null = null
    if (this.playerDiagnostics.activePlayerCount > 0) {
      failure = this.decrementActivePlayer()
    }
    try {
      this.audio.removeAttribute('src')
    } catch (cause) {
      failure ??= this.cleanupError('clear-source', cause)
    }
    try {
      this.audio.load()
    } catch {
      this.playerDiagnostics.cleanupFailureCount += 1
      this.playerDiagnostics.lastCleanupFailureStage = 'reload'
    }
    if (!failure) {
      try {
        this.dependencies.revokeObjectUrl(this.currentObjectUrl)
        this.currentObjectUrl = null
      } catch (cause) {
        failure = this.cleanupError('revoke-url', cause)
      }
    }
    return failure?.detail ?? null
  }

  private stopAudio(error?: Error): PlaybackError | null {
    const active = this.activePlayback
    if (active) return this.settleActivePlayback(active, error, false)
    return this.cleanupOrphanedSource()
  }

  private async supersedeCurrent(): Promise<PlaybackError | null> {
    const current = this.session
    if (!current) return this.stopAudio(new SessionInterruptedError('superseded'))

    current.fetchControllers.forEach((controller) => controller.abort())
    current.fetchControllers.clear()
    this.wakeAll()
    const cleanupFailure = this.stopAudio(new SessionInterruptedError('superseded'))
    if (cleanupFailure) {
      current.error = cleanupFailure
      current.state = 'failed'
      this.emit('failed')
      return cleanupFailure
    }

    if (!isTerminalState(current.state)) {
      current.state = 'cancelled'
      current.error = createPlaybackError('SESSION_SUPERSEDED', 'Playback was superseded by a newer request.')
      this.emit('superseded')
    }
    current.cancelled = true
    this.session = null
    return null
  }

  private pauseSession(session: Session): void {
    if (!this.isCurrent(session) || session.paused || isTerminalState(session.state)) return
    session.paused = true
    session.stateBeforePause = session.state
    const active = this.activePlayback?.sessionId === session.id ? this.activePlayback : null
    if (active) {
      try {
        this.audio.pause()
        if (active.audible) {
          active.audible = false
          const accountingFailure = this.decrementActivePlayer()
          if (accountingFailure) throw accountingFailure
        }
      } catch (cause) {
        const cleanupFailure = this.stopAudio(cause instanceof Error ? cause : new Error(String(cause)))
        session.error = cleanupFailure ?? createPlaybackError('AUDIO_PLAYBACK_FAILED', 'Audio playback could not pause.')
        session.state = 'failed'
        this.emit('failed')
        this.wakeAll()
        return
      }
    }
    session.state = 'paused'
    this.emit('state-changed')
    this.wakeAll()
  }

  private async resumeSession(session: Session): Promise<void> {
    if (!this.isCurrent(session) || !session.paused || isTerminalState(session.state)) return
    session.paused = false
    session.state = session.stateBeforePause
    const active = this.activePlayback?.sessionId === session.id ? this.activePlayback : null
    if (active) {
      try {
        await this.audio.play()
        this.incrementAudiblePlayer(active, false)
      } catch (cause) {
        const cleanupFailure = this.stopAudio(cause instanceof Error ? cause : new Error(String(cause)))
        session.error = cleanupFailure ?? createPlaybackError('AUDIO_PLAYBACK_FAILED', 'Audio playback could not resume.')
        session.state = 'failed'
        this.emit('failed')
        this.wakeAll()
        return
      }
    }
    this.emit('state-changed')
    this.wakeAll()
  }

  private async cancelSession(session: Session, emitEvent: boolean, superseded: boolean): Promise<PlaybackError | null> {
    if (session.cancelled || isTerminalState(session.state)) return null
    session.fetchControllers.forEach((controller) => controller.abort())
    session.fetchControllers.clear()
    session.paused = false
    this.wakeAll()
    const cleanupFailure = this.stopAudio(new SessionInterruptedError(superseded ? 'superseded' : 'cancelled'))
    if (cleanupFailure) {
      session.error = cleanupFailure
      session.state = 'failed'
      if (emitEvent) this.emit('failed')
      return cleanupFailure
    }
    session.state = 'cancelled'
    session.error = createPlaybackError(
      superseded ? 'SESSION_SUPERSEDED' : 'CANCELLED',
      superseded ? 'Playback was superseded by a newer request.' : 'Playback was cancelled.',
    )
    if (emitEvent) this.emit(superseded ? 'superseded' : 'cancelled')
    session.cancelled = true
    return null
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
    } catch (error) {
      if (error instanceof TtsClientError || error instanceof SessionInterruptedError) throw error
      if (controller.signal.aborted || !this.isCurrent(session)) {
        throw new SessionInterruptedError('synthesis was interrupted')
      }
      throw new TtsClientError(
        createPlaybackError('TTS_FETCH_FAILED', 'The TTS request failed before audio was returned.'),
        error,
      )
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
    const staleCleanup = this.stopAudio(new SessionInterruptedError('starting next chunk'))
    if (staleCleanup) throw new AudioCleanupError(staleCleanup)

    let objectUrl: string
    try {
      objectUrl = this.dependencies.createObjectUrl(new Blob([audioData.bytes], { type: audioData.mime }))
      this.currentObjectUrl = objectUrl
      this.audio.src = objectUrl
      this.audio.playbackRate = session.settings.rate
    } catch (cause) {
      throw new AudioPlaybackError('Audio source setup failed.', cause)
    }

    await new Promise<void>((resolve, reject) => {
      const active: ActivePlayback = {
        sessionId: session.id,
        chunkId: chunk.id,
        attemptId: ++this.nextPlayAttemptId,
        objectUrl,
        settled: false,
        started: false,
        audible: false,
        settle: (error) => {
          if (error) reject(error)
          else resolve()
        },
      }
      this.playerDiagnostics.playAttemptCount += 1
      this.activePlayback = active

      const finish = (error?: Error, alreadyEnded = false) => {
        this.settleActivePlayback(active, error, alreadyEnded)
      }

      this.audio.onended = () => finish(undefined, true)
      this.audio.onerror = () => finish(new AudioPlaybackError('Audio playback failed.'))

      try {
        const playPromise = this.audio.play()
        void playPromise.then(
          () => this.markPlayStarted(active),
          (cause) => finish(new AudioPlaybackError('Audio playback could not start.', cause)),
        )
      } catch (cause) {
        finish(new AudioPlaybackError('Audio playback could not start.', cause))
      }
    })
  }

  private async waitWhilePaused(session: Session): Promise<void> {
    while (this.isCurrent(session) && session.paused) await this.waitForSignal()
    if (!this.isCurrent(session)) throw new SessionInterruptedError('session is inactive')
  }

  private async waitForTransition(session: Session, milliseconds: number): Promise<void> {
    if (milliseconds <= 0) return
    this.setState(session, 'waiting')
    let remaining = milliseconds

    while (remaining > 0) {
      await this.waitWhilePaused(session)
      if (!this.isCurrent(session)) throw new SessionInterruptedError('session is inactive')
      const before = this.dependencies.now()
      const result = await this.waitForSignal(remaining)
      const elapsed = Math.max(0, this.dependencies.now() - before)
      if (!this.isCurrent(session)) throw new SessionInterruptedError('session is inactive')
      remaining = result === 'timeout' ? 0 : Math.max(0, remaining - elapsed)
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
        await this.waitWhilePaused(session)
        if (!this.isCurrent(session)) return

        const nextChunk = session.chunks[index + 1]
        const nextAudioPromise = nextChunk ? this.fetchChunkSettled(session, nextChunk) : null

        this.setState(session, 'playing')
        this.emit('chunk-started', chunk)
        await this.playChunk(session, chunk, currentResult.audio)
        if (!this.isCurrent(session)) return
        await this.waitWhilePaused(session)
        if (!this.isCurrent(session)) return
        this.emit('chunk-ended', chunk)

        if (nextAudioPromise) {
          await this.waitForTransition(session, getTransitionGapMs(chunk.transitionAfter, session.settings.rate))
          currentAudioPromise = nextAudioPromise
          this.setState(session, 'synthesizing')
        }
      }

      if (!this.isCurrent(session)) return
      const cleanupFailure = this.stopAudio()
      if (cleanupFailure) throw new AudioCleanupError(cleanupFailure)
      session.state = 'completed'
      this.emit('completed')
    } catch (error) {
      if (error instanceof SessionInterruptedError || session.cancelled || !this.isCurrent(session)) return
      const cleanupFailure = this.stopAudio()
      const detail = cleanupFailure
        ?? (error instanceof AudioCleanupError
          ? error.detail
          : error instanceof AudioPlaybackError
            ? error.detail
            : error instanceof TtsClientError
              ? error.detail
              : createPlaybackError('INTERNAL_PLAYBACK_ERROR', 'Playback failed unexpectedly.'))
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
