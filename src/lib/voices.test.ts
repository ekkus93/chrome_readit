import { beforeEach, describe, expect, it, vi } from 'vitest'

import { deriveVoicesUrl, fetchServerVoices } from './voices'

describe('voices helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('derives root, trailing-slash, and prefixed voice endpoints', () => {
    expect(deriveVoicesUrl('http://localhost:5002/api/tts')).toBe('http://localhost:5002/api/voices')
    expect(deriveVoicesUrl('http://localhost:5002/api/tts/')).toBe('http://localhost:5002/api/voices')
    expect(deriveVoicesUrl('https://example.com/tts/api/tts?token=secret#fragment')).toBe('https://example.com/tts/api/voices')
  })

  it('returns null for malformed or unsupported URLs', () => {
    expect(deriveVoicesUrl('not a url')).toBeNull()
    expect(deriveVoicesUrl('file:///tmp/tts')).toBeNull()
  })

  it('fetches, trims, and deduplicates a valid voice list', async () => {
    const fetchMock = vi.fn((input: unknown) => {
      expect(String(input)).toBe('https://example.com/tts/api/voices')
      return Promise.resolve(new Response(JSON.stringify({ voices: ['alice', ' bob ', 'alice', ''] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchServerVoices('https://example.com/tts/api/tts')).resolves.toEqual({
      ok: true,
      voices: [
        { name: 'alice', label: 'alice' },
        { name: 'bob', label: 'bob' },
      ],
    })
  })

  it('distinguishes a valid empty voice list from discovery failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ voices: [] }), { status: 200 })))
    await expect(fetchServerVoices('https://example.com/api/tts')).resolves.toEqual({ ok: true, voices: [] })
  })

  it.each([
    ['not a url', 'INVALID_URL'],
  ])('reports invalid URL %s', async (url, code) => {
    await expect(fetchServerVoices(url)).resolves.toMatchObject({ ok: false, error: { code } })
  })

  it('reports network and HTTP failures distinctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')))
    await expect(fetchServerVoices('https://example.com/api/tts')).resolves.toMatchObject({
      ok: false,
      error: { code: 'NETWORK_ERROR' },
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })))
    await expect(fetchServerVoices('https://example.com/api/tts')).resolves.toMatchObject({
      ok: false,
      error: { code: 'HTTP_ERROR', status: 503 },
    })
  })

  it('reports invalid JSON and invalid schemas distinctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{', { status: 200 })))
    await expect(fetchServerVoices('https://example.com/api/tts')).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_JSON' },
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ voices: [1] }), { status: 200 })))
    await expect(fetchServerVoices('https://example.com/api/tts')).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_SCHEMA' },
    })
  })

  it('times out a hanging request', async () => {
    vi.stubGlobal('fetch', vi.fn((_input: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    })))

    await expect(fetchServerVoices('https://example.com/api/tts', 5)).resolves.toMatchObject({
      ok: false,
      error: { code: 'TIMEOUT' },
    })
  })
})
