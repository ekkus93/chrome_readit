/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Popup from './Popup'

describe('Popup playback control buttons', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    ;(globalThis as unknown as { chrome?: unknown }).chrome = {
      runtime: {
        sendMessage: vi.fn(),
        lastError: undefined,
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      storage: {
        sync: {
          get: vi.fn(() => Promise.resolve({ rate: 1.0, voice: '', ttsUrl: 'http://localhost:5002/api/tts' })),
          set: vi.fn(() => Promise.resolve()),
        },
      },
    }
    vi.stubGlobal('fetch', vi.fn((input: unknown) => {
      const url = String(input)
      if (url.endsWith('/api/voices')) {
        return Promise.resolve(new Response(JSON.stringify({ voices: ['p225'] }), {
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

  function getGlobal(path: string[]) {
    let object: unknown = globalThis
    for (const part of path) {
      if (object && typeof object === 'object' && part in (object as Record<string, unknown>)) {
        object = (object as Record<string, unknown>)[part]
      } else return undefined
    }
    return object
  }

  it('sends pause/resume/cancel messages when buttons are clicked', async () => {
    render(<Popup />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /^Pause$/i }))
    await user.click(await screen.findByRole('button', { name: /^Resume$/i }))
    await user.click(await screen.findByRole('button', { name: /^Cancel$/i }))

    const runtimeSend = getGlobal(['chrome', 'runtime', 'sendMessage']) as { mock?: { calls?: unknown[][] } }
    const calls = runtimeSend.mock?.calls ?? []
    expect(calls.some((call) => (call[0] as Record<string, unknown>)?.kind === 'PAUSE_SPEECH')).toBe(true)
    expect(calls.some((call) => (call[0] as Record<string, unknown>)?.kind === 'RESUME_SPEECH')).toBe(true)
    expect(calls.some((call) => (call[0] as Record<string, unknown>)?.kind === 'CANCEL_SPEECH')).toBe(true)
  })

  it('updates and persists speech rate changes', async () => {
    render(<Popup />)
    fireEvent.change(await screen.findByLabelText(/^Rate/i), { target: { value: '1.7' } })

    const chromeObject = getGlobal(['chrome']) as { storage: { sync: { set: { mock?: { calls?: unknown[][] } } } } }
    await waitFor(() => {
      const calls = chromeObject.storage.sync.set.mock?.calls ?? []
      expect(calls.length).toBeGreaterThan(0)
      expect(calls.at(-1)?.[0]).toMatchObject({ rate: 1.7 })
    })
    expect(await screen.findByText(/Rate:\s*1\.70/)).toBeTruthy()
  })

  it.each([
    ['No selected text on the active page.', 'No selected text on the active page.'],
    ['No TTS service URL is configured.', 'No TTS service URL is configured.'],
    ['Playback not supported on this page', 'Playback not supported on this page'],
  ])('shows a useful read error: %s', async (error, expected) => {
    const chromeObject = getGlobal(['chrome']) as { runtime: { sendMessage: ReturnType<typeof vi.fn> } }
    chromeObject.runtime.sendMessage.mockImplementation((message: Record<string, unknown>, callback?: (value: unknown) => void) => {
      if (message.kind === 'READ_SELECTION') callback?.({ ok: false, error })
    })

    render(<Popup />)
    await userEvent.click(await screen.findByRole('button', { name: /Read selected text/i }))
    expect(await screen.findByText(expected)).toBeTruthy()
  })
})
