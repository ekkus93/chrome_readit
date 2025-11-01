/* @vitest-environment jsdom */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import Options from './Options'

describe('Options Test speech uses selected voice', () => {
  let storedSettings: unknown = { ttsUrl: 'http://localhost:5002/api/tts/play' }

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
    storedSettings = { ttsUrl: 'http://localhost:5002/api/tts/play' }
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
      runtime: { onMessage: { addListener: vi.fn() }, onInstalled: { addListener: vi.fn() }, sendMessage: vi.fn() },
      contextMenus: { create: vi.fn(), onClicked: { addListener: vi.fn() } },
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends request-tts via runtime and background posts voice to /api/tts/play', async () => {
    // stub fetch: voices endpoint and play endpoint
    const voicesResp = { voices: ['alice', 'bob'] }
  const playMock = vi.fn((input: unknown, _init?: unknown) => {
    void _init
      const url = String(input)
      if (url.endsWith('/api/voices')) {
        return Promise.resolve(new Response(JSON.stringify(voicesResp), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      if (url.endsWith('/api/tts/play')) {
        // record body
        return Promise.resolve(new Response(JSON.stringify({ ok: true, played: true }), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })
    vi.stubGlobal('fetch', playMock)

    render(<Options />)

    // wait for voices to populate
    const select = await screen.findByLabelText(/Voice/i)
    await screen.findByRole('option', { name: /alice/i })

    // choose alice
    const user = userEvent.setup()
    await user.selectOptions(select as HTMLSelectElement, 'alice')

    // click Test speech button
    const btn = screen.getByRole('button', { name: /Test speech/i })
    await user.click(btn)

  // runtime.sendMessage should have been called by Options
  const runtimeSend = getGlobal(['chrome', 'runtime', 'sendMessage']) as unknown as { mock?: { calls?: unknown[][] } }
  const sendCall = runtimeSend.mock?.calls?.[0] as unknown[] | undefined
  const msg = sendCall ? sendCall[0] : undefined
  expect(msg).toBeDefined()
    // The background registers onMessage listeners when imported; import it now
    await import('../background/service-worker')
  const runtimeOnMessage = getGlobal(['chrome', 'runtime', 'onMessage']) as unknown as { addListener?: { mock?: { calls?: unknown[][] } } }
  const addCalls = (runtimeOnMessage.addListener?.mock?.calls as unknown[][]) || []
  expect(addCalls.length).toBeGreaterThanOrEqual(2)
  const handler = addCalls[1] && (addCalls[1][0] as unknown as (...args: unknown[]) => void)

    const sendResponse = vi.fn()
    // invoke background handler with the message that Options sent
    handler(msg, null, sendResponse)

    // allow async handler to run
    await new Promise((r) => setTimeout(r, 0))

    // ensure fetch to /api/tts/play was made and included voice
  const playCalls = (playMock.mock as unknown as { calls?: unknown[][] })?.calls || []
  const playCall = (playCalls as unknown[][]).find((c: unknown[]) => String(c[0]).endsWith('/api/tts/play')) as unknown[] | undefined
  expect(playCall).toBeDefined()
  const maybeInit = playCall ? (playCall[1] as Record<string, unknown>) : undefined
  const body = maybeInit && maybeInit.body ? JSON.parse(String(maybeInit.body)) : null
  expect(body).toBeDefined()
  expect((body as Record<string, unknown>).voice).toBe('alice')
  })
})
