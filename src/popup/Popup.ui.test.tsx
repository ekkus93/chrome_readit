/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import Popup from './Popup'

describe('Popup playback control buttons', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    // minimal chrome mock
  ;(globalThis as unknown as { chrome?: unknown }).chrome = {
      runtime: { sendMessage: vi.fn() },
      storage: { sync: { get: vi.fn(() => Promise.resolve({ settings: { rate: 1.0, voice: '' } })), set: vi.fn(() => Promise.resolve()) } },
    }
    vi.stubGlobal('fetch', vi.fn((input: unknown) => {
      const url = String(input)
      if (url.endsWith('/api/voices')) {
        return Promise.resolve(new Response(JSON.stringify({ voices: ['p225'] }), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    }))
  })

  function getGlobal(path: string[]) {
    let obj: unknown = globalThis
    for (const p of path) {
      if (obj && typeof obj === 'object' && p in (obj as Record<string, unknown>)) {
        obj = (obj as Record<string, unknown>)[p]
      } else {
        return undefined
      }
    }
    return obj
  }

  it('sends pause/resume/cancel messages when buttons are clicked', async () => {
    render(<Popup />)
    const user = userEvent.setup()

    const pause = await screen.findByRole('button', { name: /^Pause$/i })
    const resume = await screen.findByRole('button', { name: /^Resume$/i })
    const cancel = await screen.findByRole('button', { name: /^Cancel$/i })

    await user.click(pause)
    await user.click(resume)
    await user.click(cancel)

    const runtimeSend = getGlobal(['chrome', 'runtime', 'sendMessage']) as unknown as { mock?: { calls?: unknown[][] } }
    const calls = (runtimeSend.mock?.calls as unknown[][]) || []
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.some((c) => (c[0] as Record<string, unknown>)?.kind === 'PAUSE_SPEECH')).toBeTruthy()
    expect(calls.some((c) => (c[0] as Record<string, unknown>)?.kind === 'RESUME_SPEECH')).toBeTruthy()
    expect(calls.some((c) => (c[0] as Record<string, unknown>)?.kind === 'CANCEL_SPEECH')).toBeTruthy()
  })

  it('updates and persists speech rate changes', async () => {
    render(<Popup />)

    const slider = await screen.findByLabelText(/^Rate/i)
    fireEvent.change(slider, { target: { value: '1.7' } })

    const chromeObj = getGlobal(['chrome']) as unknown as { storage: { sync: { set: { mock?: { calls?: unknown[][] } } } } }
    await waitFor(() => {
      const calls = (chromeObj.storage.sync.set.mock?.calls as unknown[][]) || []
      expect(calls.length).toBeGreaterThan(0)
      const payload = calls[calls.length - 1][0] as Record<string, unknown>
      expect(payload).toMatchObject({ rate: 1.7 })
    })

    expect(await screen.findByText(/Rate:\s*1\.70/)).toBeTruthy()
  })

  it('shows a useful error when no selection is available', async () => {
    const chromeObj = getGlobal(['chrome']) as unknown as { runtime: { sendMessage: ReturnType<typeof vi.fn> } }
    chromeObj.runtime.sendMessage.mockImplementation((message: Record<string, unknown>, callback?: (value: unknown) => void) => {
      if (message.kind === 'READ_SELECTION') callback?.({ ok: false, error: 'No selected text on the active page.' })
    })

    render(<Popup />)
    const user = userEvent.setup()
    const [readSelection] = await screen.findAllByRole('button', { name: /Read selected text/i })
    await user.click(readSelection)

    expect(await screen.findByText('No selected text on the active page.')).toBeTruthy()
  })

  it('shows a useful error when the tts url is missing', async () => {
    const chromeObj = getGlobal(['chrome']) as unknown as { runtime: { sendMessage: ReturnType<typeof vi.fn> } }
    chromeObj.runtime.sendMessage.mockImplementation((message: Record<string, unknown>, callback?: (value: unknown) => void) => {
      if (message.kind === 'READ_SELECTION') callback?.({ ok: false, error: 'No TTS service URL is configured.' })
    })

    render(<Popup />)
    const user = userEvent.setup()
    const [readSelection] = await screen.findAllByRole('button', { name: /Read selected text/i })
    await user.click(readSelection)

    expect(await screen.findByText('No TTS service URL is configured.')).toBeTruthy()
  })

  it('shows a useful error on unsupported pages', async () => {
    const chromeObj = getGlobal(['chrome']) as unknown as { runtime: { sendMessage: ReturnType<typeof vi.fn> } }
    chromeObj.runtime.sendMessage.mockImplementation((message: Record<string, unknown>, callback?: (value: unknown) => void) => {
      if (message.kind === 'READ_SELECTION') callback?.({ ok: false, error: 'Playback not supported on this page' })
    })

    render(<Popup />)
    const user = userEvent.setup()
    const [readSelection] = await screen.findAllByRole('button', { name: /Read selected text/i })
    await user.click(readSelection)

    expect(await screen.findByText('Playback not supported on this page')).toBeTruthy()
  })
})
