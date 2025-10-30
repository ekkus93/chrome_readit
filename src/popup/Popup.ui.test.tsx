/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
    // speechSynthesis used by Popup; provide minimal API
    ;(globalThis as unknown as Record<string, unknown>).speechSynthesis = { getVoices: () => [], onvoiceschanged: null, addEventListener: () => {}, removeEventListener: () => {} }
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
    expect(calls.some((c) => (c[0] as Record<string, unknown>)?.action === 'pause-speech')).toBeTruthy()
    expect(calls.some((c) => (c[0] as Record<string, unknown>)?.action === 'resume-speech')).toBeTruthy()
    expect(calls.some((c) => (c[0] as Record<string, unknown>)?.action === 'cancel-speech')).toBeTruthy()
  })
})
