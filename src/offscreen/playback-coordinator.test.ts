import { describe, expect, it, vi } from 'vitest'
import { createPlaybackError, START_PLAYBACK, type PlaybackEvent, type StartPlaybackRequest } from '../lib/playback-protocol'
import { TtsClientError } from '../lib/tts-client'
import { createBrowserPlaybackCoordinator, PlaybackCoordinator } from './playback-coordinator'

class FakeAudio {
  private source = ''
  private rate = 1
  sourceAssignmentFailure: Error | null = null
  playbackRateAssignmentFailure: Error | null = null

  get src(): string { return this.source }
  set src(value: string) {
    if (this.sourceAssignmentFailure) throw this.sourceAssignmentFailure
    this.source = value
  }

  get playbackRate(): number { return this.rate }
  set playbackRate(value: number) {
    if (this.playbackRateAssignmentFailure) throw this.playbackRateAssignmentFailure
    this.rate = value
  }
  preload = ''
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  playing = false
  activeSources = 0
  maxActiveSources = 0
  trace: string[] = []
  pauseFailure: Error | null = null
  clearSourceFailure: Error | null = null
  loadFailure: Error | null = null
  synchronousPlayFailure: Error | null = null
  rejectedPlayFailure: Error | null = null

  play(): Promise<void> {
    this.trace.push(`play:${this.src}`)
    if (this.synchronousPlayFailure) throw this.synchronousPlayFailure
    if (this.rejectedPlayFailure) return Promise.reject(this.rejectedPlayFailure)
    if (!this.playing) {
      this.playing = true
      this.activeSources += 1
      this.maxActiveSources = Math.max(this.maxActiveSources, this.activeSources)
    }
    return Promise.resolve()
  }

  pause(): void {
    this.trace.push('pause')
    if (this.pauseFailure) throw this.pauseFailure
    if (this.playing) {
      this.playing = false
      this.activeSources -= 1
    }
  }

  removeAttribute(name: string): void {
    this.trace.push(`remove:${name}`)
    if (this.clearSourceFailure) throw this.clearSourceFailure
    if (name === 'src') this.src = ''
  }

  load(): void {
    this.trace.push('load')
    if (this.loadFailure) throw this.loadFailure
  }

  finish(): void {
    if (this.playing) {
      this.playing = false
      this.activeSources -= 1
    }
    this.onended?.()
  }

  fail(): void {
    if (this.playing) {
      this.playing = false
      this.activeSources -= 1
    }
    this.onerror?.()
  }
}

function request(text: string, requestId: string, source: StartPlaybackRequest['source'] = 'selection'): StartPlaybackRequest {
  return {
    kind: START_PLAYBACK,
    requestId,
    source,
    text,
    settings: { ttsUrl: 'http://localhost:5002/api/tts', voice: 'p225', rate: 1 },
  }
}

function lastIndexMatching(values: string[], predicate: (value: string) => boolean): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index])) return index
  }
  return -1
}

function harness(options: {
  createObjectUrl?: (blob: Blob) => string
  revokeObjectUrl?: (url: string) => void
  fetchAudio?: () => Promise<{ bytes: ArrayBuffer; mime: string }>
} = {}) {
  const audio = new FakeAudio()
  const events: PlaybackEvent[] = []
  let sessionCounter = 0
  let urlCounter = 0
  let now = 0
  const fetchAudio = vi.fn(options.fetchAudio ?? (async () => ({ bytes: new Uint8Array([1, 2, 3]).buffer, mime: 'audio/wav' })))
  const revokeObjectUrl = vi.fn(options.revokeObjectUrl ?? (() => undefined))
  const coordinator = new PlaybackCoordinator({
    createAudio: () => audio as unknown as HTMLAudioElement,
    createObjectUrl: options.createObjectUrl ?? (() => `blob:test-${++urlCounter}`),
    revokeObjectUrl,
    fetchAudio,
    createSessionId: () => `session-${++sessionCounter}`,
    now: () => now,
    sleep: async (milliseconds) => { now += milliseconds },
    emit: (event) => events.push(event),
  })
  return { audio, coordinator, events, fetchAudio, revokeObjectUrl }
}

async function waitForPlay(audio: FakeAudio, count: number) {
  await vi.waitFor(() => {
    expect(audio.trace.filter((entry) => entry.startsWith('play:'))).toHaveLength(count)
  })
}

async function waitForStartedPlayer(coordinator: PlaybackCoordinator) {
  await vi.waitFor(() => expect(coordinator.getPlayerDiagnostics().activePlayerCount).toBe(1))
}

describe('PlaybackCoordinator', () => {
  it('accepts promptly and settles player accounting after completion', async () => {
    const { audio, coordinator } = harness()
    await expect(coordinator.start(request('Hello.', 'request-1'))).resolves.toMatchObject({
      ok: true,
      accepted: true,
      sessionId: 'session-1',
    })
    await waitForPlay(audio, 1)
    await waitForStartedPlayer(coordinator)
    expect(coordinator.getStatus()).toMatchObject({ state: 'playing', sequence: expect.any(Number) })
    audio.finish()
    await vi.waitFor(() => expect(coordinator.getStatus().state).toBe('completed'))
    expect(coordinator.getPlayerDiagnostics()).toMatchObject({
      activePlayerCount: 0,
      maxActivePlayerCount: 1,
      successfulPlayStartCount: 1,
      settlementCount: 1,
      invariantViolationCount: 0,
    })
  })

  it('stops the old source before replacement and emits superseded before accepted', async () => {
    const { audio, coordinator, events } = harness()
    await coordinator.start(request('First.', 'request-1'))
    await waitForPlay(audio, 1)
    await waitForStartedPlayer(coordinator)

    const second = await coordinator.start(request('Second.', 'request-2', 'popup-test'))
    expect(second).toMatchObject({ ok: true, sessionId: 'session-2' })
    await waitForPlay(audio, 2)

    const secondPlayIndex = lastIndexMatching(audio.trace, (entry) => entry.startsWith('play:'))
    const pauseBeforeSecond = lastIndexMatching(audio.trace.slice(0, secondPlayIndex), (entry) => entry === 'pause')
    expect(pauseBeforeSecond).toBeGreaterThanOrEqual(0)
    expect(audio.maxActiveSources).toBe(1)
    expect(coordinator.getPlayerDiagnostics().maxActivePlayerCount).toBe(1)
    expect(coordinator.getStatus()).toMatchObject({ requestId: 'request-2', source: 'popup-test', state: 'playing' })

    const supersededIndex = events.findIndex((event) => event.event === 'superseded')
    const replacementAcceptedIndex = events.findIndex((event, index) => (
      index > supersededIndex && event.event === 'accepted' && event.status.requestId === 'request-2'
    ))
    expect(supersededIndex).toBeGreaterThanOrEqual(0)
    expect(replacementAcceptedIndex).toBeGreaterThan(supersededIndex)
    expect(events[supersededIndex].status.error?.code).toBe('SESSION_SUPERSEDED')
  })

  it('handles five rapid mixed-source starts without overlap or old completion', async () => {
    const { audio, coordinator, events } = harness()
    const sources: StartPlaybackRequest['source'][] = ['selection', 'popup-test', 'options-test', 'debug-fixture', 'selection']

    for (let index = 0; index < sources.length; index += 1) {
      const result = await coordinator.start(request(`Request ${index}.`, `request-${index}`, sources[index]))
      expect(result.ok).toBe(true)
      await waitForPlay(audio, index + 1)
    }

    expect(audio.maxActiveSources).toBe(1)
    expect(coordinator.getPlayerDiagnostics().maxActivePlayerCount).toBe(1)
    audio.finish()
    await vi.waitFor(() => expect(coordinator.getStatus().state).toBe('completed'))

    const completedRequests = events
      .filter((event) => event.event === 'completed')
      .map((event) => event.status.requestId)
    expect(completedRequests).toEqual(['request-4'])
    expect(events.filter((event) => event.event === 'superseded')).toHaveLength(4)
  })

  it('ignores stale completion and error callbacks from a superseded session', async () => {
    const { audio, coordinator } = harness()
    await coordinator.start(request('First.', 'request-1'))
    await waitForPlay(audio, 1)
    const staleEnded = audio.onended
    const staleError = audio.onerror

    await coordinator.start(request('Second.', 'request-2'))
    await waitForPlay(audio, 2)
    staleEnded?.()
    staleError?.()

    expect(coordinator.getStatus()).toMatchObject({ requestId: 'request-2', state: 'playing' })
    expect(coordinator.getPlayerDiagnostics().activePlayerCount).toBe(1)
  })

  it('makes duplicate ended callbacks idempotent', async () => {
    const { audio, coordinator, revokeObjectUrl } = harness()
    await coordinator.start(request('Hello.', 'request-1'))
    await waitForPlay(audio, 1)
    const ended = audio.onended
    audio.finish()
    ended?.()
    await vi.waitFor(() => expect(coordinator.getStatus().state).toBe('completed'))
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1)
    expect(coordinator.getPlayerDiagnostics()).toMatchObject({ activePlayerCount: 0, settlementCount: 1 })
  })

  it('rejects replacement when pause cleanup fails and never starts a second source', async () => {
    const { audio, coordinator } = harness()
    await coordinator.start(request('First.', 'request-1'))
    await waitForPlay(audio, 1)
    await waitForStartedPlayer(coordinator)
    audio.pauseFailure = new Error('pause failed')

    const replacement = await coordinator.start(request('Second.', 'request-2'))

    expect(replacement).toMatchObject({
      ok: false,
      error: { code: 'AUDIO_CLEANUP_FAILED', stage: 'pause' },
    })
    expect(audio.trace.filter((entry) => entry.startsWith('play:'))).toHaveLength(1)
    expect(audio.maxActiveSources).toBe(1)
    expect(coordinator.getStatus()).toMatchObject({ state: 'failed', error: { code: 'AUDIO_CLEANUP_FAILED' } })
  })

  it('rejects replacement when source clearing fails after the old player is paused', async () => {
    const { audio, coordinator } = harness()
    await coordinator.start(request('First.', 'request-1'))
    await waitForPlay(audio, 1)
    await waitForStartedPlayer(coordinator)
    audio.clearSourceFailure = new Error('clear failed')

    const replacement = await coordinator.start(request('Second.', 'request-2'))

    expect(replacement).toMatchObject({
      ok: false,
      error: { code: 'AUDIO_CLEANUP_FAILED', stage: 'clear-source' },
    })
    expect(audio.playing).toBe(false)
    expect(audio.trace.filter((entry) => entry.startsWith('play:'))).toHaveLength(1)
    expect(coordinator.getPlayerDiagnostics().activePlayerCount).toBe(0)
  })

  it('rejects replacement and retries object URL revocation before a later start', async () => {
    let failRevoke = true
    const { audio, coordinator, revokeObjectUrl } = harness({
      revokeObjectUrl: () => {
        if (failRevoke) throw new Error('revoke failed')
      },
    })
    await coordinator.start(request('First.', 'request-1'))
    await waitForPlay(audio, 1)
    await waitForStartedPlayer(coordinator)

    const replacement = await coordinator.start(request('Second.', 'request-2'))
    expect(replacement).toMatchObject({
      ok: false,
      error: { code: 'AUDIO_CLEANUP_FAILED', stage: 'revoke-url' },
    })
    expect(audio.trace.filter((entry) => entry.startsWith('play:'))).toHaveLength(1)
    const failedAttemptCount = revokeObjectUrl.mock.calls.length
    expect(failedAttemptCount).toBeGreaterThanOrEqual(1)

    failRevoke = false
    const retry = await coordinator.start(request('Third.', 'request-3'))
    expect(retry.ok).toBe(true)
    expect(revokeObjectUrl).toHaveBeenCalledTimes(failedAttemptCount + 1)
    await waitForPlay(audio, 2)
  })

  it('treats audio reload failure as recorded best-effort cleanup only', async () => {
    const { audio, coordinator } = harness()
    await coordinator.start(request('First.', 'request-1'))
    await waitForPlay(audio, 1)
    audio.loadFailure = new Error('load failed')

    const replacement = await coordinator.start(request('Second.', 'request-2'))
    expect(replacement.ok).toBe(true)
    await waitForPlay(audio, 2)
    expect(coordinator.getPlayerDiagnostics()).toMatchObject({
      maxActivePlayerCount: 1,
      cleanupFailureCount: 1,
      lastCleanupFailureStage: 'reload',
    })
  })

  it('classifies synchronous and rejected play failures without leaking a player', async () => {
    const synchronous = harness()
    synchronous.audio.synchronousPlayFailure = new Error('sync play failed')
    await synchronous.coordinator.start(request('Hello.', 'request-sync'))
    await vi.waitFor(() => expect(synchronous.coordinator.getStatus().state).toBe('failed'))
    expect(synchronous.coordinator.getStatus().error?.code).toBe('AUDIO_PLAYBACK_FAILED')
    expect(synchronous.coordinator.getPlayerDiagnostics().activePlayerCount).toBe(0)

    const rejected = harness()
    rejected.audio.rejectedPlayFailure = new Error('rejected play')
    await rejected.coordinator.start(request('Hello.', 'request-reject'))
    await vi.waitFor(() => expect(rejected.coordinator.getStatus().state).toBe('failed'))
    expect(rejected.coordinator.getStatus().error?.code).toBe('AUDIO_PLAYBACK_FAILED')
    expect(rejected.coordinator.getPlayerDiagnostics().activePlayerCount).toBe(0)
  })

  it('owns multi-chunk progression and prefetches only the next chunk', async () => {
    const { audio, coordinator, fetchAudio } = harness()
    await coordinator.start(request('First paragraph.\n\nSecond paragraph.', 'request-1'))
    await waitForPlay(audio, 1)
    expect(fetchAudio).toHaveBeenCalledTimes(2)

    audio.finish()
    await waitForPlay(audio, 2)
    audio.finish()
    await vi.waitFor(() => expect(coordinator.getStatus().state).toBe('completed'))
    expect(fetchAudio).toHaveBeenCalledTimes(2)
    expect(coordinator.getPlayerDiagnostics()).toMatchObject({ activePlayerCount: 0, maxActivePlayerCount: 1 })
  })

  it('does not start fetched audio while synthesis is paused', async () => {
    const audio = new FakeAudio()
    let resolveFetch: ((value: { bytes: ArrayBuffer; mime: string }) => void) | undefined
    const fetchAudio = vi.fn(() => new Promise<{ bytes: ArrayBuffer; mime: string }>((resolve) => {
      resolveFetch = resolve
    }))
    const coordinator = new PlaybackCoordinator({
      createAudio: () => audio as unknown as HTMLAudioElement,
      createObjectUrl: () => 'blob:paused-fetch',
      revokeObjectUrl: vi.fn(),
      fetchAudio,
      createSessionId: () => 'session-paused',
      now: () => performance.now(),
      sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, Math.min(milliseconds, 1))),
      emit: vi.fn(),
    })

    const started = await coordinator.start(request('Hello.', 'request-paused'))
    if (!started.ok) throw new Error('start failed')
    await vi.waitFor(() => expect(resolveFetch).toBeTypeOf('function'))
    await coordinator.control('pause', started.sessionId)
    resolveFetch?.({ bytes: new Uint8Array([1, 2, 3]).buffer, mime: 'audio/wav' })

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(audio.trace.some((entry) => entry.startsWith('play:'))).toBe(false)
    expect(coordinator.getStatus().state).toBe('paused')

    await coordinator.control('resume', started.sessionId)
    await waitForPlay(audio, 1)
  })

  it('classifies unexpected synthesis failures as TTS fetch failures', async () => {
    const audio = new FakeAudio()
    const coordinator = new PlaybackCoordinator({
      createAudio: () => audio as unknown as HTMLAudioElement,
      createObjectUrl: () => 'blob:unused',
      revokeObjectUrl: vi.fn(),
      fetchAudio: vi.fn(async () => { throw new Error('network failed') }),
      createSessionId: () => 'session-failed',
      now: () => 0,
      sleep: async () => undefined,
      emit: vi.fn(),
    })

    await coordinator.start(request('Hello.', 'request-failed'))
    await vi.waitFor(() => expect(coordinator.getStatus().state).toBe('failed'))
    expect(coordinator.getStatus().error?.code).toBe('TTS_FETCH_FAILED')
  })

  it('does not complete when an ended callback races with a paused session', async () => {
    const { audio, coordinator, events } = harness()
    const started = await coordinator.start(request('Pause ended race.', 'pause-ended-race'))
    if (!started.ok) throw new Error('start failed')
    await waitForPlay(audio, 1)
    await waitForStartedPlayer(coordinator)

    await coordinator.control('pause', started.sessionId)
    expect(coordinator.getStatus().state).toBe('paused')

    audio.finish()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(coordinator.getStatus().state).toBe('paused')
    expect(events.some((event) => event.event === 'completed')).toBe(false)

    await coordinator.control('resume', started.sessionId)
    await vi.waitFor(() => expect(coordinator.getStatus().state).toBe('completed'))
    expect(events.filter((event) => event.event === 'completed')).toHaveLength(1)
  })

  it('pauses, resumes, and cancels the same player idempotently', async () => {
    const { audio, coordinator } = harness()
    const started = await coordinator.start(request('Hello.', 'request-1'))
    if (!started.ok) throw new Error('start failed')
    await waitForPlay(audio, 1)
    await waitForStartedPlayer(coordinator)

    await coordinator.control('pause', started.sessionId)
    expect(coordinator.getStatus().state).toBe('paused')
    expect(audio.playing).toBe(false)

    await coordinator.control('resume', started.sessionId)
    expect(coordinator.getStatus().state).toBe('playing')
    expect(audio.playing).toBe(true)

    await coordinator.control('cancel', started.sessionId)
    await coordinator.control('cancel', started.sessionId)
    expect(coordinator.getStatus()).toMatchObject({ state: 'cancelled', error: { code: 'CANCELLED' } })
    expect(audio.playing).toBe(false)
    expect(coordinator.getPlayerDiagnostics().activePlayerCount).toBe(0)
  })

  it('rejects a stale expected session without affecting the replacement', async () => {
    const { audio, coordinator } = harness()
    const first = await coordinator.start(request('First.', 'request-1'))
    if (!first.ok) throw new Error('first start failed')
    await waitForPlay(audio, 1)
    const second = await coordinator.start(request('Second.', 'request-2'))
    if (!second.ok) throw new Error('second start failed')
    await waitForPlay(audio, 2)

    await expect(coordinator.control('cancel', first.sessionId)).resolves.toMatchObject({
      ok: false,
      error: { code: 'SESSION_NOT_FOUND' },
    })
    expect(coordinator.getStatus()).toMatchObject({ sessionId: second.sessionId, state: 'playing' })
  })
})

describe('PlaybackCoordinator additional failure coverage', () => {
  it('rejects invalid text and unusable TTS endpoints before creating a session', async () => {
    const { coordinator, fetchAudio } = harness()

    await expect(coordinator.start(request('   ', 'empty'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'NO_TEXT' },
    })
    await expect(coordinator.start({
      ...request('Hello.', 'invalid-url'),
      settings: { ...request('Hello.', 'invalid-url').settings, ttsUrl: 'not a url' },
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_TTS_URL' },
    })
    await expect(coordinator.start({
      ...request('Hello.', 'host-play'),
      settings: { ...request('Hello.', 'host-play').settings, ttsUrl: 'http://localhost:5002/api/tts/play' },
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'HOST_PLAY_ENDPOINT_FORBIDDEN' },
    })
    expect(fetchAudio).not.toHaveBeenCalled()
    expect(coordinator.getStatus().state).toBe('idle')
    expect(coordinator.getDiagnosticEvents()).toEqual([])
  })

  it.each(['object-url', 'source', 'rate'] as const)('fails closed when %s setup throws and permits recovery', async (stage) => {
    let failObjectUrl = stage === 'object-url'
    const { audio, coordinator } = harness({
      createObjectUrl: () => {
        if (failObjectUrl) throw new Error('object url failed')
        return 'blob:recovered'
      },
    })
    if (stage === 'source') audio.sourceAssignmentFailure = new Error('source failed')
    if (stage === 'rate') audio.playbackRateAssignmentFailure = new Error('rate failed')

    await coordinator.start(request('First.', `setup-${stage}`))
    await vi.waitFor(() => expect(coordinator.getStatus().state).toBe('failed'))
    expect(coordinator.getStatus().error).toMatchObject({
      code: stage === 'source' ? 'AUDIO_CLEANUP_FAILED' : 'AUDIO_PLAYBACK_FAILED',
      ...(stage === 'source' ? { stage: 'clear-source' } : {}),
    })
    expect(coordinator.getPlayerDiagnostics()).toMatchObject({
      activePlayerCount: 0,
      maxActivePlayerCount: 0,
      invariantViolationCount: 0,
    })

    failObjectUrl = false
    audio.sourceAssignmentFailure = null
    audio.playbackRateAssignmentFailure = null
    const recovered = await coordinator.start(request('Recovered.', `recovered-${stage}`))
    expect(recovered.ok).toBe(true)
    await waitForPlay(audio, 1)
    audio.finish()
    await vi.waitFor(() => expect(coordinator.getStatus().state).toBe('completed'))
  })


  it('accepts HTTPS synthesis endpoints through the same browser-owned path', async () => {
    const { audio, coordinator, fetchAudio } = harness()
    const httpsRequest = request('Secure endpoint.', 'https-request')
    httpsRequest.settings.ttsUrl = 'https://tts.example.test/api/tts'

    await expect(coordinator.start(httpsRequest)).resolves.toMatchObject({ ok: true, accepted: true })
    await waitForPlay(audio, 1)
    expect(fetchAudio).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://tts.example.test/api/tts',
    }))
    audio.finish()
    await vi.waitFor(() => expect(coordinator.getStatus().state).toBe('completed'))
  })

  it('preserves structured TTS client failures without reclassifying them', async () => {
    const expected = createPlaybackError('TTS_HTTP_ERROR', 'The TTS service returned HTTP 503.', 503)
    const { coordinator } = harness({
      fetchAudio: async () => { throw new TtsClientError(expected) },
    })

    await coordinator.start(request('Hello.', 'structured-tts-error'))
    await vi.waitFor(() => expect(coordinator.getStatus().state).toBe('failed'))
    expect(coordinator.getStatus().error).toEqual(expected)
  })

  it('fails closed on pause cleanup failure and recovers only after cleanup succeeds', async () => {
    const { audio, coordinator } = harness()
    const started = await coordinator.start(request('Pause failure.', 'pause-failure'))
    if (!started.ok) throw new Error('start failed')
    await waitForPlay(audio, 1)
    await waitForStartedPlayer(coordinator)
    audio.pauseFailure = new Error('pause failed')

    await expect(coordinator.control('pause', started.sessionId)).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUDIO_CLEANUP_FAILED', stage: 'pause' },
    })
    expect(coordinator.getPlayerDiagnostics()).toMatchObject({
      activePlayerCount: 1,
      cleanupFailureCount: 2,
      lastCleanupFailureStage: 'pause',
    })

    audio.pauseFailure = null
    const recovered = await coordinator.start(request('Recovered.', 'pause-recovered'))
    expect(recovered.ok).toBe(true)
    await waitForPlay(audio, 2)
    expect(coordinator.getPlayerDiagnostics().activePlayerCount).toBe(1)
    audio.finish()
    await vi.waitFor(() => expect(coordinator.getStatus().state).toBe('completed'))
  })

  it('fails a paused session when audio cannot resume and leaves no active player', async () => {
    const { audio, coordinator } = harness()
    const started = await coordinator.start(request('Resume failure.', 'resume-failure'))
    if (!started.ok) throw new Error('start failed')
    await waitForPlay(audio, 1)
    await waitForStartedPlayer(coordinator)
    await coordinator.control('pause', started.sessionId)
    audio.rejectedPlayFailure = new Error('resume rejected')

    await expect(coordinator.control('resume', started.sessionId)).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUDIO_PLAYBACK_FAILED' },
    })
    expect(coordinator.getStatus().state).toBe('failed')
    expect(coordinator.getPlayerDiagnostics().activePlayerCount).toBe(0)
  })

  it('pauses a transition wait, resumes it, and ignores the stale timeout completion', async () => {
    const audio = new FakeAudio()
    const sleepResolvers: Array<() => void> = []
    const coordinator = new PlaybackCoordinator({
      createAudio: () => audio as unknown as HTMLAudioElement,
      createObjectUrl: (() => {
        let index = 0
        return () => `blob:transition-${++index}`
      })(),
      revokeObjectUrl: vi.fn(),
      fetchAudio: vi.fn(async () => ({ bytes: new Uint8Array([1]).buffer, mime: 'audio/wav' })),
      createSessionId: () => 'session-transition',
      now: () => 0,
      sleep: () => new Promise<void>((resolve) => sleepResolvers.push(resolve)),
      emit: vi.fn(),
    })

    const started = await coordinator.start(request('First paragraph.\n\nSecond paragraph.', 'transition-wait'))
    if (!started.ok) throw new Error('start failed')
    await waitForPlay(audio, 1)
    audio.finish()
    await vi.waitFor(() => expect(coordinator.getStatus().state).toBe('waiting'))
    await vi.waitFor(() => expect(sleepResolvers).toHaveLength(1))

    await coordinator.control('pause', started.sessionId)
    expect(coordinator.getStatus().state).toBe('paused')
    await coordinator.control('resume', started.sessionId)
    await vi.waitFor(() => expect(sleepResolvers).toHaveLength(2))

    sleepResolvers[0]()
    sleepResolvers[1]()
    await waitForPlay(audio, 2)
    audio.finish()
    await vi.waitFor(() => expect(coordinator.getStatus().state).toBe('completed'))
  })

  it('bounds retained diagnostic events to the most recent 200 entries', async () => {
    const { audio, coordinator } = harness()
    for (let index = 0; index < 35; index += 1) {
      await coordinator.start(request(`Diagnostic ${index}.`, `diagnostic-${index}`))
      await waitForPlay(audio, index + 1)
      audio.finish()
      await vi.waitFor(() => expect(coordinator.getStatus().state).toBe('completed'))
    }

    expect(coordinator.getDiagnosticEvents()).toHaveLength(200)
    expect(coordinator.getDiagnosticEvents().at(-1)?.event).toBe('completed')
  })

  it('aborts an active synthesis fetch during replacement and never starts stale bytes', async () => {
    const audio = new FakeAudio()
    const firstSignals: AbortSignal[] = []
    let resolveFirst: ((value: { bytes: ArrayBuffer; mime: string }) => void) | undefined
    const fetchAudio = vi.fn(({ signal, text }: { signal?: AbortSignal; text: string }) => {
      if (text.includes('First')) {
        if (signal) firstSignals.push(signal)
        return new Promise<{ bytes: ArrayBuffer; mime: string }>((resolve) => { resolveFirst = resolve })
      }
      return Promise.resolve({ bytes: new Uint8Array([9]).buffer, mime: 'audio/wav' })
    })
    let session = 0
    const coordinator = new PlaybackCoordinator({
      createAudio: () => audio as unknown as HTMLAudioElement,
      createObjectUrl: () => 'blob:replacement',
      revokeObjectUrl: vi.fn(),
      fetchAudio: fetchAudio as never,
      createSessionId: () => `session-abort-${++session}`,
      now: () => 0,
      sleep: async () => undefined,
      emit: vi.fn(),
    })

    await coordinator.start(request('First fetch.', 'first-fetch'))
    await vi.waitFor(() => expect(resolveFirst).toBeTypeOf('function'))
    await coordinator.start(request('Second replacement.', 'second-fetch'))
    expect(firstSignals[0]?.aborted).toBe(true)
    resolveFirst?.({ bytes: new Uint8Array([1]).buffer, mime: 'audio/wav' })
    await waitForPlay(audio, 1)
    expect(audio.src).toBe('blob:replacement')
    expect(coordinator.getStatus().requestId).toBe('second-fetch')
  })

  it('constructs the browser coordinator with the browser-owned audio path', async () => {
    const audio = new FakeAudio()
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:browser')
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.stubGlobal('Audio', vi.fn(() => audio))
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'browser-session') })
    vi.stubGlobal('performance', { now: vi.fn(() => 123) })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]))
          controller.close()
        },
      }),
      { status: 200, headers: { 'content-type': 'audio/wav' } },
    )))

    try {
      const events: PlaybackEvent[] = []
      const coordinator = createBrowserPlaybackCoordinator((event) => events.push(event))

      await coordinator.start(request('Browser path.', 'browser-request'))
      await waitForPlay(audio, 1)
      audio.finish()
      await vi.waitFor(() => expect(coordinator.getStatus().state).toBe('completed'))
      expect(createObjectUrl).toHaveBeenCalledTimes(1)
      expect(revokeObjectUrl).toHaveBeenCalledTimes(1)
      expect(events.some((event) => event.event === 'completed')).toBe(true)
    } finally {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    }
  })
})
