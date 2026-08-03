import { describe, expect, it, vi } from 'vitest'
import { START_PLAYBACK, type PlaybackEvent, type StartPlaybackRequest } from '../lib/playback-protocol'
import { PlaybackCoordinator } from './playback-coordinator'

class FakeAudio {
  src = ''
  playbackRate = 1
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

  async play(): Promise<void> {
    this.trace.push(`play:${this.src}`)
    if (this.synchronousPlayFailure) throw this.synchronousPlayFailure
    if (this.rejectedPlayFailure) return await Promise.reject(this.rejectedPlayFailure)
    if (!this.playing) {
      this.playing = true
      this.activeSources += 1
      this.maxActiveSources = Math.max(this.maxActiveSources, this.activeSources)
    }
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
    createObjectUrl: () => `blob:test-${++urlCounter}`,
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
