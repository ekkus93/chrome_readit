const SENTENCE_CLOSERS = new Set(['"', "'", ')', ']', '}', '”', '’'])
const ALWAYS_CONTINUE_ABBREVIATIONS = new Set([
  'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'rev.', 'hon.', 'e.g.', 'i.e.',
])
const LOWERCASE_CONTINUE_ABBREVIATIONS = new Set([
  'u.s.', 'u.k.', 'u.n.', 'e.u.', 'a.i.', 'u.s.a.', 'd.c.',
  'p.m.', 'a.m.', 'etc.', 'ph.d.', 'm.d.', 'b.a.', 'm.a.',
])
const SUFFIX_ABBREVIATIONS = new Set(['jr.', 'sr.'])

function isAsciiLetter(value: string | undefined): boolean {
  return typeof value === 'string' && /^[A-Za-z]$/.test(value)
}

function isLowercaseLetter(value: string | undefined): boolean {
  return typeof value === 'string' && /^\p{Ll}$/u.test(value)
}

function nextMeaningfulCharacter(text: string, start: number): string | undefined {
  for (let index = start; index < text.length; index += 1) {
    const value = text[index]
    if (/\s/.test(value) || SENTENCE_CLOSERS.has(value)) continue
    return value
  }
  return undefined
}

function trailingDottedToken(text: string): string | null {
  const match = text.trim().match(/([A-Za-z](?:[A-Za-z.]*[A-Za-z])?\.)[)\]}'"”’]*$/)
  return match?.[1]?.toLowerCase() ?? null
}

function shouldContinueAfterSt(candidate: string, nextCharacter: string | undefined): boolean {
  if (!isAsciiLetter(nextCharacter)) return false
  const withoutClosers = candidate.trim().replace(/[)\]}'"”’]+$/, '')
  const prefix = withoutClosers.slice(0, -3).trim().toLowerCase()
  if (!prefix) return true
  return /(?:^|\s)(?:to|in|at|from|near|toward|towards|visit|visited)$/.test(prefix)
}

function shouldProtectPeriod(text: string, sentenceStart: number, index: number): boolean {
  const previous = text[index - 1]
  const immediateNext = text[index + 1]

  if (/\d/.test(previous ?? '') && /\d/.test(immediateNext ?? '')) return true
  if (isAsciiLetter(previous) && isAsciiLetter(immediateNext)) return true

  const candidate = text.slice(sentenceStart, index + 1).trim()
  const token = trailingDottedToken(candidate)
  const nextCharacter = nextMeaningfulCharacter(text, index + 1)
  if (!token || !nextCharacter) return false

  if (ALWAYS_CONTINUE_ABBREVIATIONS.has(token) && isAsciiLetter(nextCharacter)) return true
  if (LOWERCASE_CONTINUE_ABBREVIATIONS.has(token) && isLowercaseLetter(nextCharacter)) return true
  if (SUFFIX_ABBREVIATIONS.has(token) && isLowercaseLetter(nextCharacter)) return true
  if (token === 'st.' && shouldContinueAfterSt(candidate, nextCharacter)) return true
  return false
}

function isUrlQueryMarker(text: string, sentenceStart: number, index: number): boolean {
  const candidate = text.slice(sentenceStart, index)
  const token = candidate.slice(Math.max(candidate.lastIndexOf(' '), candidate.lastIndexOf('\n'), candidate.lastIndexOf('\t')) + 1)
  const next = text[index + 1]
  return /^https?:\/\/\S+$/i.test(token) && typeof next === 'string' && !/\s/.test(next)
}

function fallbackSegment(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  const output: string[] = []
  let sentenceStart = 0

  for (let index = 0; index < trimmed.length; index += 1) {
    const value = trimmed[index]
    if (value !== '.' && value !== '!' && value !== '?') continue
    if (value === '?' && isUrlQueryMarker(trimmed, sentenceStart, index)) continue

    if (value === '.') {
      let runEnd = index + 1
      while (trimmed[runEnd] === '.') runEnd += 1
      if (runEnd - index >= 3) {
        index = runEnd - 1
        const nextCharacter = nextMeaningfulCharacter(trimmed, runEnd)
        if (isLowercaseLetter(nextCharacter)) continue
      } else if (shouldProtectPeriod(trimmed, sentenceStart, index)) {
        continue
      }
    } else {
      while (trimmed[index + 1] === '!' || trimmed[index + 1] === '?') index += 1
    }

    let end = index + 1
    while (end < trimmed.length && SENTENCE_CLOSERS.has(trimmed[end])) end += 1

    const sentence = trimmed.slice(sentenceStart, end).trim()
    if (sentence) output.push(sentence)

    sentenceStart = end
    while (sentenceStart < trimmed.length && /\s/.test(trimmed[sentenceStart])) sentenceStart += 1
    index = end - 1
  }

  const tail = trimmed.slice(sentenceStart).trim()
  if (tail) output.push(tail)
  return output
}

function shouldMergeIntlBoundary(previous: string, next: string): boolean {
  const nextCharacter = nextMeaningfulCharacter(next, 0)
  const token = trailingDottedToken(previous)
  if (token && ALWAYS_CONTINUE_ABBREVIATIONS.has(token) && isAsciiLetter(nextCharacter)) return true
  if (token && LOWERCASE_CONTINUE_ABBREVIATIONS.has(token) && isLowercaseLetter(nextCharacter)) return true
  if (token && SUFFIX_ABBREVIATIONS.has(token) && isLowercaseLetter(nextCharacter)) return true
  if (token === 'st.' && shouldContinueAfterSt(previous, nextCharacter)) return true
  if (/\.\.\.[)\]}'"”’]*$/.test(previous.trim()) && isLowercaseLetter(nextCharacter)) return true
  return false
}

type SegmenterLike = {
  segment(input: string): Iterable<{ segment: string }>
}

type SegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity: 'sentence' },
) => SegmenterLike

function getIntlCandidates(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: SegmenterConstructor }).Segmenter
  if (!Segmenter) return [text]
  return Array.from(new Segmenter(undefined, { granularity: 'sentence' }).segment(text), (entry) => entry.segment.trim())
    .filter((entry) => entry.length > 0)
}

export function segmentSentences(text: string): string[] {
  const candidates = getIntlCandidates(text).flatMap((candidate) => fallbackSegment(candidate))
  const output: string[] = []

  for (const candidate of candidates) {
    const previous = output.at(-1)
    if (previous && shouldMergeIntlBoundary(previous, candidate)) {
      output[output.length - 1] = `${previous} ${candidate}`
    } else {
      output.push(candidate)
    }
  }

  return output
}
