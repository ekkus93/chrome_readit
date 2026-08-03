/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PLAYBACK_CONTROL, PLAYBACK_EVENT, PLAYBACK_STATUS, type PlaybackStatus } from '../lib/playback-protocol'
import Options from './Options'

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
    if (message.action === 'probe-tts') return { ok: true }
    return { ok: false }
  })
  ;(globalThis as unknown as { chrome?: unknown }).chrome = {
    storage: {
      sync: {
        get: vi.fn(() => Promise.resolve({ rate: 1, voice: 'p225', ttsUrl: 'http://localhost:5002/api/tts' })),
        set: vi.fn(() => Promise.resolve()),
      },
    },
    runtime: {
      sendMessage,
      onMessage: {
        addListener: vi.fn((next: RuntimeListener) => { listener = next }),
        removeListener: vi.fn(),
      },
    },
  }
  return { sendMessage, getListener: () => listener }
}

describe('Options playback control buttons', () => {
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

  it('gates controls and sends shared expected-session messages', async () => {
    const { sendMessage, getListener } = installChrome()
    render(<Options />)

    expect((await screen.findByRole('button', { name: /^Pause$/i }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /^Resume$/i }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /^Stop$/i }) as HTMLButtonElement).disabled).toBe(true)

    act(() => {
      getListener()?.({
        kind: PLAYBACK_EVENT,
        event: 'state-changed',
        atMs: 1,
        status: status('playing', 'session-active'),
      })
    })
    await userEvent.click(screen.getByRole('button', { name: /^Pause$/i }))
    expect(sendMessage.mock.calls.some(([message]) => (
      message.kind === PLAYBACK_CONTROL
      && message.action === 'pause'
      && message.expectedSessionId === 'session-active'
    ))).toBe(true)

    act(() => {
      getListener()?.({
        kind: PLAYBACK_EVENT,
        event: 'state-changed',
        atMs: 2,
        status: status('paused', 'session-active'),
      })
    })
    await userEvent.click(screen.getByRole('button', { name: /^Resume$/i }))
    expect(sendMessage.mock.calls.some(([message]) => (
      message.kind === PLAYBACK_CONTROL
      && message.action === 'resume'
      && message.expectedSessionId === 'session-active'
    ))).toBe(true)

    await userEvent.click(screen.getByRole('button', { name: /^Stop$/i }))
    expect(sendMessage.mock.calls.some(([message]) => (
      message.kind === PLAYBACK_CONTROL
      && message.action === 'cancel'
      && message.expectedSessionId === 'session-active'
    ))).toBe(true)
  })

  it('persists updated speech rate only after storage succeeds', async () => {
    installChrome()
    render(<Options />)
    fireEvent.change(await screen.findByLabelText(/Speech rate/i), { target: { value: '1.35' } })

    const chromeObject = (globalThis as unknown as {
      chrome: { storage: { sync: { set: ReturnType<typeof vi.fn> } } }
    }).chrome
    await waitFor(() => expect(chromeObject.storage.sync.set).toHaveBeenCalledWith({ rate: 1.35 }))
    expect(await screen.findByText(/Speech rate:\s*1\.35/)).toBeTruthy()
  })

  it('surfaces settings load failure and repaired-setting warnings', async () => {
    installChrome()
    const chromeObject = (globalThis as unknown as {
      chrome: { storage: { sync: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> } } }
    }).chrome
    chromeObject.storage.sync.get.mockRejectedValueOnce(new Error('storage unavailable'))
    const first = render(<Options />)
    expect(await screen.findByText('Settings could not be loaded. Reload the extension and try again.')).toBeTruthy()
    first.unmount()

    chromeObject.storage.sync.get.mockResolvedValueOnce({ voice: '' })
    render(<Options />)
    expect(await screen.findByText(/stored voice was invalid/i)).toBeTruthy()
    expect(chromeObject.storage.sync.set).toHaveBeenCalledWith({ voice: 'p225' })
  })

  it('retains an endpoint save error and succeeds when the user retries', async () => {
    installChrome()
    const chromeObject = (globalThis as unknown as {
      chrome: { storage: { sync: { set: ReturnType<typeof vi.fn> } } }
    }).chrome
    chromeObject.storage.sync.set
      .mockRejectedValueOnce(new Error('quota exceeded'))
      .mockResolvedValueOnce(undefined)
    render(<Options />)
    const endpoint = await screen.findByLabelText(/TTS synthesis endpoint/i)
    fireEvent.change(endpoint, { target: { value: 'https://tts.example.test/api/tts' } })

    await userEvent.click(screen.getByRole('button', { name: /Save endpoint/i }))
    expect(await screen.findByText('The TTS endpoint could not be saved. Try again.')).toBeTruthy()
    expect(screen.getByText(/Saved endpoint: http:\/\/localhost:5002\/api\/tts/)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /Save endpoint/i }))
    await waitFor(() => expect(chromeObject.storage.sync.set).toHaveBeenLastCalledWith({
      ttsUrl: 'https://tts.example.test/api/tts',
    }))
    expect(await screen.findByText('Saved endpoint: https://tts.example.test/api/tts')).toBeTruthy()
    expect(screen.queryByText('The TTS endpoint could not be saved. Try again.')).toBeNull()
  })

  it('does not trigger discovery for an invalid endpoint draft and preserves the saved endpoint', async () => {
    installChrome()
    const fetchMock = vi.mocked(fetch)
    render(<Options />)
    await screen.findByLabelText(/TTS synthesis endpoint/i)
    const callsBeforeDraft = fetchMock.mock.calls.length

    fireEvent.change(screen.getByLabelText(/TTS synthesis endpoint/i), { target: { value: 'not a URL' } })
    await userEvent.click(screen.getByRole('button', { name: /Save endpoint/i }))

    expect(await screen.findByText('Enter a valid HTTP or HTTPS synthesis endpoint.')).toBeTruthy()
    expect(fetchMock.mock.calls).toHaveLength(callsBeforeDraft)
    expect(screen.getByText(/Saved endpoint: http:\/\/localhost:5002\/api\/tts/)).toBeTruthy()
  })

  it('renders voice discovery failure while retaining the configured voice', async () => {
    installChrome()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })))
    render(<Options />)

    expect(await screen.findByText(/voice endpoint returned HTTP 503/i)).toBeTruthy()
    expect((screen.getByLabelText(/^Voice$/i) as HTMLSelectElement).value).toBe('p225')
  })

})
