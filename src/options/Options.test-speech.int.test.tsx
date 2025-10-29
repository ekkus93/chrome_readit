/* @vitest-environment jsdom */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import Options from './Options'

describe('Options Test speech uses selected voice', () => {
  let storedSettings: any = { ttsUrl: 'http://localhost:5002/api/tts/play' }

  beforeEach(() => {
    storedSettings = { ttsUrl: 'http://localhost:5002/api/tts/play' }
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
  const playMock = vi.fn((input: unknown, _init?: any) => {
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
    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalled()
    const sendCall = (globalThis as any).chrome.runtime.sendMessage.mock.calls[0]
    const msg = sendCall[0]
    // The background registers onMessage listeners when imported; import it now
    await import('../background/service-worker')
    const addCalls = (globalThis as any).chrome.runtime.onMessage.addListener.mock.calls
    expect(addCalls.length).toBeGreaterThanOrEqual(2)
    const handler = addCalls[1][0]

    const sendResponse = vi.fn()
    // invoke background handler with the message that Options sent
    handler(msg, null, sendResponse)

    // allow async handler to run
    await new Promise((r) => setTimeout(r, 0))

    // ensure fetch to /api/tts/play was made and included voice
    const playCall = (playMock as any).mock.calls.find((c: any[]) => String(c[0]).endsWith('/api/tts/play'))
    expect(playCall).toBeDefined()
    const body = playCall[1]?.body ? JSON.parse(playCall[1].body) : null
    expect(body).toBeDefined()
    expect(body.voice).toBe('alice')
  })
})
