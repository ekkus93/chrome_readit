import { describe, expect, it } from 'vitest'
import {
  PLAYBACK_CONTROL,
  PLAYBACK_EVENT,
  PLAYBACK_STATUS,
  START_PLAYBACK,
  createPlaybackError,
  isPlaybackControlRequest,
  isPlaybackControlResponse,
  isPlaybackEvent,
  isPlaybackStatus,
  isPlaybackStatusRequest,
  isStartPlaybackRequest,
  isStartPlaybackResponse,
} from './playback-protocol'

const playingStatus = {
  kind: PLAYBACK_STATUS,
  state: 'playing',
  sessionId: 'session-1',
  requestId: 'request-1',
  source: 'selection',
  currentChunk: 1,
  totalChunks: 2,
  currentParagraph: 1,
  totalParagraphs: 1,
} as const

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

  it('validates accepted and rejected start responses', () => {
    expect(isStartPlaybackResponse({
      ok: true,
      accepted: true,
      requestId: 'request-1',
      sessionId: 'session-1',
    })).toBe(true)
    expect(isStartPlaybackResponse({
      ok: false,
      accepted: false,
      requestId: 'request-1',
      error: { code: 'NO_TEXT', message: 'No text.' },
    })).toBe(true)
    expect(isStartPlaybackResponse({ ok: true, accepted: true, requestId: 'request-1' })).toBe(false)
  })

  it('accepts controls and optional expected session IDs', () => {
    expect(isPlaybackControlRequest({ kind: PLAYBACK_CONTROL, action: 'pause' })).toBe(true)
    expect(isPlaybackControlRequest({ kind: PLAYBACK_CONTROL, action: 'cancel', expectedSessionId: 'session-1' })).toBe(true)
    expect(isPlaybackControlRequest({ kind: PLAYBACK_CONTROL, action: 'skip' })).toBe(false)
    expect(isPlaybackControlRequest({ kind: PLAYBACK_CONTROL, action: 'resume', expectedSessionId: '' })).toBe(false)
  })

  it('validates control responses', () => {
    expect(isPlaybackControlResponse({ ok: true, sessionId: 'session-1', state: 'paused' })).toBe(true)
    expect(isPlaybackControlResponse({
      ok: false,
      error: { code: 'SESSION_NOT_FOUND', message: 'Missing.' },
    })).toBe(true)
    expect(isPlaybackControlResponse({ ok: true, sessionId: 1, state: 'paused' })).toBe(false)
  })

  it('recognizes and validates status messages', () => {
    expect(isPlaybackStatusRequest({ kind: PLAYBACK_STATUS })).toBe(true)
    expect(isPlaybackStatusRequest({ kind: 'SPEECH_STATUS' })).toBe(false)
    expect(isPlaybackStatus(playingStatus)).toBe(true)
    expect(isPlaybackStatus({ ...playingStatus, currentChunk: -1 })).toBe(false)
    expect(isPlaybackStatus({ ...playingStatus, source: 'unknown' })).toBe(false)
  })

  it('validates playback events', () => {
    expect(isPlaybackEvent({
      kind: PLAYBACK_EVENT,
      event: 'chunk-started',
      atMs: 123,
      status: playingStatus,
      chunkId: 'session-1:0',
      transition: 'sentence',
    })).toBe(true)
    expect(isPlaybackEvent({
      kind: PLAYBACK_EVENT,
      event: 'unknown',
      atMs: 123,
      status: playingStatus,
    })).toBe(false)
  })

  it('creates stable structured errors', () => {
    expect(createPlaybackError('TTS_HTTP_ERROR', 'Unavailable', 503)).toEqual({
      code: 'TTS_HTTP_ERROR',
      message: 'Unavailable',
      status: 503,
    })
  })
})
