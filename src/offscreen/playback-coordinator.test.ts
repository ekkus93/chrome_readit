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

  async play(): Promise<void> {
    this.trace.push(`play:${this.src}`)
    if (!this.playing) {
      this.playing = true
      this.activeSources += 1
      this.maxActiveSources = Math.max(this.maxActiveSources, this.activeSources)
    }
  }

  pause(): void {
    this.trace.push('pause')
    if (this.playing) {
      this.playing = false
      this.activeSources -= 1
    }
  }

  removeAttribute(name: string): void {
    if (name === 'src') this.src = ''
  }

  load(): void {
    this.trace.push('load')
  }

  finish(): void {
    if (this.playing) {
      this.playing = false
      this.activeSources -= 1
    }
    this.onended?.()
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

function harness() {
  const audio = new FakeAudio()
  const events: PlaybackEvent[] = []
  let sessionCounter = 0
  let urlCounter = 0
  let now = 0
  const fetchAudio = vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]).buffer, mime: 'audio/wav' }))
  const coordinator = new PlaybackCoordinator({
    createAudio: () => audio as unknown as HTMLAudioElement,
    createObjectUrl: () => `blob:test-${++urlCounter}`,
    revokeObjectUrl: vi.fn(),
    fetchAudio,
    createSessionId: () => `session-${++sessionCounter}`,
    now: () => now,
    sleep: async (milliseconds) => { now += milliseconds },
    emit: (event) => events.push(event),
  })
  return { audio, coordinator, events, fetchAudio }
}

async function waitForPlay(audio: FakeAudio, count: number) {
  await vi.waitFor(() => {
    expect(audio.trace.filter((entry) => entry.startsWith('play:'))).toHaveLength(count)
  })
}

describe('PlaybackCoordinator', () => {
  it('accepts promptly and completes only after the active player ends', async () => {
    const { audio, coordinator } = harness()
    await expect(coordinator.start(request('Hello.', 'request-1'))).resolves.toMatchObject({
      ok: true,
      accepted: true,
      sessionId: 'session-1',
    })
    await waitForPlay(audio, 1)
    expect(coordinator.getStatus().state).toBe('playing')
    audio.finish()
    await vi.waitFor(() => expect(coordinator.getStatus().state).toBe('completed'))
  })

  it('stops the old source before replacement and never exceeds one active source', async () => {
    const { audio, coordinator } = harness()
    await coordinator.start(request('First.', 'request-1'))
    await waitForPlay(audio, 1)

    await coordinator.start(request('Second.', 'request-2', 'popup-test'))
    await waitForPlay(audio, 2)

    const secondPlayIndex = lastIndexMatching(audio.trace, (entry) => entry.startsWith('play:'))
    const pauseBeforeSecond = lastIndexMatching(audio.trace.slice(0, secondPlayIndex), (entry) => entry === 'pause')
    expect(pauseBeforeSecond).toBeGreaterThanOrEqual(0)
    expect(audio.maxActiveSources).toBe(1)
    expect(coordinator.getStatus()).toMatchObject({ requestId: 'request-2', source: 'popup-test', state: 'playing' })
  })

  it('ignores stale completion callbacks from a superseded session', async () => {
    const { audio, coordinator } = harness()
    await coordinator.start(request('First.', 'request-1'))
    await waitForPlay(audio, 1)
    const staleEnded = audio.onended

    await coordinator.start(request('Second.', 'request-2'))
    await waitForPlay(audio, 2)
    staleEnded?.()

    expect(coordinator.getStatus()).toMatchObject({ requestId: 'request-2', state: 'playing' })
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

    await coordinator.control('pause', started.sessionId)
    expect(coordinator.getStatus().state).toBe('paused')
    expect(audio.playing).toBe(false)

    await coordinator.control('resume', started.sessionId)
    expect(coordinator.getStatus().state).toBe('playing')
    expect(audio.playing).toBe(true)

    await coordinator.control('cancel', started.sessionId)
    await coordinator.control('cancel', started.sessionId)
    expect(coordinator.getStatus().state).toBe('cancelled')
    expect(audio.playing).toBe(false)
  })
})
