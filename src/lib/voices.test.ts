import { beforeEach, describe, expect, it, vi } from 'vitest'

import { deriveVoicesUrl, fetchServerVoices } from './voices'

describe('voices helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('derives a root-mounted voices endpoint from the tts endpoint', () => {
    expect(deriveVoicesUrl('http://localhost:5002/api/tts')).toBe('http://localhost:5002/api/voices')
  })

  it('derives a prefixed voices endpoint from the tts endpoint', () => {
    expect(deriveVoicesUrl('https://example.com/tts/api/tts')).toBe('https://example.com/tts/api/voices')
  })

  it('returns null for malformed urls', () => {
    expect(deriveVoicesUrl('not a url')).toBeNull()
  })

  it('fetches the derived voices endpoint and returns the list', async () => {
    const fetchMock = vi.fn((input: unknown) => {
      expect(String(input)).toBe('https://example.com/tts/api/voices')
      return Promise.resolve(new Response(JSON.stringify({ voices: ['alice', 'bob'] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchServerVoices('https://example.com/tts/api/tts')).resolves.toEqual([
      { name: 'alice', label: 'alice' },
      { name: 'bob', label: 'bob' },
    ])
  })
})
