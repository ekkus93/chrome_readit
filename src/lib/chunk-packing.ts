import { segmentSentences } from './text-segmentation'

export const TARGET_CHUNK_CHARS = 280
export const SOFT_MAX_CHUNK_CHARS = 400
export const HARD_MAX_CHUNK_CHARS = 500

export type PlaybackTransition = 'continuation' | 'sentence' | 'paragraph' | 'end'

export type PlaybackChunk = {
  id: string
  text: string
  paragraphIndex: number
  chunkIndexInParagraph: number
  globalChunkIndex: number
  transitionAfter: PlaybackTransition
  forcedSplit: boolean
}

export type ChunkPackingOptions = {
  targetChars?: number
  softMaxChars?: number
  hardMaxChars?: number
}

type DraftChunk = {
  text: string
  paragraphIndex: number
  forcedSplit: boolean
  continuesSentenceAfter: boolean
}

function codePointLength(value: string): number {
  return Array.from(value).length
}

function preferredCutIndex(characters: string[], hardMaxChars: number): number {
  const window = characters.slice(0, hardMaxChars)
  const punctuation = new Set([';', ':', ',', '—', '–', '-'])

  for (let index = window.length - 1; index >= 0; index -= 1) {
    if (punctuation.has(window[index])) return index + 1
  }
  for (let index = window.length - 1; index >= 0; index -= 1) {
    if (/\s/.test(window[index])) return index
  }
  return hardMaxChars
}

function splitOversizedSentence(sentence: string, hardMaxChars: number): string[] {
  const output: string[] = []
  let remaining = sentence.trim()

  while (codePointLength(remaining) > hardMaxChars) {
    const characters = Array.from(remaining)
    const cutIndex = Math.max(1, preferredCutIndex(characters, hardMaxChars))
    const part = characters.slice(0, cutIndex).join('').trim()
    if (part) output.push(part)
    remaining = characters.slice(cutIndex).join('').trim()
  }

  if (remaining) output.push(remaining)
  return output
}

function paragraphsFromNormalizedText(text: string): string[] {
  return text.split(/\n\n+/).map((paragraph) => paragraph.trim()).filter(Boolean)
}

function shouldFlushBeforeSentence(
  currentText: string,
  candidateText: string,
  targetChars: number,
  softMaxChars: number,
): boolean {
  if (!currentText) return false
  const currentLength = codePointLength(currentText)
  const candidateLength = codePointLength(candidateText)
  if (candidateLength > softMaxChars) return true

  // Once the current chunk has useful substance, retain whichever boundary is
  // closer to the target instead of blindly filling every chunk to soft max.
  if (currentLength < Math.ceil(targetChars / 2)) return false
  return Math.abs(targetChars - currentLength) <= Math.abs(targetChars - candidateLength)
}

export function packPlaybackChunks(
  normalizedText: string,
  options: ChunkPackingOptions = {},
): PlaybackChunk[] {
  const targetChars = options.targetChars ?? TARGET_CHUNK_CHARS
  const softMaxChars = options.softMaxChars ?? SOFT_MAX_CHUNK_CHARS
  const hardMaxChars = options.hardMaxChars ?? HARD_MAX_CHUNK_CHARS
  if (targetChars <= 0 || softMaxChars < targetChars || hardMaxChars < softMaxChars) {
    throw new Error('Invalid chunk packing limits')
  }

  const drafts: DraftChunk[] = []
  const paragraphs = paragraphsFromNormalizedText(normalizedText)

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const sentences = segmentSentences(paragraph)
    let packed = ''

    const flushPacked = () => {
      if (!packed) return
      drafts.push({
        text: packed,
        paragraphIndex,
        forcedSplit: false,
        continuesSentenceAfter: false,
      })
      packed = ''
    }

    for (const sentence of sentences) {
      if (codePointLength(sentence) > hardMaxChars) {
        flushPacked()
        const pieces = splitOversizedSentence(sentence, hardMaxChars)
        pieces.forEach((piece, pieceIndex) => {
          drafts.push({
            text: piece,
            paragraphIndex,
            forcedSplit: true,
            continuesSentenceAfter: pieceIndex < pieces.length - 1,
          })
        })
        continue
      }

      const candidate = packed ? `${packed} ${sentence}` : sentence
      if (shouldFlushBeforeSentence(packed, candidate, targetChars, softMaxChars)) {
        flushPacked()
        packed = sentence
      } else {
        packed = candidate
      }
    }

    flushPacked()
  })

  const paragraphChunkIndexes = new Map<number, number>()
  return drafts.map((draft, globalChunkIndex) => {
    const chunkIndexInParagraph = paragraphChunkIndexes.get(draft.paragraphIndex) ?? 0
    paragraphChunkIndexes.set(draft.paragraphIndex, chunkIndexInParagraph + 1)
    const next = drafts[globalChunkIndex + 1]
    const transitionAfter: PlaybackTransition = !next
      ? 'end'
      : next.paragraphIndex !== draft.paragraphIndex
        ? 'paragraph'
        : draft.continuesSentenceAfter
          ? 'continuation'
          : 'sentence'

    return {
      id: `${draft.paragraphIndex}:${chunkIndexInParagraph}`,
      text: draft.text,
      paragraphIndex: draft.paragraphIndex,
      chunkIndexInParagraph,
      globalChunkIndex,
      transitionAfter,
      forcedSplit: draft.forcedSplit,
    }
  })
}
