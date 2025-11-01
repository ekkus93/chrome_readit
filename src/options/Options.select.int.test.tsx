/* @vitest-environment jsdom */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import Options from './Options'

describe('Options select saves and background uses voice', () => {
  let storedSettings: unknown = { ttsUrl: 'http://localhost:5002/api/tts' }

  function getGlobal(path: string[]) {
    let obj: unknown = globalThis
    for (const p of path) {
      if (obj && typeof obj === 'object' && p in (obj as Record<string, unknown>)) {
        obj = (obj as Record<string, unknown>)[p]
      } else {
        return undefined
      }
    }
    return obj
  }

  beforeEach(() => {
    storedSettings = { ttsUrl: 'http://localhost:5002/api/tts' }
    // chrome.storage mocks: get returns current storedSettings; set mutates it
  ;(globalThis as unknown as { chrome?: unknown }).chrome = {
      storage: {
        sync: {
          get: vi.fn(() => Promise.resolve({ settings: storedSettings })),
          set: vi.fn((obj: unknown) => {
            const patched = obj as Record<string, unknown>
            const settingsPart = (patched && patched['settings']) ? (patched['settings'] as Record<string, unknown>) : {}
            storedSettings = { ...(storedSettings as Record<string, unknown>), ...settingsPart }
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
    const fetchMock = vi.fn((input: unknown /*, init?: unknown */) => {
      const url = String(input)
      if (url.endsWith('/api/voices')) {
        return Promise.resolve(new Response(JSON.stringify(voicesResp), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      if (url.endsWith('/api/tts')) {
        // reply with audio bytes
        return Promise.resolve({ ok: true, headers: { get: () => 'audio/wav' }, arrayBuffer: async () => fakeBuf, json: async () => ({}) } as unknown)
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

    // storage.set mutates storedSettings; verify the stored value instead of inspecting the mock directly
    expect((storedSettings as Record<string, unknown>).voice).toBe('alice')

    // Now import background module and trigger request-tts handler to ensure fetch includes voice
    // The background module reads chrome.storage.sync.get when handling messages, so storedSettings will be used
    await import('../background/service-worker')
  const runtimeOnMessage = getGlobal(['chrome', 'runtime', 'onMessage']) as unknown as { addListener?: { mock?: { calls?: unknown[][] } } }
  const addCalls = (runtimeOnMessage.addListener?.mock?.calls as unknown[][]) || []
  const handler = addCalls[1] && (addCalls[1][0] as unknown as (...args: unknown[]) => void)

    const sendResponse = vi.fn()
    handler({ action: 'request-tts', text: 'hello' }, null, sendResponse)

    // allow async handler to run
    await new Promise((r) => setTimeout(r, 0))

    // Find the fetch call to /api/tts and inspect its body
  const fetchCalls = (fetchMock.mock as unknown as { calls?: unknown[][] })?.calls || []
  const ttsCall = (fetchCalls as unknown[][]).find((c: unknown[]) => String(c[0]).endsWith('/api/tts')) as unknown[] | undefined
  expect(ttsCall).toBeDefined()
  const maybeInit = ttsCall ? (ttsCall[1] as Record<string, unknown>) : undefined
  const body = maybeInit && maybeInit.body ? JSON.parse(String(maybeInit.body)) : null
  expect(body).toBeDefined()
  expect((body as Record<string, unknown>).voice).toBe('alice')
  })
})
