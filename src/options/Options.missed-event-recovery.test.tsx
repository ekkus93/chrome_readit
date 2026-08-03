/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PLAYBACK_STATUS, type PlaybackStatus } from '../lib/playback-protocol'
import Options from './Options'

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

describe('Options missed-event recovery', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('exits sending state from authoritative polling when supersession broadcast is missed', async () => {
    let currentStatus = status()
    const sendMessage = vi.fn((message: Record<string, unknown>) => {
      if (message.kind === PLAYBACK_STATUS) return Promise.resolve(currentStatus)
      if (message.kind === 'READ_TEXT') {
        return Promise.resolve({
          ok: true,
          accepted: true,
          requestId: 'options-request',
          sessionId: 'options-session',
        })
      }
      if (message.action === 'probe-tts') return Promise.resolve({ ok: true })
      return Promise.resolve({ ok: false })
    })

    ;(globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        sendMessage,
        lastError: undefined,
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
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

    render(<Options />)
    const button = await screen.findByRole('button', { name: /Test speech/i }) as HTMLButtonElement
    await userEvent.click(button)
    expect(button.disabled).toBe(true)

    currentStatus = status({
      sequence: 2,
      state: 'playing',
      sessionId: 'replacement-session',
      requestId: 'replacement-request',
      source: 'selection',
      currentChunk: 1,
      totalChunks: 1,
      currentParagraph: 1,
      totalParagraphs: 1,
    })

    expect(await screen.findByText(/superseded by another playback request/i, {}, { timeout: 2_000 })).toBeTruthy()
    expect(button.disabled).toBe(false)
  })
})
