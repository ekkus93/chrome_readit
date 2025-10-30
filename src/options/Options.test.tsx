import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchVoicesForTtsUrl } from './helpers'

describe('Options voice list', () => {
  beforeEach(() => {
  ;(globalThis as unknown as { chrome?: unknown }).chrome = {
      storage: {
        sync: {
          get: vi.fn(() => Promise.resolve({ settings: { ttsUrl: 'http://localhost:5002/api/tts/play' } })),
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

    const res = await fetchVoicesForTtsUrl('http://localhost:5002/api/tts/play')
    expect(res).toEqual(['alice', 'bob'])

    vi.restoreAllMocks()
  })
})
