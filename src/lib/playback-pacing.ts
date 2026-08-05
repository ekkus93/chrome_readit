import type { PlaybackTransition } from './chunk-packing'

export const MIN_PLAYBACK_RATE = 0.5
export const MAX_PLAYBACK_RATE = 10

const BASE_GAPS_MS: Record<Exclude<PlaybackTransition, 'end'>, number> = {
  continuation: 60,
  sentence: 180,
  paragraph: 550,
}

const MIN_GAPS_MS: Record<Exclude<PlaybackTransition, 'end'>, number> = {
  continuation: 35,
  sentence: 120,
  paragraph: 350,
}

export function clampPlaybackRate(value: unknown, fallback = 1): number {
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, numberValue))
}

export function getTransitionGapMs(transition: PlaybackTransition, playbackRate: number): number {
  if (transition === 'end') return 0
  const rate = clampPlaybackRate(playbackRate)
  const scaled = Math.round(BASE_GAPS_MS[transition] / rate)
  return Math.max(MIN_GAPS_MS[transition], scaled)
}
