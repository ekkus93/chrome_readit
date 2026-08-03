/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  PLAYBACK_CONTROL,
  PLAYBACK_EVENT,
  PLAYBACK_STATUS,
  type PlaybackStatus,
} from '../lib/playback-protocol'
import Options from './Options'

type RuntimeListener = (message: unknown) => boolean

function playbackStatus(overrides: Partial<PlaybackStatus> = {}): PlaybackStatus {
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
  const persisted: Record<string, unknown> = {
    ttsUrl: 'http://localhost:5002/api/tts',
    voice: 'p225',
    rate: 1,
  }
  const sendMessage = vi.fn(async (message: Record<string, unknown>): Promise<unknown> => {
    if (message.action === 'probe-tts') return { ok: true, status: 200 }
    if (message.kind === PLAYBACK_STATUS) return playbackStatus()
    if (message.kind === 'READ_TEXT') {
      return { ok: true, accepted: true, requestId: 'request-1', sessionId: 'session-1' }
    }
    if (message.kind === PLAYBACK_CONTROL) {
      return { ok: true, sessionId: message.expectedSessionId ?? null, state: message.action === 'pause' ? 'paused' : 'playing' }
    }
    return { ok: false }
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

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('persists the selected voice only after storage succeeds and routes test speech without local Audio', async () => {
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

  it('does not persist malformed endpoint drafts and saves a valid endpoint explicitly', async () => {
    const { persisted } = installChrome()
    render(<Options />)
    const input = await screen.findByLabelText(/TTS synthesis endpoint/i)

    await userEvent.clear(input)
    await userEvent.type(input, 'not a url')
    expect(persisted.ttsUrl).toBe('http://localhost:5002/api/tts')
    await userEvent.click(screen.getByRole('button', { name: /Save endpoint/i }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/valid HTTP or HTTPS/i)
    expect(persisted.ttsUrl).toBe('http://localhost:5002/api/tts')

    await userEvent.clear(input)
    await userEvent.type(input, 'https://example.com/api/tts')
    await userEvent.click(screen.getByRole('button', { name: /Save endpoint/i }))
    await waitFor(() => expect(persisted.ttsUrl).toBe('https://example.com/api/tts'))
  })

  it('shows completion from the shared playback event stream', async () => {
    const { getListener } = installChrome()
    render(<Options />)
    await userEvent.click(await screen.findByRole('button', { name: /^Test speech$/i }))

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
          source: 'options-test',
          currentChunk: 1,
          totalChunks: 1,
          currentParagraph: 1,
          totalParagraphs: 1,
        }),
      })
    })

    expect(await screen.findByText(/^Completed$/)).toBeTruthy()
  })

  it('clears sending state when another source supersedes test speech', async () => {
    const { getListener } = installChrome()
    render(<Options />)
    const button = await screen.findByRole('button', { name: /^Test speech$/i }) as HTMLButtonElement
    await userEvent.click(button)
    expect(button.disabled).toBe(true)

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
    expect((screen.getByRole('button', { name: /^Test speech$/i }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('sends expected-session controls and displays structured failures', async () => {
    const { sendMessage, getListener } = installChrome()
    sendMessage.mockImplementation(async (message: Record<string, unknown>): Promise<unknown> => {
      if (message.action === 'probe-tts') return { ok: true, status: 200 }
      if (message.kind === PLAYBACK_STATUS) return playbackStatus()
      if (message.kind === PLAYBACK_CONTROL) {
        return {
          ok: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'The displayed session is stale.' },
        }
      }
      return { ok: false }
    })

    render(<Options />)
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

    await userEvent.click(await screen.findByRole('button', { name: /^Pause$/i }))

    expect(sendMessage.mock.calls.some(([message]) => (
      message.kind === PLAYBACK_CONTROL
      && message.action === 'pause'
      && message.expectedSessionId === 'session-active'
    ))).toBe(true)
    expect(await screen.findByText(/displayed session is stale/i)).toBeTruthy()
  })

  it('tests server health without synthesizing audio', async () => {
    const { sendMessage } = installChrome()
    const fetchMock = vi.mocked(fetch)
    render(<Options />)

    await userEvent.click(await screen.findByRole('button', { name: /^Test server$/i }))

    expect(sendMessage).toHaveBeenCalledWith({ action: 'probe-tts' })
    expect(fetchMock.mock.calls.every(([url]) => !String(url).endsWith('/api/tts'))).toBe(true)
    expect(await screen.findByText(/Server accepting requests/i)).toBeTruthy()
  })
})
