/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  PLAYBACK_EVENT,
  PLAYBACK_STATUS,
  type PlaybackEvent,
  type PlaybackStatus,
} from '../lib/playback-protocol'
import Popup from './Popup'

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

describe('Popup explicit supersession ordering', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('normalizes a terminal SESSION_SUPERSEDED event and re-enables Try speech', async () => {
    let listener: ((message: unknown) => boolean) | undefined
    const sendMessage = vi.fn((message: Record<string, unknown>, callback?: (response: unknown) => void) => {
      if (message.action === 'probe-tts') {
        callback?.({ ok: true })
        return undefined
      }
      if (message.kind === PLAYBACK_STATUS) return Promise.resolve(status())
      if (message.kind === 'READ_TEXT') {
        return Promise.resolve({
          ok: true,
          accepted: true,
          requestId: 'popup-request',
          sessionId: 'popup-session',
        })
      }
      return Promise.resolve({ ok: false })
    })

    ;(globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        sendMessage,
        lastError: undefined,
        onMessage: {
          addListener: vi.fn((candidate: (message: unknown) => boolean) => { listener = candidate }),
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
    expect(listener).toBeTypeOf('function')

    const event: PlaybackEvent = {
      kind: PLAYBACK_EVENT,
      event: 'superseded',
      atMs: 1,
      status: status({
        sequence: 2,
        state: 'cancelled',
        sessionId: 'popup-session',
        requestId: 'popup-request',
        source: 'popup-test',
        error: {
          code: 'SESSION_SUPERSEDED',
          message: 'Playback was superseded by a newer request.',
        },
      }),
    }
    await act(async () => { listener?.(event) })

    expect(await screen.findByText('Test speech was superseded by another playback request.')).toBeTruthy()
    expect(screen.queryByText('Playback was superseded by a newer request.')).toBeNull()
    expect(button.disabled).toBe(false)
  })
})
