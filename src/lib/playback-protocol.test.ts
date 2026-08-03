import { describe, expect, it } from 'vitest'
import {
  PLAYBACK_CONTROL,
  PLAYBACK_STATUS,
  START_PLAYBACK,
  createPlaybackError,
  isPlaybackControlRequest,
  isPlaybackStatusRequest,
  isStartPlaybackRequest,
} from './playback-protocol'

describe('playback protocol guards', () => {
  it('accepts a valid start request', () => {
    expect(isStartPlaybackRequest({
      kind: START_PLAYBACK,
      requestId: 'request-1',
      source: 'selection',
      text: 'Hello.',
      settings: { ttsUrl: 'http://localhost:5002/api/tts', voice: 'p225', rate: 1 },
    })).toBe(true)
  })

  it('rejects malformed start requests', () => {
    expect(isStartPlaybackRequest(null)).toBe(false)
    expect(isStartPlaybackRequest({ kind: START_PLAYBACK, requestId: '', source: 'selection', text: 'Hi', settings: {} })).toBe(false)
    expect(isStartPlaybackRequest({
      kind: START_PLAYBACK,
      requestId: 'request-1',
      source: 'unknown',
      text: 'Hi',
      settings: { ttsUrl: 'http://localhost/tts', voice: '', rate: 1 },
    })).toBe(false)
  })

  it('accepts controls and optional expected session IDs', () => {
    expect(isPlaybackControlRequest({ kind: PLAYBACK_CONTROL, action: 'pause' })).toBe(true)
    expect(isPlaybackControlRequest({ kind: PLAYBACK_CONTROL, action: 'cancel', expectedSessionId: 'session-1' })).toBe(true)
    expect(isPlaybackControlRequest({ kind: PLAYBACK_CONTROL, action: 'skip' })).toBe(false)
    expect(isPlaybackControlRequest({ kind: PLAYBACK_CONTROL, action: 'resume', expectedSessionId: '' })).toBe(false)
  })

  it('recognizes status requests only', () => {
    expect(isPlaybackStatusRequest({ kind: PLAYBACK_STATUS })).toBe(true)
    expect(isPlaybackStatusRequest({ kind: 'SPEECH_STATUS' })).toBe(false)
  })

  it('creates stable structured errors', () => {
    expect(createPlaybackError('TTS_HTTP_ERROR', 'Unavailable', 503)).toEqual({
      code: 'TTS_HTTP_ERROR',
      message: 'Unavailable',
      status: 503,
    })
  })
})
