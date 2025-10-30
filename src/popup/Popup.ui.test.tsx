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
    ;(globalThis as unknown as { chrome?: any }).chrome = {
      runtime: { sendMessage: vi.fn() },
      storage: { sync: { get: vi.fn(() => Promise.resolve({ settings: { rate: 1.0, voice: '' } })), set: vi.fn(() => Promise.resolve()) } },
    }
    // speechSynthesis used by Popup; provide minimal API
    ;(globalThis as any).speechSynthesis = { getVoices: () => [], onvoiceschanged: null, addEventListener: () => {}, removeEventListener: () => {} }
  })

  it('sends pause/resume/cancel messages when buttons are clicked', async () => {
    render(<Popup />)
    const user = userEvent.setup()

    const pause = await screen.findByRole('button', { name: /^Pause$/i })
    const resume = await screen.findByRole('button', { name: /^Resume$/i })
    const cancel = await screen.findByRole('button', { name: /^Cancel$/i })

    await user.click(pause)
    await user.click(resume)
    await user.click(cancel)

    const send = (globalThis as any).chrome.runtime.sendMessage
    expect(send).toHaveBeenCalled()
    // check calls include our action objects
    expect(send).toHaveBeenCalledWith({ action: 'pause-speech' }, expect.any(Function))
    expect(send).toHaveBeenCalledWith({ action: 'resume-speech' }, expect.any(Function))
    expect(send).toHaveBeenCalledWith({ action: 'cancel-speech' }, expect.any(Function))
  })
})
