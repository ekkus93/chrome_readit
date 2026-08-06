import { describe, expect, it } from 'vitest'
import { clampPlaybackRate, getTransitionGapMs } from './playback-pacing'

describe('playback pacing', () => {
  it.each([
    { rate: 0.5, continuation: 120, sentence: 360, paragraph: 550 },
    { rate: 1, continuation: 60, sentence: 180, paragraph: 275 },
    { rate: 2, continuation: 30, sentence: 90, paragraph: 138 },
    { rate: 4, continuation: 20, sentence: 60, paragraph: 90 },
    { rate: 10, continuation: 20, sentence: 60, paragraph: 90 },
  ])('scales transition gaps directly at rate $rate', ({ rate, continuation, sentence, paragraph }) => {
    expect(getTransitionGapMs('continuation', rate)).toBe(continuation)
    expect(getTransitionGapMs('sentence', rate)).toBe(sentence)
    expect(getTransitionGapMs('paragraph', rate)).toBe(paragraph)
  })

  it.each([0.5, 1, 2, 4, 10])('preserves ordered minimum gaps at rate %s', (rate) => {
    const continuation = getTransitionGapMs('continuation', rate)
    const sentence = getTransitionGapMs('sentence', rate)
    const paragraph = getTransitionGapMs('paragraph', rate)
    expect(continuation).toBeGreaterThanOrEqual(20)
    expect(sentence).toBeGreaterThanOrEqual(60)
    expect(paragraph).toBeGreaterThanOrEqual(90)
    expect(sentence).toBeGreaterThan(continuation)
    expect(paragraph).toBeGreaterThan(sentence)
  })

  it('does not collapse high-rate transitions', () => {
    expect(getTransitionGapMs('continuation', 10)).toBe(20)
    expect(getTransitionGapMs('sentence', 10)).toBe(60)
    expect(getTransitionGapMs('paragraph', 10)).toBe(90)
  })

  it('returns zero after the final chunk', () => {
    expect(getTransitionGapMs('end', 1)).toBe(0)
  })

  it('clamps invalid and unsupported rates', () => {
    expect(clampPlaybackRate(0)).toBe(0.5)
    expect(clampPlaybackRate(99)).toBe(10)
    expect(clampPlaybackRate('2')).toBe(2)
    expect(clampPlaybackRate('invalid', 1.5)).toBe(1.5)
  })
})
