import { vi } from 'vitest'

export function resetBackgroundTestGlobals(): void {
  delete (globalThis as { __CHUNK_TIMEOUT_MS?: number }).__CHUNK_TIMEOUT_MS
  delete (globalThis as { __CHUNK_GAP_MS?: number }).__CHUNK_GAP_MS
  delete (globalThis as { __CHUNK_PARAGRAPH_GAP_MS?: number }).__CHUNK_PARAGRAPH_GAP_MS
  vi.unstubAllGlobals()
}

export function resetBackgroundPlaybackState(mod?: { __testing?: { resetPlaybackAckState?: () => void } }): void {
  mod?.__testing?.resetPlaybackAckState?.()
}
