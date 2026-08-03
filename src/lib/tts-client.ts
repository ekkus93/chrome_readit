import { createPlaybackError, type PlaybackError } from './playback-protocol'
import { isHostPlayTtsUrl } from './storage'

export const DEFAULT_MAX_TTS_RESPONSE_BYTES = 16 * 1024 * 1024
export const DEFAULT_TTS_TIMEOUT_MS = 120_000

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
  timeoutMs?: number
}

type LinkedAbort = {
  signal: AbortSignal
  timedOut: () => boolean
  cleanup: () => void
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

function linkAbortSignal(externalSignal: AbortSignal | undefined, timeoutMs: number): LinkedAbort {
  const controller = new AbortController()
  let timeoutTriggered = false
  const externalAbort = () => controller.abort(externalSignal?.reason)
  if (externalSignal?.aborted) externalAbort()
  else externalSignal?.addEventListener('abort', externalAbort, { once: true })

  const timeoutId = setTimeout(() => {
    timeoutTriggered = true
    controller.abort(new DOMException('TTS request timed out', 'TimeoutError'))
  }, Math.max(1, timeoutMs))

  return {
    signal: controller.signal,
    timedOut: () => timeoutTriggered,
    cleanup: () => {
      clearTimeout(timeoutId)
      externalSignal?.removeEventListener('abort', externalAbort)
    },
  }
}

function abortError(linked: LinkedAbort, externalSignal?: AbortSignal, cause?: unknown): TtsClientError {
  if (externalSignal?.aborted && !linked.timedOut()) {
    return new TtsClientError(createPlaybackError('CANCELLED', 'TTS synthesis was cancelled.'), cause)
  }
  if (linked.timedOut()) {
    return new TtsClientError(createPlaybackError('TTS_TIMEOUT', 'The TTS request timed out.'), cause)
  }
  return new TtsClientError(createPlaybackError('TTS_FETCH_FAILED', 'Unable to reach the TTS service.'), cause)
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel()
  } catch {
    // Reader cancellation is best-effort after a terminal validation error.
    // The caller still fails closed and never accepts the response body.
  }
}

function readChunkWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  linked: LinkedAbort,
  externalSignal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (linked.signal.aborted) return Promise.reject(abortError(linked, externalSignal))
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (operation: () => void) => {
      if (settled) return
      settled = true
      linked.signal.removeEventListener('abort', onAbort)
      operation()
    }
    const onAbort = () => finish(() => reject(abortError(linked, externalSignal)))
    linked.signal.addEventListener('abort', onAbort, { once: true })
    void reader.read().then(
      (result) => finish(() => resolve(result)),
      (error) => finish(() => reject(abortError(linked, externalSignal, error))),
    )
  })
}

async function readBoundedBody(
  response: Response,
  maxResponseBytes: number,
  linked: LinkedAbort,
  externalSignal?: AbortSignal,
): Promise<ArrayBuffer> {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new TtsClientError(createPlaybackError(
      'TTS_FETCH_FAILED',
      'The TTS response cannot be read as a bounded stream on this platform.',
    ))
  }

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>
      try {
        result = await readChunkWithAbort(reader, linked, externalSignal)
      } catch (error) {
        await cancelReader(reader)
        throw error
      }
      if (result.done) break
      if (!result.value || result.value.byteLength === 0) continue
      totalBytes += result.value.byteLength
      if (totalBytes > maxResponseBytes) {
        await cancelReader(reader)
        throw new TtsClientError(createPlaybackError(
          'TTS_RESPONSE_TOO_LARGE',
          `The TTS response exceeded the ${maxResponseBytes}-byte limit.`,
        ))
      }
      chunks.push(result.value)
    }
  } finally {
    reader.releaseLock()
  }

  if (totalBytes === 0) {
    throw new TtsClientError(createPlaybackError('TTS_EMPTY_RESPONSE', 'The TTS service returned an empty audio response.'))
  }

  const combined = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return combined.buffer
}

export async function fetchTtsAudio(options: FetchTtsAudioOptions): Promise<TtsAudio> {
  const url = validateTtsUrl(options.url)
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_TTS_RESPONSE_BYTES
  const timeoutMs = options.timeoutMs ?? DEFAULT_TTS_TIMEOUT_MS
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    throw new TypeError('maxResponseBytes must be a positive integer.')
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('timeoutMs must be a positive finite number.')
  }

  const linked = linkAbortSignal(options.signal, timeoutMs)
  try {
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: options.text, voice: options.voice }),
        signal: linked.signal,
      })
    } catch (error) {
      throw abortError(linked, options.signal, error)
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
      try {
        await response.body?.cancel()
      } catch {
        // Body cancellation is best-effort after a declared-size rejection.
      }
      throw new TtsClientError(createPlaybackError(
        'TTS_RESPONSE_TOO_LARGE',
        `The TTS response exceeded the ${maxResponseBytes}-byte limit.`,
      ))
    }

    const bytes = await readBoundedBody(response, maxResponseBytes, linked, options.signal)
    return { bytes, mime }
  } finally {
    linked.cleanup()
  }
}
