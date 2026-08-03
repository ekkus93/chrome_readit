import { describe, expect, it } from 'vitest'
import { segmentSentences } from './text-segmentation'

describe('segmentSentences', () => {
  it.each([
    ['The value is 3.14. Continue.', ['The value is 3.14.', 'Continue.']],
    ['Version 1.2.3 is current. Upgrade later.', ['Version 1.2.3 is current.', 'Upgrade later.']],
    ['Visit example.com. Then return.', ['Visit example.com.', 'Then return.']],
    ['Visit https://example.com/path?q=1. Then return.', ['Visit https://example.com/path?q=1.', 'Then return.']],
    ['Email person@example.com. Then return.', ['Email person@example.com.', 'Then return.']],
    ['Dr. Smith spoke to Mr. Jones.', ['Dr. Smith spoke to Mr. Jones.']],
    ['The U.S. policy changed.', ['The U.S. policy changed.']],
    ['We visited the U.S. It was memorable.', ['We visited the U.S.', 'It was memorable.']],
    ['Meet at 5 p.m. today.', ['Meet at 5 p.m. today.']],
    ['I live on Main St. It is quiet.', ['I live on Main St.', 'It is quiet.']],
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
})
