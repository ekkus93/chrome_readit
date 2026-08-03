import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchTtsAudio, TtsClientError } from './tts-client'

function streamedResponse(options: {
  status?: number
  mime?: string | null
  chunks?: Uint8Array[]
  contentLength?: string | null
  neverComplete?: boolean
} = {}) {
  const cancel = vi.fn()
  const chunks = options.chunks ?? [new Uint8Array([1, 2, 3])]
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (options.neverComplete) return
      chunks.forEach((chunk) => controller.enqueue(chunk))
      controller.close()
    },
    cancel,
  })
  const headers = new Headers()
  if (options.mime !== null) headers.set('content-type', options.mime ?? 'audio/wav')
  if (options.contentLength !== undefined && options.contentLength !== null) {
    headers.set('content-length', options.contentLength)
  }
  return {
    cancel,
    response: new Response(stream, { status: options.status ?? 200, headers }),
  }
}

async function expectCode(promise: Promise<unknown>, code: string) {
  let caught: unknown
  try {
    await promise
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(TtsClientError)
  expect((caught as TtsClientError).detail.code).toBe(code)
}

describe('fetchTtsAudio', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('returns validated audio bytes from a bounded chunked stream', async () => {
    const { response } = streamedResponse({
      mime: 'audio/wav; charset=binary',
      chunks: [new Uint8Array([1, 2]), new Uint8Array([3])],
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    const result = await fetchTtsAudio({
      url: 'http://localhost:5002/api/tts',
      text: 'Hello',
      voice: 'p225',
    })

    expect(result.mime).toBe('audio/wav')
    expect([...new Uint8Array(result.bytes)]).toEqual([1, 2, 3])
  })

  it('rejects the host-play endpoint before making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expectCode(fetchTtsAudio({
      url: 'http://localhost:5002/api/tts/play',
      text: 'Hello',
      voice: 'p225',
    }), 'HOST_PLAY_ENDPOINT_FORBIDDEN')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects HTTP failures before reading the body', async () => {
    const { response } = streamedResponse({ status: 503 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    await expectCode(fetchTtsAudio({ url: 'http://localhost/tts', text: 'Hello', voice: '' }), 'TTS_HTTP_ERROR')
  })

  it('rejects non-audio and empty responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(streamedResponse({ mime: 'application/json' }).response))
    await expectCode(fetchTtsAudio({ url: 'http://localhost/tts', text: 'Hello', voice: '' }), 'TTS_NON_AUDIO_RESPONSE')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(streamedResponse({ chunks: [] }).response))
    await expectCode(fetchTtsAudio({ url: 'http://localhost/tts', text: 'Hello', voice: '' }), 'TTS_EMPTY_RESPONSE')
  })

  it('rejects declared oversize immediately and cancels the body', async () => {
    const { response, cancel } = streamedResponse({ contentLength: '11' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    await expectCode(fetchTtsAudio({
      url: 'http://localhost/tts',
      text: 'Hello',
      voice: '',
      maxResponseBytes: 10,
    }), 'TTS_RESPONSE_TOO_LARGE')
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('rejects a chunked stream over the cap without Content-Length', async () => {
    const { response, cancel } = streamedResponse({
      chunks: [new Uint8Array(6), new Uint8Array(5)],
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    await expectCode(fetchTtsAudio({
      url: 'http://localhost/tts',
      text: 'Hello',
      voice: '',
      maxResponseBytes: 10,
    }), 'TTS_RESPONSE_TOO_LARGE')
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('rejects a false low Content-Length when streamed bytes exceed the cap', async () => {
    const { response } = streamedResponse({
      contentLength: '1',
      chunks: [new Uint8Array(11)],
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    await expectCode(fetchTtsAudio({
      url: 'http://localhost/tts',
      text: 'Hello',
      voice: '',
      maxResponseBytes: 10,
    }), 'TTS_RESPONSE_TOO_LARGE')
  })

  it('fails closed when bounded readable streams are unavailable', async () => {
    const response = {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'audio/wav' }),
      body: null,
    } as Response
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    await expectCode(fetchTtsAudio({
      url: 'http://localhost/tts',
      text: 'Hello',
      voice: '',
    }), 'TTS_FETCH_FAILED')
  })

  it('times out a slow body read and cancels the reader', async () => {
    const { response, cancel } = streamedResponse({ neverComplete: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    await expectCode(fetchTtsAudio({
      url: 'http://localhost/tts',
      text: 'Hello',
      voice: '',
      timeoutMs: 5,
    }), 'TTS_TIMEOUT')
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('distinguishes session cancellation from timeout during body read', async () => {
    const { response, cancel } = streamedResponse({ neverComplete: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    const controller = new AbortController()

    const pending = fetchTtsAudio({
      url: 'http://localhost/tts',
      text: 'Hello',
      voice: '',
      signal: controller.signal,
      timeoutMs: 1_000,
    })
    controller.abort()

    await expectCode(pending, 'CANCELLED')
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('cleans the timeout timer after successful completion', async () => {
    vi.useFakeTimers()
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamedResponse().response))

    await fetchTtsAudio({
      url: 'http://localhost/tts',
      text: 'Hello',
      voice: '',
      timeoutMs: 10_000,
    })

    expect(clearTimeoutSpy).toHaveBeenCalled()
  })
})
