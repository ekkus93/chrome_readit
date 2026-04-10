import { describe, it, expect } from 'vitest'
import { isReadSelection, isReadText, isMsg } from './messaging'

describe('messaging type guards', () => {
  it('identifies READ_SELECTION messages', () => {
    const m = { kind: 'READ_SELECTION' }
    expect(isReadSelection(m)).toBe(true)
    expect(isMsg(m)).toBe(true)
  })

  it('identifies READ_TEXT messages with string text', () => {
    const m = { kind: 'READ_TEXT', text: 'hello' }
    expect(isReadText(m)).toBe(true)
    expect(isMsg(m)).toBe(true)
  })

  it('rejects READ_TEXT with non-string text', () => {
    const m = { kind: 'READ_TEXT', text: 123 }
    expect(isReadText(m)).toBe(false)
    expect(isMsg(m)).toBe(false)
  })

  it('rejects unrelated objects', () => {
    const m = { foo: 'bar' }
    expect(isMsg(m)).toBe(false)
  })

  it('rejects null/primitive values', () => {
    expect(isMsg(null)).toBe(false)
    expect(isMsg(123)).toBe(false)
    expect(isMsg('string')).toBe(false)
  })
})
