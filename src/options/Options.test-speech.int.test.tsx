/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PLAYBACK_EVENT, PLAYBACK_STATUS } from '../lib/playback-protocol'
import Options from './Options'

type RuntimeListener = (message: unknown) => boolean

function installChrome() {
  let listener: RuntimeListener | undefined
  const persisted: Record<string, unknown> = {
    ttsUrl: 'http://localhost:5002/api/tts',
    voice: 'p225',
    rate: 1,
  }
  const sendMessage = vi.fn(async (message: Record<string, unknown>) => {
    if (message.action === 'probe-tts') return { ok: true, status: 200 }
    if (message.kind === 'READ_TEXT') {
      return { ok: true, accepted: true, requestId: 'request-1', sessionId: 'session-1' }
    }
    return { ok: true }
  })
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      sendMessage,
      onMessage: {
        addListener: vi.fn((next: RuntimeListener) => { listener = next }),
        removeListener: vi.fn(),
      },
    },
    storage: {
      sync: {
        get: vi.fn(async () => ({ ...persisted })),
        set: vi.fn(async (updates: Record<string, unknown>) => { Object.assign(persisted, updates) }),
      },
    },
  }
  return { persisted, sendMessage, getListener: () => listener }
}

describe('Options coordinator test speech', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', vi.fn((input: unknown) => {
      const url = String(input)
      if (url.endsWith('/api/voices')) {
        return Promise.resolve(new Response(JSON.stringify({ voices: ['alice', 'bob'] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    }))
  })

  it('persists the selected voice and routes test speech without local Audio', async () => {
    const { persisted, sendMessage } = installChrome()
    const audioConstructor = vi.fn()
    vi.stubGlobal('Audio', audioConstructor)
    render(<Options />)

    const voiceSelect = await screen.findByLabelText(/Voice/i)
    await screen.findByRole('option', { name: 'alice' })
    await userEvent.selectOptions(voiceSelect, 'alice')
    await waitFor(() => expect(persisted.voice).toBe('alice'))

    await userEvent.click(screen.getByRole('button', { name: /^Test speech$/i }))

    expect(sendMessage).toHaveBeenCalledWith({
      kind: 'READ_TEXT',
      text: 'Hello — this is a quick test of Read It.',
      source: 'options-test',
    })
    expect(audioConstructor).not.toHaveBeenCalled()
  })

  it('shows completion from the shared playback event stream', async () => {
    const { getListener } = installChrome()
    render(<Options />)
    await userEvent.click(await screen.findByRole('button', { name: /^Test speech$/i }))

    getListener()?.({
      kind: PLAYBACK_EVENT,
      event: 'completed',
      atMs: 1,
      status: {
        kind: PLAYBACK_STATUS,
        state: 'completed',
        sessionId: 'session-1',
        requestId: 'request-1',
        source: 'options-test',
        currentChunk: 1,
        totalChunks: 1,
        currentParagraph: 1,
        totalParagraphs: 1,
      },
    })

    expect(await screen.findByText(/Completed/i)).toBeTruthy()
  })

  it('tests server health without synthesizing audio', async () => {
    const { sendMessage } = installChrome()
    const fetchMock = vi.mocked(fetch)
    render(<Options />)

    await userEvent.click(await screen.findByRole('button', { name: /^Test server$/i }))

    expect(sendMessage).toHaveBeenCalledWith({ action: 'probe-tts' })
    expect(fetchMock.mock.calls.every(([url]) => !String(url).endsWith('/api/tts'))).toBe(true)
    expect(await screen.findByText(/Server reachable/i)).toBeTruthy()
  })
})
