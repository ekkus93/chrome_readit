/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PLAYBACK_EVENT, PLAYBACK_STATUS, type PlaybackStatus } from '../lib/playback-protocol'
import Popup from './Popup'

type RuntimeListener = (message: unknown) => boolean

function status(overrides: Partial<PlaybackStatus> = {}): PlaybackStatus {
  return {
    kind: PLAYBACK_STATUS,
    sequence: 0,
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

describe('Popup start-response ordering', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('does not let a late accepted response resurrect a superseded test session', async () => {
    let listener: RuntimeListener | undefined
    let resolveStart: ((value: unknown) => void) | undefined
    const delayedStart = new Promise((resolve) => { resolveStart = resolve })
    const sendMessage = vi.fn((message: Record<string, unknown>, callback?: (response: unknown) => void) => {
      if (message.action === 'probe-tts') {
        callback?.({ ok: true })
        return undefined
      }
      if (message.kind === PLAYBACK_STATUS) return Promise.resolve(status())
      if (message.kind === 'READ_TEXT') return delayedStart
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
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ voices: ['p225'] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))))

    render(<Popup />)
    const button = await screen.findByRole('button', { name: /Try speech/i }) as HTMLButtonElement
    await userEvent.click(button)
    expect(button.disabled).toBe(true)

    act(() => {
      listener?.({
        kind: PLAYBACK_EVENT,
        event: 'accepted',
        atMs: 1,
        status: status({
          sequence: 1,
          state: 'starting',
          sessionId: 'popup-session',
          requestId: 'popup-request',
          source: 'popup-test',
          currentChunk: 1,
          totalChunks: 1,
          currentParagraph: 1,
          totalParagraphs: 1,
        }),
      })
      listener?.({
        kind: PLAYBACK_EVENT,
        event: 'accepted',
        atMs: 2,
        status: status({
          sequence: 2,
          state: 'starting',
          sessionId: 'replacement-session',
          requestId: 'replacement-request',
          source: 'options-test',
          currentChunk: 1,
          totalChunks: 1,
          currentParagraph: 1,
          totalParagraphs: 1,
        }),
      })
    })

    expect(await screen.findByText(/superseded by another playback request/i)).toBeTruthy()
    expect(button.disabled).toBe(false)

    await act(async () => {
      resolveStart?.({
        ok: true,
        accepted: true,
        requestId: 'popup-request',
        sessionId: 'popup-session',
      })
      await delayedStart
    })

    await waitFor(() => expect(button.disabled).toBe(false))
    expect(screen.getByText(/superseded by another playback request/i)).toBeTruthy()
  })
})
