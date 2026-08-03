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
  sequence: 7,
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
    expect(isPlaybackStatus({ ...playingStatus, sequence: -1 })).toBe(false)
    expect(isPlaybackStatus({ ...playingStatus, currentChunk: -1 })).toBe(false)
    expect(isPlaybackStatus({ ...playingStatus, currentChunk: 3 })).toBe(false)
    expect(isPlaybackStatus({ ...playingStatus, currentParagraph: 2 })).toBe(false)
    expect(isPlaybackStatus({ ...playingStatus, source: 'unknown' })).toBe(false)
    expect(isPlaybackStatus({ ...playingStatus, sessionId: null })).toBe(false)
    expect(isPlaybackStatus({ ...playingStatus, error: { code: 'TTS_FETCH_FAILED', message: 'bad' } })).toBe(false)
    expect(isPlaybackStatus({ ...playingStatus, state: 'failed' })).toBe(false)
    expect(isPlaybackStatus({
      ...playingStatus,
      state: 'failed',
      error: { code: 'TTS_FETCH_FAILED', message: 'bad' },
    })).toBe(true)
  })

  it('validates chunk event optional fields and state consistency', () => {
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
      event: 'chunk-started',
      atMs: 123,
      status: playingStatus,
    })).toBe(false)
    expect(isPlaybackEvent({
      kind: PLAYBACK_EVENT,
      event: 'chunk-ended',
      atMs: 123,
      status: playingStatus,
      chunkId: 1,
      transition: 'sentence',
    })).toBe(false)
    expect(isPlaybackEvent({
      kind: PLAYBACK_EVENT,
      event: 'chunk-ended',
      atMs: 123,
      status: playingStatus,
      chunkId: 'session-1:0',
      transition: 'unknown',
    })).toBe(false)
    expect(isPlaybackEvent({
      kind: PLAYBACK_EVENT,
      event: 'completed',
      atMs: 123,
      status: playingStatus,
    })).toBe(false)
    expect(isPlaybackEvent({
      kind: PLAYBACK_EVENT,
      event: 'accepted',
      atMs: 123,
      status: playingStatus,
      chunkId: 'not-allowed',
    })).toBe(false)
  })

  it('validates superseded and terminal events', () => {
    const superseded = {
      ...playingStatus,
      state: 'cancelled',
      error: { code: 'SESSION_SUPERSEDED', message: 'superseded' },
    } as const
    expect(isPlaybackEvent({
      kind: PLAYBACK_EVENT,
      event: 'superseded',
      atMs: 124,
      status: superseded,
    })).toBe(true)
    expect(isPlaybackEvent({
      kind: PLAYBACK_EVENT,
      event: 'cancelled',
      atMs: 124,
      status: superseded,
    })).toBe(true)
    expect(isPlaybackEvent({
      kind: PLAYBACK_EVENT,
      event: 'superseded',
      atMs: 124,
      status: { ...superseded, error: { code: 'CANCELLED', message: 'cancelled' } },
    })).toBe(false)
  })

  it('requires cleanup stage only for cleanup errors', () => {
    expect(createPlaybackError('AUDIO_CLEANUP_FAILED', 'Unable to clear source.', undefined, 'clear-source')).toEqual({
      code: 'AUDIO_CLEANUP_FAILED',
      message: 'Unable to clear source.',
      stage: 'clear-source',
    })
    expect(isPlaybackStatus({
      ...playingStatus,
      state: 'failed',
      error: { code: 'AUDIO_CLEANUP_FAILED', message: 'failed' },
    })).toBe(false)
    expect(isPlaybackStatus({
      ...playingStatus,
      state: 'failed',
      error: { code: 'TTS_FETCH_FAILED', message: 'failed', stage: 'pause' },
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
