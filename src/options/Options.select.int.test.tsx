/* @vitest-environment jsdom */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import Options from './Options'

describe('Options select saves and background uses voice', () => {
  let storedSettings: any = { ttsUrl: 'http://localhost:5002/api/tts' }

  beforeEach(() => {
    storedSettings = { ttsUrl: 'http://localhost:5002/api/tts' }
    // chrome.storage mocks: get returns current storedSettings; set mutates it
    ;(globalThis as unknown as { chrome?: any }).chrome = {
      storage: {
        sync: {
          get: vi.fn(() => Promise.resolve({ settings: storedSettings })),
          set: vi.fn((obj: any) => {
            storedSettings = { ...(storedSettings || {}), ...(obj.settings || {}) }
            return Promise.resolve()
          }),
        },
      },
      tabs: { query: vi.fn(() => Promise.resolve([{ id: 101, url: 'https://example.com' }])), sendMessage: vi.fn() },
      scripting: { executeScript: vi.fn() },
      commands: { onCommand: { addListener: vi.fn() } },
      runtime: { onMessage: { addListener: vi.fn() }, onInstalled: { addListener: vi.fn() } },
      contextMenus: { create: vi.fn(), onClicked: { addListener: vi.fn() } },
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('selecting a voice saves it and background includes it in TTS requests', async () => {
    // stub fetch: voices endpoint and tts endpoint
    const voicesResp = { voices: ['alice', 'bob'] }
    const fakeBuf = new Uint8Array([1, 2, 3]).buffer
  const fetchMock = vi.fn((input: unknown /*, init?: any */) => {
      const url = String(input)
      if (url.endsWith('/api/voices')) {
        return Promise.resolve(new Response(JSON.stringify(voicesResp), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      if (url.endsWith('/api/tts')) {
        // reply with audio bytes
        return Promise.resolve({ ok: true, headers: { get: () => 'audio/wav' }, arrayBuffer: async () => fakeBuf, json: async () => ({}) } as any)
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<Options />)

    // wait for the select to appear and options to populate
    const select = await screen.findByLabelText(/Voice/i)
    await screen.findByRole('option', { name: /alice/i })

    // select 'alice'
    const user = userEvent.setup()
    await user.selectOptions(select as HTMLSelectElement, 'alice')

    // storage.set should have been called (chrome.storage.sync.set mutated storedSettings)
    expect((globalThis as any).chrome.storage.sync.set).toHaveBeenCalled()
    expect(storedSettings.voice).toBe('alice')

    // Now import background module and trigger request-tts handler to ensure fetch includes voice
    // The background module reads chrome.storage.sync.get when handling messages, so storedSettings will be used
    await import('../background/service-worker')
    const addCalls = (globalThis as any).chrome.runtime.onMessage.addListener.mock.calls
    const handler = addCalls[1][0]

    const sendResponse = vi.fn()
    handler({ action: 'request-tts', text: 'hello' }, null, sendResponse)

    // allow async handler to run
    await new Promise((r) => setTimeout(r, 0))

    // Find the fetch call to /api/tts and inspect its body
    const ttsCall = (fetchMock.mock.calls as any[]).find((c: any[]) => String(c[0]).endsWith('/api/tts')) as any
    expect(ttsCall).toBeDefined()
    const body = ttsCall[1]?.body ? JSON.parse(ttsCall[1].body) : null
    expect(body).toBeDefined()
    expect(body.voice).toBe('alice')
  })
})
