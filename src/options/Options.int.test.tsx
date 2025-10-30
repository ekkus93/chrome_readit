/* @vitest-environment jsdom */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
// React runtime automatic JSX; React import unused
import { render, screen, waitFor } from '@testing-library/react'

import Options from './Options'

describe('Options integration (DOM)', () => {
  beforeEach(() => {
    // Provide chrome.storage mock used by the component
  ;(globalThis as unknown as { chrome?: unknown }).chrome = {
      storage: {
        sync: {
          get: vi.fn(() => Promise.resolve({ settings: { ttsUrl: 'http://localhost:5002/api/tts/play' } })),
          set: vi.fn(() => Promise.resolve()),
        },
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
        return Promise.resolve(new Response(JSON.stringify(voicesResp), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      // other fetches (health/test) default to 200 OK empty
      return Promise.resolve(new Response(null, { status: 404 }))
    }))

    render(<Options />)

    // Wait for the select element to be available
    const select = await screen.findByLabelText(/Voice/i)

    // Wait for options to populate (the component polls/fetches voices async)
    await waitFor(() => expect(select.options.length).toBeGreaterThan(1), { timeout: 2000 })

    const values = Array.from(select.options as HTMLCollectionOf<HTMLOptionElement>).map((o) => o.value)
    expect(values).toEqual(expect.arrayContaining(['alice', 'bob']))
  })
})
