import { createPlaybackError, type PlaybackError } from './playback-protocol'

export const DEFAULT_MAX_SELECTED_TEXT_CODEPOINTS = 50_000

export type NormalizedText = {
  text: string
  codePointCount: number
  paragraphCount: number
}

export type NormalizeTextResult =
  | { ok: true; value: NormalizedText }
  | { ok: false; error: PlaybackError }

function countCodePoints(value: string): number {
  return Array.from(value).length
}

export function normalizeSelectedText(
  input: string,
  maxCodePoints = DEFAULT_MAX_SELECTED_TEXT_CODEPOINTS,
): NormalizeTextResult {
  const normalizedLineEndings = input.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ')
  const paragraphs = normalizedLineEndings
    .split(/\n[\t ]*\n+/)
    .map((paragraph) => paragraph
      .replace(/\n+/g, ' ')
      .replace(/[\t \f\v]+/g, ' ')
      .trim())
    .filter((paragraph) => paragraph.length > 0)

  const text = paragraphs.join('\n\n')
  if (!text) {
    return { ok: false, error: createPlaybackError('NO_TEXT', 'No text was provided for playback.') }
  }

  const codePointCount = countCodePoints(text)
  if (codePointCount > maxCodePoints) {
    return {
      ok: false,
      error: createPlaybackError(
        'TEXT_TOO_LONG',
        `The selected text contains ${codePointCount} characters; the limit is ${maxCodePoints}.`,
      ),
    }
  }

  return {
    ok: true,
    value: {
      text,
      codePointCount,
      paragraphCount: paragraphs.length,
    },
  }
}
