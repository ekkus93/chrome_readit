import { describe, expect, it, vi } from 'vitest'
import { getTransitionGapMs } from '../lib/playback-pacing'
import { START_PLAYBACK, type PlaybackEvent, type StartPlaybackRequest } from '../lib/playback-protocol'
import { PlaybackCoordinator } from './playback-coordinator'

class ControlledAudio {
  src = ''
  playbackRate = 1
  preload = ''
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  playing = false
  trace: string[] = []
  rejectedPlayFailure: Error | null = null

  async play(): Promise<void> {
    this.trace.push(`play:${this.src}`)
    if (this.rejectedPlayFailure) return await Promise.reject(this.rejectedPlayFailure)
    this.playing = true
  }

  pause(): void {
    this.trace.push('pause')
    this.playing = false
  }

  removeAttribute(name: string): void {
    this.trace.push(`remove:${name}`)
    if (name === 'src') this.src = ''
  }

  load(): void {
    this.trace.push('load')
  }

  finish(): void {
    this.playing = false
    this.onended?.()
  }

  fail(): void {
    this.playing = false
    this.onerror?.()
  }
}

type PendingSleep = {
  milliseconds: number
  resolve: () => void
}

function request(
  text: string,
  requestId: string,
  source: StartPlaybackRequest['source'] = 'selection',
  rate = 1,
): StartPlaybackRequest {
  return {
    kind: START_PLAYBACK,
    requestId,
    source,
    text,
    settings: { ttsUrl: 'http://localhost:5002/api/tts', voice: 'p225', rate },
  }
}

function harness() {
  const audio = new ControlledAudio()
  const events: PlaybackEvent[] = []
  const sleeps: PendingSleep[] = []
  let sessionCounter = 0
  let objectUrlCounter = 0
  let now = 0

  const coordinator = new PlaybackCoordinator({
    createAudio: () => audio as unknown as HTMLAudioElement,
    createObjectUrl: () => `blob:extra-${++objectUrlCounter}`,
    revokeObjectUrl: vi.fn(),
    fetchAudio: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]).buffer, mime: 'audio/wav' })),
    createSessionId: () => `session-extra-${++sessionCounter}`,
    now: () => now,
    sleep: (milliseconds) => new Promise<void>((resolve) => {
      let completed = false
      sleeps.push({
        milliseconds,
        resolve: () => {
          if (completed) return
          completed = true
          now += milliseconds
          resolve()
        },
      })
    }),
    emit: (event) => events.push(event),
  })

  return {
    audio,
    coordinator,
    events,
    sleeps,
    advanceNow: (milliseconds: number) => { now += milliseconds },
  }
}

async function waitForPlay(audio: ControlledAudio, count: number): Promise<void> {
  await vi.waitFor(() => {
    expect(audio.trace.filter((entry) => entry.startsWith('play:'))).toHaveLength(count)
  })
}

async function waitForState(coordinator: PlaybackCoordinator, state: string): Promise<void> {
  await vi.waitFor(() => expect(coordinator.getStatus().state).toBe(state))
}

const transitionCases = [
  {
    transition: 'continuation' as const,
    text: `Oversized continuation ${'continuation '.repeat(50).trim()}.`,
  },
  {
    transition: 'sentence' as const,
    text: `Sentence alpha ${'alpha '.repeat(40).trim()}. Sentence beta ${'beta '.repeat(40).trim()}.`,
  },
  {
    transition: 'paragraph' as const,
    text: 'First paragraph.\n\nSecond paragraph.',
  },
]

describe('PlaybackCoordinator FIX2 lifecycle regressions', () => {
  it('handles three rapid starts with only the final session completing', async () => {
    const { audio, coordinator, events } = harness()

    for (let index = 0; index < 3; index += 1) {
      await expect(coordinator.start(request(`Rapid ${index}.`, `rapid-${index}`))).resolves.toMatchObject({ ok: true })
      await waitForPlay(audio, index + 1)
    }

    audio.finish()
    await waitForState(coordinator, 'completed')

    expect(events.filter((event) => event.event === 'superseded')).toHaveLength(2)
    expect(events.filter((event) => event.event === 'completed').map((event) => event.status.requestId)).toEqual(['rapid-2'])
    expect(coordinator.getPlayerDiagnostics()).toMatchObject({
      activePlayerCount: 0,
      maxActivePlayerCount: 1,
      invariantViolationCount: 0,
    })
  })

  it('settles exactly once when media error is followed by a stale ended callback', async () => {
    const { audio, coordinator } = harness()
    await coordinator.start(request('Error then ended.', 'error-ended'))
    await waitForPlay(audio, 1)
    const staleEnded = audio.onended

    audio.fail()
    staleEnded?.()
    await waitForState(coordinator, 'failed')

    expect(coordinator.getPlayerDiagnostics()).toMatchObject({
      activePlayerCount: 0,
      settlementCount: 1,
      invariantViolationCount: 0,
    })
  })

  it('replaces a paused session without reviving the old player', async () => {
    const { audio, coordinator, events } = harness()
    const first = await coordinator.start(request('First paused session.', 'paused-first'))
    if (!first.ok) throw new Error('first start failed')
    await waitForPlay(audio, 1)
    await coordinator.control('pause', first.sessionId)
    await waitForState(coordinator, 'paused')

    const second = await coordinator.start(request('Replacement session.', 'paused-second', 'popup-test'))
    expect(second).toMatchObject({ ok: true })
    await waitForPlay(audio, 2)

    expect(events.some((event) => event.event === 'superseded' && event.status.sessionId === first.sessionId)).toBe(true)
    expect(coordinator.getStatus()).toMatchObject({ requestId: 'paused-second', state: 'playing' })
    expect(coordinator.getPlayerDiagnostics()).toMatchObject({
      activePlayerCount: 1,
      maxActivePlayerCount: 1,
      invariantViolationCount: 0,
    })
  })

  it('turns a rejected resume into a visible terminal playback failure', async () => {
    const { audio, coordinator } = harness()
    const started = await coordinator.start(request('Resume failure.', 'resume-failure'))
    if (!started.ok) throw new Error('start failed')
    await waitForPlay(audio, 1)
    await coordinator.control('pause', started.sessionId)
    audio.rejectedPlayFailure = new Error('resume rejected')

    await expect(coordinator.control('resume', started.sessionId)).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUDIO_PLAYBACK_FAILED' },
    })
    await waitForState(coordinator, 'failed')
    expect(coordinator.getPlayerDiagnostics().activePlayerCount).toBe(0)
  })

  for (const testCase of transitionCases) {
    it(`freezes and resumes the remaining ${testCase.transition} gap`, async () => {
      const { audio, coordinator, sleeps, advanceNow } = harness()
      const started = await coordinator.start(request(testCase.text, `gap-${testCase.transition}`))
      if (!started.ok) throw new Error('start failed')
      await waitForPlay(audio, 1)
      audio.finish()
      await waitForState(coordinator, 'waiting')
      await vi.waitFor(() => expect(sleeps).toHaveLength(1))

      const expectedGap = getTransitionGapMs(testCase.transition, 1)
      expect(sleeps[0].milliseconds).toBe(expectedGap)
      const elapsedBeforePause = Math.floor(expectedGap / 2)
      advanceNow(elapsedBeforePause)
      await coordinator.control('pause', started.sessionId)
      await waitForState(coordinator, 'paused')
      await coordinator.control('resume', started.sessionId)
      await vi.waitFor(() => expect(sleeps).toHaveLength(2))

      expect(sleeps[1].milliseconds).toBe(expectedGap - elapsedBeforePause)
      expect(audio.trace.filter((entry) => entry.startsWith('play:'))).toHaveLength(1)
      sleeps[1].resolve()
      await waitForPlay(audio, 2)
      audio.finish()
      await waitForState(coordinator, 'completed')
    })
  }

  it('supports repeated pause and resume without consuming paused gap time', async () => {
    const { audio, coordinator, sleeps, advanceNow } = harness()
    const expectedGap = getTransitionGapMs('paragraph', 1)
    const started = await coordinator.start(request('First paragraph.\n\nSecond paragraph.', 'repeated-gap'))
    if (!started.ok) throw new Error('start failed')
    await waitForPlay(audio, 1)
    audio.finish()
    await waitForState(coordinator, 'waiting')
    await vi.waitFor(() => expect(sleeps).toHaveLength(1))

    advanceNow(100)
    await coordinator.control('pause', started.sessionId)
    await coordinator.control('resume', started.sessionId)
    await vi.waitFor(() => expect(sleeps).toHaveLength(2))
    expect(sleeps[1].milliseconds).toBe(expectedGap - 100)

    advanceNow(75)
    await coordinator.control('pause', started.sessionId)
    await coordinator.control('resume', started.sessionId)
    await vi.waitFor(() => expect(sleeps).toHaveLength(3))
    expect(sleeps[2].milliseconds).toBe(expectedGap - 175)

    sleeps[2].resolve()
    await waitForPlay(audio, 2)
  })

  it('cancels promptly during a transition gap without starting the next chunk', async () => {
    const { audio, coordinator } = harness()
    const started = await coordinator.start(request('First paragraph.\n\nSecond paragraph.', 'cancel-gap'))
    if (!started.ok) throw new Error('start failed')
    await waitForPlay(audio, 1)
    audio.finish()
    await waitForState(coordinator, 'waiting')

    await expect(coordinator.control('cancel', started.sessionId)).resolves.toMatchObject({
      ok: true,
      state: 'cancelled',
    })
    expect(audio.trace.filter((entry) => entry.startsWith('play:'))).toHaveLength(1)
    expect(coordinator.getPlayerDiagnostics().activePlayerCount).toBe(0)
  })

  it('replaces promptly during a transition gap and never restarts the old queue', async () => {
    const { audio, coordinator, events } = harness()
    const first = await coordinator.start(request('Old first paragraph.\n\nOld second paragraph.', 'replace-gap-old'))
    if (!first.ok) throw new Error('first start failed')
    await waitForPlay(audio, 1)
    audio.finish()
    await waitForState(coordinator, 'waiting')

    const second = await coordinator.start(request('New replacement.', 'replace-gap-new', 'options-test'))
    expect(second).toMatchObject({ ok: true })
    await waitForPlay(audio, 2)

    expect(events.some((event) => event.event === 'superseded' && event.status.sessionId === first.sessionId)).toBe(true)
    expect(events.some((event) => event.event === 'completed' && event.status.sessionId === first.sessionId)).toBe(false)
    expect(coordinator.getStatus()).toMatchObject({ requestId: 'replace-gap-new', state: 'playing' })
  })
})
