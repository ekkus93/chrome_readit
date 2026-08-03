import { describe, expect, it } from 'vitest'
import { DEBUG_COLLISION_FIXTURE } from './debug-fixtures'
import { segmentSentences } from './text-segmentation'

describe('segmentSentences', () => {
  it.each([
    ['The value is 3.14. Continue.', ['The value is 3.14.', 'Continue.']],
    ['Version 1.2.3 is current. Upgrade later.', ['Version 1.2.3 is current.', 'Upgrade later.']],
    ['Visit example.com. Then return.', ['Visit example.com.', 'Then return.']],
    ['Visit https://example.com/path?q=1. Then return.', ['Visit https://example.com/path?q=1.', 'Then return.']],
    ['Visit https://example.com/path?x=1&y=2. Then return.', ['Visit https://example.com/path?x=1&y=2.', 'Then return.']],
    ['Did you visit https://example.com/path? Key=value is prose.', ['Did you visit https://example.com/path?', 'Key=value is prose.']],
    ['Email person@example.com. Then return.', ['Email person@example.com.', 'Then return.']],
    ['Dr. Smith spoke to Mr. Jones.', ['Dr. Smith spoke to Mr. Jones.']],
    ['Dr. Élodie spoke to Prof. Müller.', ['Dr. Élodie spoke to Prof. Müller.']],
    ['The U.S. policy changed.', ['The U.S. policy changed.']],
    ['The U.S. Army responded. Then it left.', ['The U.S. Army responded.', 'Then it left.']],
    ['The U.K. Government announced changes.', ['The U.K. Government announced changes.']],
    ['The U.N. Security Council met.', ['The U.N. Security Council met.']],
    ['We visited the U.S. It was memorable.', ['We visited the U.S.', 'It was memorable.']],
    ['Meet at 5 p.m. today.', ['Meet at 5 p.m. today.']],
    ['Meet at 5 p.m. Monday. Bring notes.', ['Meet at 5 p.m. Monday.', 'Bring notes.']],
    ['It ended at 5 p.m. Then we left.', ['It ended at 5 p.m.', 'Then we left.']],
    ['I live on Main St. It is quiet.', ['I live on Main St.', 'It is quiet.']],
    ['Turn near Main St. and continue.', ['Turn near Main St. and continue.']],
    ['Meet at 123 Main St. near the park.', ['Meet at 123 Main St. near the park.']],
    ['St. Louis is large.', ['St. Louis is large.']],
    ['John Smith Jr. arrived.', ['John Smith Jr. arrived.']],
    ['He is John Smith Jr. He arrived.', ['He is John Smith Jr.', 'He arrived.']],
    ['“This ends here.” (This starts next.)', ['“This ends here.”', '(This starts next.)']],
    ['Wait... what happened?', ['Wait... what happened?']],
    ['He stopped... Then he left.', ['He stopped...', 'Then he left.']],
    ['One clause; another clause. Next.', ['One clause; another clause.', 'Next.']],
  ])('segments %s', (input, expected) => {
    expect(segmentSentences(input)).toEqual(expected)
  })

  it('never emits empty segments', () => {
    expect(segmentSentences('  Hello!   What?  ')).toEqual(['Hello!', 'What?'])
  })

  it('segments the deterministic collision fixture without dropping or duplicating semantic text', () => {
    const output = segmentSentences(DEBUG_COLLISION_FIXTURE)
    const reconstructed = output.join(' ').replace(/\s+/g, ' ').trim()
    const expected = DEBUG_COLLISION_FIXTURE.replace(/\s+/g, ' ').trim()

    expect(reconstructed).toBe(expected)
    expect(output.every((sentence) => sentence.length > 0)).toBe(true)
    expect(output).toContain('Short one.')
    expect(output).toContain('Short two.')
    expect(output.some((sentence) => sentence.includes('semicolon joins this clause; it must not force another synthesis request.'))).toBe(true)
    expect(output.some((sentence) => sentence.includes('The value is 3.14 and version 1.2.3 is current.'))).toBe(true)
    expect(output.some((sentence) => sentence.includes('Visit example.com or https://example.com/readit and email reader@example.com.'))).toBe(true)
  })
})
