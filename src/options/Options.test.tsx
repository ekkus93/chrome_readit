import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchServerVoices } from '../lib/voices'

describe('Options voice list', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { chrome?: unknown }).chrome = {
      storage: {
        sync: {
          get: vi.fn(() => Promise.resolve({ settings: { ttsUrl: 'http://localhost:5002/api/tts' } })),
          set: vi.fn(() => Promise.resolve()),
        },
      },
    }
  })

  it('fetches /api/voices and returns the list', async () => {
    const voicesResp = { voices: ['alice', 'bob'] }
    const fetchMock = vi.fn((input: unknown) => {
      const url = String(input)
      if (url.endsWith('/api/voices')) {
        return Promise.resolve(new Response(JSON.stringify(voicesResp), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await fetchServerVoices('http://localhost:5002/api/tts')
    expect(res).toEqual([{ name: 'alice', label: 'alice' }, { name: 'bob', label: 'bob' }])

    vi.restoreAllMocks()
  })
})
