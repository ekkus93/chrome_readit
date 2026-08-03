/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Options from './Options'

describe('Options playback control buttons', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    ;(globalThis as unknown as { chrome?: unknown }).chrome = {
      storage: {
        sync: {
          get: vi.fn(() => Promise.resolve({
            rate: 1,
            voice: '',
            ttsUrl: 'http://localhost:5002/api/tts',
          })),
          set: vi.fn(() => Promise.resolve()),
        },
      },
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true })),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    }
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

  it('sends pause/resume/stop messages when Options buttons are clicked', async () => {
    render(<Options />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /^Pause$/i }))
    await user.click(await screen.findByRole('button', { name: /^Resume$/i }))
    await user.click(await screen.findByRole('button', { name: /^Stop$/i }))

    const runtimeSend = getGlobal(['chrome', 'runtime', 'sendMessage']) as { mock?: { calls?: unknown[][] } }
    const calls = runtimeSend.mock?.calls ?? []
    expect(calls.some((call) => (call[0] as Record<string, unknown>)?.kind === 'PAUSE_SPEECH')).toBe(true)
    expect(calls.some((call) => (call[0] as Record<string, unknown>)?.kind === 'RESUME_SPEECH')).toBe(true)
    expect(calls.some((call) => (call[0] as Record<string, unknown>)?.kind === 'CANCEL_SPEECH')).toBe(true)
  })

  it('persists updated speech rate and reflects it in the UI', async () => {
    render(<Options />)
    fireEvent.change(await screen.findByLabelText(/Speech rate/i), { target: { value: '1.35' } })

    const chromeObject = getGlobal(['chrome']) as { storage: { sync: { set: { mock?: { calls?: unknown[][] } } } } }
    await waitFor(() => {
      const calls = chromeObject.storage.sync.set.mock?.calls ?? []
      expect(calls.length).toBeGreaterThan(0)
      expect(calls.at(-1)?.[0]).toMatchObject({ rate: 1.35 })
    })

    expect(await screen.findByText(/Speech rate:\s*1\.35/)).toBeTruthy()
  })
})
