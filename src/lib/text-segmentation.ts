const SENTENCE_CLOSERS = new Set(['"', "'", ')', ']', '}', '”', '’'])
const ALWAYS_CONTINUE_ABBREVIATIONS = new Set([
  'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'rev.', 'hon.', 'e.g.', 'i.e.',
])
const LOWERCASE_CONTINUE_ABBREVIATIONS = new Set([
  'u.s.', 'u.k.', 'u.n.', 'e.u.', 'a.i.', 'u.s.a.', 'd.c.',
  'p.m.', 'a.m.', 'etc.', 'ph.d.', 'm.d.', 'b.a.', 'm.a.',
])
const UPPERCASE_INITIALISM_CONTINUATIONS = new Set([
  'army', 'navy', 'air', 'marine', 'government', 'department', 'congress',
  'senate', 'house', 'embassy', 'president', 'supreme', 'court', 'security',
  'commission', 'parliament', 'constitution', 'treasury', 'military',
])
const TIME_CONTINUATIONS = new Set([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december', 'today', 'tomorrow',
  'tonight', 'yesterday', 'local', 'utc', 'est', 'edt', 'cst', 'cdt', 'mst',
  'mdt', 'pst', 'pdt',
])
const SUFFIX_ABBREVIATIONS = new Set(['jr.', 'sr.'])

function isLetter(value: string | undefined): boolean {
  return typeof value === 'string' && /^\p{L}$/u.test(value)
}

function isAsciiLetter(value: string | undefined): boolean {
  return typeof value === 'string' && /^[A-Za-z]$/.test(value)
}

function isLowercaseLetter(value: string | undefined): boolean {
  return typeof value === 'string' && /^\p{Ll}$/u.test(value)
}

function isUppercaseLetter(value: string | undefined): boolean {
  return typeof value === 'string' && /^\p{Lu}$/u.test(value)
}

function nextMeaningfulCharacter(text: string, start: number): string | undefined {
  for (let index = start; index < text.length; index += 1) {
    const value = text[index]
    if (/\s/.test(value) || SENTENCE_CLOSERS.has(value)) continue
    return value
  }
  return undefined
}

function nextMeaningfulWord(text: string, start: number): string | null {
  const remainder = text.slice(start).replace(/^[\s)\]}'"”’]+/, '')
  const match = remainder.match(/^([\p{L}]+)/u)
  return match?.[1]?.toLowerCase() ?? null
}

function trailingDottedToken(text: string): string | null {
  const match = text.trim().match(/([A-Za-z](?:[A-Za-z.]*[A-Za-z])?\.)[)\]}'"”’]*$/)
  return match?.[1]?.toLowerCase() ?? null
}

function shouldContinueAfterSt(candidate: string, nextCharacter: string | undefined): boolean {
  if (!isLetter(nextCharacter)) return false
  const withoutClosers = candidate.trim().replace(/[)\]}'"”’]+$/, '')
  const prefix = withoutClosers.slice(0, -3).trim()
  if (!prefix) return true
  if (/(?:^|\s)(?:to|in|at|from|near|toward|towards|visit|visited)$/i.test(prefix)) return true
  return isLowercaseLetter(nextCharacter)
    && /(?:^|\s)\d+[\p{L}\d.'’-]*(?:\s+[\p{L}\d.'’-]+)*$/u.test(prefix)
}

function shouldContinueUppercaseAbbreviation(
  token: string,
  text: string,
  nextStart: number,
): boolean {
  const word = nextMeaningfulWord(text, nextStart)
  if (!word) return false
  if ((token === 'a.m.' || token === 'p.m.') && TIME_CONTINUATIONS.has(word)) return true
  return UPPERCASE_INITIALISM_CONTINUATIONS.has(word)
}

function shouldProtectPeriod(text: string, sentenceStart: number, index: number): boolean {
  const previous = text[index - 1]
  const immediateNext = text[index + 1]

  if (/\d/.test(previous ?? '') && /\d/.test(immediateNext ?? '')) return true
  if (isLetter(previous) && isLetter(immediateNext)) return true

  const candidate = text.slice(sentenceStart, index + 1).trim()
  const token = trailingDottedToken(candidate)
  const nextCharacter = nextMeaningfulCharacter(text, index + 1)
  if (!token || !nextCharacter) return false

  if (ALWAYS_CONTINUE_ABBREVIATIONS.has(token) && isLetter(nextCharacter)) return true
  if (LOWERCASE_CONTINUE_ABBREVIATIONS.has(token) && isLowercaseLetter(nextCharacter)) return true
  if (LOWERCASE_CONTINUE_ABBREVIATIONS.has(token)
    && isUppercaseLetter(nextCharacter)
    && shouldContinueUppercaseAbbreviation(token, text, index + 1)) return true
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

function shouldMergeUrlQueryBoundary(previous: string, next: string, boundaryHadWhitespace: boolean): boolean {
  return !boundaryHadWhitespace
    && /\bhttps?:\/\/\S+\?$/i.test(previous.trim())
    && /^[A-Za-z0-9._~%+-]+=[^\s]/.test(next.trim())
}

function shouldMergeIntlBoundary(previous: string, next: string): boolean {
  const nextCharacter = nextMeaningfulCharacter(next, 0)
  const token = trailingDottedToken(previous)
  if (token && ALWAYS_CONTINUE_ABBREVIATIONS.has(token) && isLetter(nextCharacter)) return true
  if (token && LOWERCASE_CONTINUE_ABBREVIATIONS.has(token) && isLowercaseLetter(nextCharacter)) return true
  if (token && LOWERCASE_CONTINUE_ABBREVIATIONS.has(token)
    && isUppercaseLetter(nextCharacter)
    && shouldContinueUppercaseAbbreviation(token, next, 0)) return true
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
  return Array.from(new Segmenter(undefined, { granularity: 'sentence' }).segment(text), (entry) => entry.segment)
    .filter((entry) => entry.trim().length > 0)
}

export function segmentSentences(text: string): string[] {
  const candidates = getIntlCandidates(text).flatMap((rawCandidate) => {
    const parts = fallbackSegment(rawCandidate)
    return parts.map((segment, index) => ({
      segment,
      boundaryHadWhitespace: index === 0 && /^\s/.test(rawCandidate),
    }))
  })
  const output: string[] = []

  for (const candidate of candidates) {
    const previous = output.at(-1)
    if (previous && shouldMergeUrlQueryBoundary(previous, candidate.segment, candidate.boundaryHadWhitespace)) {
      output[output.length - 1] = `${previous}${candidate.segment}`
    } else if (previous && shouldMergeIntlBoundary(previous, candidate.segment)) {
      output[output.length - 1] = `${previous} ${candidate.segment}`
    } else {
      output.push(candidate.segment)
    }
  }

  return output
}
