import { createPlaybackError, type PlaybackError } from './playback-protocol'
import { isHostPlayTtsUrl } from './storage'

export const DEFAULT_MAX_TTS_RESPONSE_BYTES = 16 * 1024 * 1024

export class TtsClientError extends Error {
  readonly detail: PlaybackError

  constructor(detail: PlaybackError, cause?: unknown) {
    super(detail.message, cause === undefined ? undefined : { cause })
    this.name = 'TtsClientError'
    this.detail = detail
  }
}

export type TtsAudio = {
  bytes: ArrayBuffer
  mime: string
}

export type FetchTtsAudioOptions = {
  url: string
  text: string
  voice: string
  signal?: AbortSignal
  maxResponseBytes?: number
}

function validateTtsUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch (error) {
    throw new TtsClientError(createPlaybackError('INVALID_TTS_URL', 'The configured TTS URL is invalid.'), error)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TtsClientError(createPlaybackError('INVALID_TTS_URL', 'The TTS URL must use HTTP or HTTPS.'))
  }
  if (isHostPlayTtsUrl(url.toString())) {
    throw new TtsClientError(createPlaybackError(
      'HOST_PLAY_ENDPOINT_FORBIDDEN',
      'The host-play TTS endpoint is not permitted for extension playback.',
    ))
  }
  return url
}

function parseContentLength(value: string | null): number | null {
  if (value === null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export async function fetchTtsAudio(options: FetchTtsAudioOptions): Promise<TtsAudio> {
  const url = validateTtsUrl(options.url)
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_TTS_RESPONSE_BYTES

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: options.text, voice: options.voice }),
      signal: options.signal,
    })
  } catch (error) {
    if (options.signal?.aborted) {
      throw new TtsClientError(createPlaybackError('CANCELLED', 'TTS synthesis was cancelled.'), error)
    }
    throw new TtsClientError(createPlaybackError('TTS_FETCH_FAILED', 'Unable to reach the TTS service.'), error)
  }

  if (!response.ok) {
    throw new TtsClientError(createPlaybackError(
      'TTS_HTTP_ERROR',
      `The TTS service returned HTTP ${response.status}.`,
      response.status,
    ))
  }

  const mime = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (!mime.startsWith('audio/')) {
    throw new TtsClientError(createPlaybackError(
      'TTS_NON_AUDIO_RESPONSE',
      `The TTS service returned a non-audio response${mime ? ` (${mime})` : ''}.`,
    ))
  }

  const declaredLength = parseContentLength(response.headers.get('content-length'))
  if (declaredLength !== null && declaredLength > maxResponseBytes) {
    throw new TtsClientError(createPlaybackError(
      'TTS_RESPONSE_TOO_LARGE',
      `The TTS response exceeded the ${maxResponseBytes}-byte limit.`,
    ))
  }

  const bytes = await response.arrayBuffer()
  if (bytes.byteLength === 0) {
    throw new TtsClientError(createPlaybackError('TTS_EMPTY_RESPONSE', 'The TTS service returned an empty audio response.'))
  }
  if (bytes.byteLength > maxResponseBytes) {
    throw new TtsClientError(createPlaybackError(
      'TTS_RESPONSE_TOO_LARGE',
      `The TTS response exceeded the ${maxResponseBytes}-byte limit.`,
    ))
  }

  return { bytes, mime }
}
