import { describe, expect, it } from 'vitest'
import { DEBUG_COLLISION_FIXTURE } from './debug-fixtures'
import { HARD_MAX_CHUNK_CHARS, packPlaybackChunks } from './chunk-packing'

describe('packPlaybackChunks', () => {
  it('packs adjacent short sentences into one request', () => {
    const chunks = packPlaybackChunks('One. Two. Three.')
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ text: 'One. Two. Three.', transitionAfter: 'end', forcedSplit: false })
  })

  it('prefers an existing boundary when it is closer to the target size', () => {
    const chunks = packPlaybackChunks(
      '1234567890123456789012345. 1234567890.',
      { targetChars: 25, softMaxChars: 60, hardMaxChars: 80 },
    )
    expect(chunks.map((chunk) => chunk.text)).toEqual([
      '1234567890123456789012345.',
      '1234567890.',
    ])
  })

  it('starts a new chunk when the next sentence exceeds the soft maximum', () => {
    const chunks = packPlaybackChunks(
      'First sentence fits. Second sentence is deliberately longer. Third.',
      { targetChars: 20, softMaxChars: 40, hardMaxChars: 60 },
    )
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => Array.from(chunk.text).length <= 60)).toBe(true)
  })

  it('never crosses paragraph boundaries', () => {
    const chunks = packPlaybackChunks('First. Second.\n\nThird. Fourth.')
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toMatchObject({ paragraphIndex: 0, transitionAfter: 'paragraph' })
    expect(chunks[1]).toMatchObject({ paragraphIndex: 1, transitionAfter: 'end' })
  })

  it('does not treat semicolons as sentence boundaries', () => {
    const chunks = packPlaybackChunks('One clause; another clause. Next.')
    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toBe('One clause; another clause. Next.')
  })

  it('splits an oversized sentence at clauses before hard cutting', () => {
    const chunks = packPlaybackChunks(
      'This opening clause is fairly long; this second clause is also long; this final clause ends.',
      { targetChars: 25, softMaxChars: 35, hardMaxChars: 40 },
    )
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.forcedSplit)).toBe(true)
    expect(chunks.slice(0, -1).every((chunk) => chunk.transitionAfter === 'continuation')).toBe(true)
    expect(chunks.every((chunk) => Array.from(chunk.text).length <= 40)).toBe(true)
  })

  it('hard cuts long unbroken tokens without exceeding the maximum', () => {
    const token = 'x'.repeat(55)
    const chunks = packPlaybackChunks(token, { targetChars: 10, softMaxChars: 15, hardMaxChars: 20 })
    expect(chunks.map((chunk) => chunk.text).join('')).toBe(token)
    expect(chunks.every((chunk) => chunk.text.length <= 20)).toBe(true)
  })

  it('preserves normalized semantic text exactly once', () => {
    const input = 'First sentence. Second sentence.\n\nA long final sentence, with another clause, and an ending.'
    const chunks = packPlaybackChunks(input, { targetChars: 20, softMaxChars: 35, hardMaxChars: 45 })
    expect(chunks.map((chunk) => chunk.text).join(' ').replace(/\s+/g, ' ')).toBe(
      input.replace(/\n\n/g, ' ').replace(/\s+/g, ' '),
    )
    expect(chunks.every((chunk) => chunk.text.length > 0)).toBe(true)
  })

  it('packs the full collision fixture with exact paragraph and size invariants', () => {
    const chunks = packPlaybackChunks(DEBUG_COLLISION_FIXTURE)
    const paragraphIndexes = [...new Set(chunks.map((chunk) => chunk.paragraphIndex))]
    const reconstructed = chunks.map((chunk) => chunk.text).join(' ').replace(/\s+/g, ' ').trim()
    const expected = DEBUG_COLLISION_FIXTURE.replace(/\s+/g, ' ').trim()

    expect(paragraphIndexes).toEqual([0, 1, 2])
    expect(reconstructed).toBe(expected)
    expect(chunks.every((chunk) => Array.from(chunk.text).length <= HARD_MAX_CHUNK_CHARS)).toBe(true)
    expect(chunks.filter((chunk) => chunk.transitionAfter === 'paragraph')).toHaveLength(2)
    expect(chunks.at(-1)?.transitionAfter).toBe('end')
    expect(chunks.some((chunk) => chunk.forcedSplit && chunk.transitionAfter === 'continuation')).toBe(true)
    expect(chunks.some((chunk) => chunk.text.includes('semicolon joins this clause; it must not force another synthesis request.'))).toBe(true)
  })
})
