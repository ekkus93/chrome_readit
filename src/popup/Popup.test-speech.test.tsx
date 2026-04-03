/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import Popup from './Popup'

describe('Popup test speech and voice loading', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:test-audio'),
      revokeObjectURL: vi.fn(),
    }))
    vi.stubGlobal('fetch', vi.fn((input: unknown) => {
      const url = String(input)
      if (url.endsWith('/api/voices')) {
        return Promise.resolve(new Response(JSON.stringify({ voices: ['p225', 'p226'] }), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    }))

    ;(globalThis as unknown as { chrome?: unknown }).chrome = {
      runtime: { sendMessage: vi.fn() },
      storage: { sync: { get: vi.fn(() => Promise.resolve({ settings: { rate: 1.0, voice: 'p225', ttsUrl: 'http://localhost:5002/api/tts' } })), set: vi.fn(() => Promise.resolve()) } },
    }
  })

  it('loads server voices into the popup voice select', async () => {
    const runtimeSend = ((globalThis as unknown as Record<string, unknown>).chrome as { runtime: { sendMessage: ReturnType<typeof vi.fn> } }).runtime.sendMessage
    runtimeSend.mockImplementation((message: { action?: string }, callback?: (response: unknown) => void) => {
      if (message.action === 'probe-tts') callback?.({ ok: true })
    })

    render(<Popup />)

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'p226' })).toBeTruthy()
    })
  })

  it('shows an error when popup test speech receives no playable audio', async () => {
    const runtimeSend = ((globalThis as unknown as Record<string, unknown>).chrome as { runtime: { sendMessage: ReturnType<typeof vi.fn> } }).runtime.sendMessage
    runtimeSend.mockImplementation((message: { action?: string }, callback?: (response: unknown) => void) => {
      if (message.action === 'probe-tts') callback?.({ ok: true })
      if (message.action === 'request-tts') callback?.({ ok: true, mime: 'audio/wav' })
    })

    render(<Popup />)
    const trySpeechButton = (await screen.findAllByRole('button', { name: /Try speech/i }))[0]
    await userEvent.click(trySpeechButton)

    expect(await screen.findByText(/Failed to play returned speech audio/i)).toBeTruthy()
  })

  it('does not report success when popup audio play fails', async () => {
    const runtimeSend = ((globalThis as unknown as Record<string, unknown>).chrome as { runtime: { sendMessage: ReturnType<typeof vi.fn> } }).runtime.sendMessage
    runtimeSend.mockImplementation((message: { action?: string }, callback?: (response: unknown) => void) => {
      if (message.action === 'probe-tts') callback?.({ ok: true })
      if (message.action === 'request-tts') callback?.({ ok: true, audio: btoa('abc'), mime: 'audio/wav' })
    })

    vi.stubGlobal('Audio', function () {
      return {
        play: () => Promise.reject(new Error('NotAllowedError')),
        playbackRate: 1,
        autoplay: false,
      }
    } as unknown)

    render(<Popup />)
    const trySpeechButton = (await screen.findAllByRole('button', { name: /Try speech/i }))[0]
    await userEvent.click(trySpeechButton)

    expect(await screen.findByText(/Failed to play returned speech audio/i)).toBeTruthy()
    expect(screen.queryByText(/Played test speech in the popup/i)).toBeNull()
  })
})
