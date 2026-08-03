/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PLAYBACK_EVENT, PLAYBACK_STATUS } from '../lib/playback-protocol'
import Popup from './Popup'

type RuntimeListener = (message: unknown) => boolean

function installChrome() {
  let listener: RuntimeListener | undefined
  const sendMessage = vi.fn((message: Record<string, unknown>, callback?: (response: unknown) => void) => {
    if (message.action === 'probe-tts') callback?.({ ok: true })
    if (message.kind === 'READ_TEXT') callback?.({
      ok: true,
      accepted: true,
      requestId: 'request-1',
      sessionId: 'session-1',
    })
  })
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      sendMessage,
      lastError: undefined,
      onMessage: {
        addListener: vi.fn((next: RuntimeListener) => { listener = next }),
        removeListener: vi.fn(),
      },
    },
    storage: {
      sync: {
        get: vi.fn(() => Promise.resolve({ rate: 1, voice: 'p225', ttsUrl: 'http://localhost:5002/api/tts' })),
        set: vi.fn(() => Promise.resolve()),
      },
    },
  }
  return { sendMessage, getListener: () => listener }
}

describe('Popup coordinator test speech and voice loading', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', vi.fn((input: unknown) => {
      const url = String(input)
      if (url.endsWith('/api/voices')) {
        return Promise.resolve(new Response(JSON.stringify({ voices: ['p225', 'p226'] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    }))
  })

  it('loads server voices into the popup voice select', async () => {
    installChrome()
    render(<Popup />)

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'p226' })).toBeTruthy()
    })
  })

  it('routes test speech through the coordinator without constructing Audio', async () => {
    const { sendMessage } = installChrome()
    const audioConstructor = vi.fn()
    vi.stubGlobal('Audio', audioConstructor)

    render(<Popup />)
    await userEvent.click(await screen.findByRole('button', { name: /Try speech/i }))

    expect(sendMessage).toHaveBeenCalledWith({
      kind: 'READ_TEXT',
      text: 'Hello from the popup',
      source: 'popup-test',
    }, expect.any(Function))
    expect(audioConstructor).not.toHaveBeenCalled()
  })

  it('shows coordinator completion for popup test speech', async () => {
    const { getListener } = installChrome()
    render(<Popup />)
    await userEvent.click(await screen.findByRole('button', { name: /Try speech/i }))

    getListener()?.({
      kind: PLAYBACK_EVENT,
      event: 'completed',
      atMs: 1,
      status: {
        kind: PLAYBACK_STATUS,
        state: 'completed',
        sessionId: 'session-1',
        requestId: 'request-1',
        source: 'popup-test',
        currentChunk: 1,
        totalChunks: 1,
        currentParagraph: 1,
        totalParagraphs: 1,
      },
    })

    expect(await screen.findByText(/Test speech completed/i)).toBeTruthy()
  })

  it('shows a structured start failure', async () => {
    const { sendMessage } = installChrome()
    sendMessage.mockImplementation((message: Record<string, unknown>, callback?: (response: unknown) => void) => {
      if (message.action === 'probe-tts') callback?.({ ok: true })
      if (message.kind === 'READ_TEXT') callback?.({
        ok: false,
        accepted: false,
        error: { code: 'TTS_HTTP_ERROR', message: 'Service unavailable.' },
      })
    })

    render(<Popup />)
    await userEvent.click(await screen.findByRole('button', { name: /Try speech/i }))

    expect(await screen.findByText(/Test speech failed or was cancelled/i)).toBeTruthy()
  })
})
