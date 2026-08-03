/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PLAYBACK_CONTROL, PLAYBACK_EVENT, PLAYBACK_STATUS } from '../lib/playback-protocol'
import Popup from './Popup'

type RuntimeListener = (message: unknown) => boolean

function playbackStatus(overrides: Record<string, unknown> = {}) {
  return {
    kind: PLAYBACK_STATUS,
    sequence: 1,
    state: 'idle',
    sessionId: null,
    requestId: null,
    source: null,
    currentChunk: 0,
    totalChunks: 0,
    currentParagraph: 0,
    totalParagraphs: 0,
    ...overrides,
  }
}

function installChrome() {
  let listener: RuntimeListener | undefined
  const sendMessage = vi.fn((message: Record<string, unknown>, callback?: (response: unknown) => void) => {
    if (message.action === 'probe-tts') {
      callback?.({ ok: true })
      return undefined
    }
    if (message.kind === PLAYBACK_STATUS) return Promise.resolve(playbackStatus())
    if (message.kind === 'READ_TEXT') {
      return Promise.resolve({ ok: true, accepted: true, requestId: 'request-1', sessionId: 'session-1' })
    }
    if (message.kind === 'READ_SELECTION') {
      return Promise.resolve({ ok: true, accepted: true, requestId: 'request-selection', sessionId: 'session-selection' })
    }
    if (message.kind === PLAYBACK_CONTROL) {
      return Promise.resolve({ ok: true, sessionId: message.expectedSessionId ?? null, state: 'paused' })
    }
    return Promise.resolve({ ok: false })
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

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
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
    })
    expect(audioConstructor).not.toHaveBeenCalled()
  })

  it('shows coordinator completion for popup test speech', async () => {
    const { getListener } = installChrome()
    render(<Popup />)
    await userEvent.click(await screen.findByRole('button', { name: /Try speech/i }))

    act(() => {
      getListener()?.({
        kind: PLAYBACK_EVENT,
        event: 'completed',
        atMs: 1,
        status: playbackStatus({
          sequence: 3,
          state: 'completed',
          sessionId: 'session-1',
          requestId: 'request-1',
          source: 'popup-test',
          currentChunk: 1,
          totalChunks: 1,
          currentParagraph: 1,
          totalParagraphs: 1,
        }),
      })
    })

    expect(await screen.findByText(/Test speech completed/i)).toBeTruthy()
  })

  it('clears the disabled test button after supersession', async () => {
    const { getListener } = installChrome()
    render(<Popup />)
    const button = await screen.findByRole('button', { name: /Try speech/i })
    await userEvent.click(button)
    expect(button).toBeDisabled()

    act(() => {
      getListener()?.({
        kind: PLAYBACK_EVENT,
        event: 'accepted',
        atMs: 2,
        status: playbackStatus({
          sequence: 4,
          state: 'starting',
          sessionId: 'replacement',
          requestId: 'request-2',
          source: 'selection',
          currentChunk: 1,
          totalChunks: 1,
          currentParagraph: 1,
          totalParagraphs: 1,
        }),
      })
    })

    expect(await screen.findByText(/superseded by another playback request/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Try speech/i })).not.toBeDisabled()
  })

  it('shows the structured start failure message', async () => {
    const { sendMessage } = installChrome()
    sendMessage.mockImplementation((message: Record<string, unknown>, callback?: (response: unknown) => void) => {
      if (message.action === 'probe-tts') {
        callback?.({ ok: true })
        return undefined
      }
      if (message.kind === PLAYBACK_STATUS) return Promise.resolve(playbackStatus())
      if (message.kind === 'READ_TEXT') {
        return Promise.resolve({
          ok: false,
          accepted: false,
          error: { code: 'TTS_HTTP_ERROR', message: 'Service unavailable.' },
        })
      }
      return Promise.resolve({ ok: false })
    })

    render(<Popup />)
    await userEvent.click(await screen.findByRole('button', { name: /Try speech/i }))

    expect(await screen.findByText(/Service unavailable/i)).toBeTruthy()
  })

  it('sends expected-session controls and surfaces failures', async () => {
    const { sendMessage, getListener } = installChrome()
    render(<Popup />)
    act(() => {
      getListener()?.({
        kind: PLAYBACK_EVENT,
        event: 'state-changed',
        atMs: 1,
        status: playbackStatus({
          sequence: 2,
          state: 'playing',
          sessionId: 'session-active',
          requestId: 'request-active',
          source: 'selection',
          currentChunk: 1,
          totalChunks: 1,
          currentParagraph: 1,
          totalParagraphs: 1,
        }),
      })
    })
    sendMessage.mockResolvedValueOnce({
      ok: false,
      error: { code: 'SESSION_NOT_FOUND', message: 'This session is stale.' },
    })

    await userEvent.click(await screen.findByRole('button', { name: /^Pause$/i }))

    expect(sendMessage).toHaveBeenLastCalledWith({
      kind: PLAYBACK_CONTROL,
      action: 'pause',
      expectedSessionId: 'session-active',
    })
    expect(await screen.findByText(/session is stale/i)).toBeTruthy()
  })
})
