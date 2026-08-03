/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PLAYBACK_CONTROL, PLAYBACK_EVENT, PLAYBACK_STATUS, type PlaybackStatus } from '../lib/playback-protocol'
import Popup from './Popup'

type RuntimeListener = (message: unknown) => boolean

function status(state: PlaybackStatus['state'], sessionId: string | null = null): PlaybackStatus {
  const active = sessionId !== null
  return {
    kind: PLAYBACK_STATUS,
    sequence: active ? 2 : 0,
    state,
    sessionId,
    requestId: active ? 'request-active' : null,
    source: active ? 'selection' : null,
    currentChunk: active ? 1 : 0,
    totalChunks: active ? 1 : 0,
    currentParagraph: active ? 1 : 0,
    totalParagraphs: active ? 1 : 0,
    ...(state === 'cancelled' ? { error: { code: 'CANCELLED' as const, message: 'Playback was cancelled.' } } : {}),
    ...(state === 'failed' ? { error: { code: 'INTERNAL_PLAYBACK_ERROR' as const, message: 'Playback failed.' } } : {}),
  }
}

function installChrome() {
  let listener: RuntimeListener | undefined
  const sendMessage = vi.fn(async (message: Record<string, unknown>): Promise<unknown> => {
    if (message.kind === PLAYBACK_STATUS) return status('idle')
    if (message.kind === PLAYBACK_CONTROL) {
      return {
        ok: true,
        sessionId: message.expectedSessionId ?? null,
        state: message.action === 'pause' ? 'paused' : message.action === 'resume' ? 'playing' : 'cancelled',
      }
    }
    if (message.kind === 'READ_SELECTION') {
      return { ok: true, accepted: true, requestId: 'request-read', sessionId: 'session-read' }
    }
    return { ok: false }
  })
  ;(globalThis as unknown as { chrome?: unknown }).chrome = {
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

describe('Popup playback control buttons', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', vi.fn((input: unknown) => {
      if (String(input).endsWith('/api/voices')) {
        return Promise.resolve(new Response(JSON.stringify({ voices: ['p225'] }), { status: 200 }))
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    }))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('gates controls by state and sends shared expected-session messages', async () => {
    const { sendMessage, getListener } = installChrome()
    render(<Popup />)

    expect((await screen.findByRole('button', { name: /^Pause$/i }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /^Resume$/i }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /^Cancel$/i }) as HTMLButtonElement).disabled).toBe(true)

    act(() => {
      getListener()?.({
        kind: PLAYBACK_EVENT,
        event: 'state-changed',
        atMs: 1,
        status: status('playing', 'session-active'),
      })
    })

    await userEvent.click(screen.getByRole('button', { name: /^Pause$/i }))
    expect(sendMessage).toHaveBeenLastCalledWith({
      kind: PLAYBACK_CONTROL,
      action: 'pause',
      expectedSessionId: 'session-active',
    })

    act(() => {
      getListener()?.({
        kind: PLAYBACK_EVENT,
        event: 'state-changed',
        atMs: 2,
        status: status('paused', 'session-active'),
      })
    })
    await userEvent.click(screen.getByRole('button', { name: /^Resume$/i }))
    expect(sendMessage).toHaveBeenLastCalledWith({
      kind: PLAYBACK_CONTROL,
      action: 'resume',
      expectedSessionId: 'session-active',
    })

    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }))
    expect(sendMessage).toHaveBeenLastCalledWith({
      kind: PLAYBACK_CONTROL,
      action: 'cancel',
      expectedSessionId: 'session-active',
    })
  })

  it('updates and persists speech rate changes', async () => {
    installChrome()
    render(<Popup />)
    fireEvent.change(await screen.findByLabelText(/^Rate/i), { target: { value: '1.7' } })

    const chromeObject = (globalThis as unknown as {
      chrome: { storage: { sync: { set: ReturnType<typeof vi.fn> } } }
    }).chrome
    await waitFor(() => expect(chromeObject.storage.sync.set).toHaveBeenCalledWith({ rate: 1.7 }))
    expect(await screen.findByText(/Rate:\s*1\.70/)).toBeTruthy()
  })

  it.each([
    ['No selected text on the active page.'],
    ['No TTS service URL is configured.'],
    ['Playback not supported on this page'],
  ])('shows a structured read error: %s', async (message) => {
    const { sendMessage } = installChrome()
    sendMessage.mockImplementation(async (request: Record<string, unknown>): Promise<unknown> => {
      if (request.kind === PLAYBACK_STATUS) return status('idle')
      if (request.kind === 'READ_SELECTION') {
        return { ok: false, accepted: false, error: { code: 'INVALID_REQUEST', message } }
      }
      return { ok: false }
    })

    render(<Popup />)
    await userEvent.click(await screen.findByRole('button', { name: /Read selected text/i }))
    expect(await screen.findByText(message)).toBeTruthy()
  })
})
