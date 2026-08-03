import { describe, expect, it } from 'vitest'
import {
  isLegacyPlaybackControlRequest,
  isMsg,
  isReadSelection,
  isReadText,
} from './messaging'

describe('messaging type guards', () => {
  it('identifies READ_SELECTION messages', () => {
    const message = { kind: 'READ_SELECTION' }
    expect(isReadSelection(message)).toBe(true)
    expect(isMsg(message)).toBe(true)
  })

  it('identifies READ_TEXT messages with an optional valid source', () => {
    expect(isReadText({ kind: 'READ_TEXT', text: 'hello' })).toBe(true)
    expect(isReadText({ kind: 'READ_TEXT', text: 'hello', source: 'popup-test' })).toBe(true)
    expect(isMsg({ kind: 'READ_TEXT', text: 'hello', source: 'options-test' })).toBe(true)
  })

  it('rejects READ_TEXT with invalid text or source', () => {
    expect(isReadText({ kind: 'READ_TEXT', text: 123 })).toBe(false)
    expect(isReadText({ kind: 'READ_TEXT', text: 'hello', source: 'unknown' })).toBe(false)
    expect(isMsg({ kind: 'READ_TEXT', text: 123 })).toBe(false)
  })

  it.each(['SPEECH_STATUS', 'PAUSE_SPEECH', 'RESUME_SPEECH', 'CANCEL_SPEECH']) (
    'recognizes the legacy UI control %s',
    (kind) => {
      expect(isLegacyPlaybackControlRequest({ kind })).toBe(true)
    },
  )

  it('rejects unrelated objects and primitives', () => {
    expect(isMsg({ foo: 'bar' })).toBe(false)
    expect(isLegacyPlaybackControlRequest({ kind: 'SKIP_SPEECH' })).toBe(false)
    expect(isMsg(null)).toBe(false)
    expect(isMsg(123)).toBe(false)
    expect(isMsg('string')).toBe(false)
  })
})
