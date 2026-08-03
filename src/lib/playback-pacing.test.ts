import { describe, expect, it } from 'vitest'
import { clampPlaybackRate, getTransitionGapMs } from './playback-pacing'

describe('playback pacing', () => {
  it.each([0.5, 1, 2, 4, 10])('preserves ordered minimum gaps at rate %s', (rate) => {
    const continuation = getTransitionGapMs('continuation', rate)
    const sentence = getTransitionGapMs('sentence', rate)
    const paragraph = getTransitionGapMs('paragraph', rate)
    expect(continuation).toBeGreaterThanOrEqual(35)
    expect(sentence).toBeGreaterThanOrEqual(120)
    expect(paragraph).toBeGreaterThanOrEqual(350)
    expect(sentence).toBeGreaterThan(continuation)
    expect(paragraph).toBeGreaterThan(sentence)
  })

  it('does not collapse high-rate transitions', () => {
    expect(getTransitionGapMs('continuation', 10)).toBe(35)
    expect(getTransitionGapMs('sentence', 10)).toBe(120)
    expect(getTransitionGapMs('paragraph', 10)).toBe(350)
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
