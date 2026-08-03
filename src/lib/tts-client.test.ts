import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchTtsAudio, TtsClientError } from './tts-client'

function fakeResponse(options: {
  status?: number
  mime?: string | null
  bytes?: Uint8Array
  contentLength?: string | null
} = {}): Response {
  const status = options.status ?? 200
  const bytes = options.bytes ?? new Uint8Array([1, 2, 3])
  const headers = new Map<string, string>()
  if (options.mime !== null) headers.set('content-type', options.mime ?? 'audio/wav')
  if (options.contentLength !== undefined && options.contentLength !== null) headers.set('content-length', options.contentLength)

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as Response
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
  })

  it('returns validated audio bytes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ mime: 'audio/wav; charset=binary' })))

    const result = await fetchTtsAudio({
      url: 'http://localhost:5002/api/tts',
      text: 'Hello',
      voice: 'p225',
    })

    expect(result.mime).toBe('audio/wav')
    expect(result.bytes.byteLength).toBe(3)
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

  it('rejects HTTP failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ status: 503 })))
    await expectCode(fetchTtsAudio({ url: 'http://localhost/tts', text: 'Hello', voice: '' }), 'TTS_HTTP_ERROR')
  })

  it('rejects non-audio and empty responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(fakeResponse({ mime: 'application/json' })))
    await expectCode(fetchTtsAudio({ url: 'http://localhost/tts', text: 'Hello', voice: '' }), 'TTS_NON_AUDIO_RESPONSE')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(fakeResponse({ bytes: new Uint8Array() })))
    await expectCode(fetchTtsAudio({ url: 'http://localhost/tts', text: 'Hello', voice: '' }), 'TTS_EMPTY_RESPONSE')
  })

  it('rejects declared and actual oversized responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(fakeResponse({ contentLength: '11' })))
    await expectCode(fetchTtsAudio({
      url: 'http://localhost/tts',
      text: 'Hello',
      voice: '',
      maxResponseBytes: 10,
    }), 'TTS_RESPONSE_TOO_LARGE')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(fakeResponse({ bytes: new Uint8Array(11) })))
    await expectCode(fetchTtsAudio({
      url: 'http://localhost/tts',
      text: 'Hello',
      voice: '',
      maxResponseBytes: 10,
    }), 'TTS_RESPONSE_TOO_LARGE')
  })
})
