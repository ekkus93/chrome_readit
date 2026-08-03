/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import Options from './Options'

describe('Options integration (DOM)', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { chrome?: unknown }).chrome = {
      storage: {
        sync: {
          get: vi.fn(() => Promise.resolve({
            rate: 1,
            voice: 'p225',
            ttsUrl: 'http://localhost:5002/api/tts',
          })),
          set: vi.fn(() => Promise.resolve()),
        },
      },
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true })),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders and populates the voice select using /api/voices', async () => {
    const voicesResp = { voices: ['alice', 'bob'] }

    vi.stubGlobal('fetch', vi.fn((input: unknown) => {
      const url = String(input)
      if (url.endsWith('/api/voices')) {
        return Promise.resolve(new Response(JSON.stringify(voicesResp), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    }))

    render(<Options />)
    const select = await screen.findByLabelText(/Voice/i) as HTMLSelectElement
    await waitFor(() => expect(select.options.length).toBeGreaterThan(1), { timeout: 2000 })

    const values = Array.from(select.options).map((option) => option.value)
    expect(values).toEqual(expect.arrayContaining(['alice', 'bob']))
  })
})
