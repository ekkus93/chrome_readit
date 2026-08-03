import { describe, expect, it } from 'vitest'
import { normalizeSelectedText } from './text-normalization'

describe('normalizeSelectedText', () => {
  it('normalizes line endings, non-breaking spaces, and wrapped lines', () => {
    expect(normalizeSelectedText(' First\r\nwrapped\u00a0line.\r\n\r\n Second. ')).toEqual({
      ok: true,
      value: {
        text: 'First wrapped line.\n\nSecond.',
        codePointCount: 28,
        paragraphCount: 2,
      },
    })
  })

  it('rejects empty normalized input', () => {
    const result = normalizeSelectedText(' \n\n\t ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NO_TEXT')
  })

  it('counts astral Unicode as code points', () => {
    const result = normalizeSelectedText('A😀B', 3)
    expect(result).toMatchObject({ ok: true, value: { codePointCount: 3 } })
  })

  it('rejects text over the configured limit', () => {
    const result = normalizeSelectedText('A😀B', 2)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('TEXT_TOO_LONG')
  })
})
