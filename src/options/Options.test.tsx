import { describe, expect, it, vi } from 'vitest'

import { fetchServerVoices } from '../lib/voices'

describe('Options voice list', () => {
  it('fetches /api/voices and returns a structured list', async () => {
    const fetchMock = vi.fn((input: unknown) => {
      expect(String(input)).toBe('http://localhost:5002/api/voices')
      return Promise.resolve(new Response(JSON.stringify({ voices: ['alice', 'bob'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchServerVoices('http://localhost:5002/api/tts')).resolves.toEqual({
      ok: true,
      voices: [{ name: 'alice', label: 'alice' }, { name: 'bob', label: 'bob' }],
    })
  })
})
