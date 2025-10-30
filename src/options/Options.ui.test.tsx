/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import Options from './Options'

describe('Options playback control buttons', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    ;(globalThis as unknown as { chrome?: any }).chrome = {
      storage: { sync: { get: vi.fn(() => Promise.resolve({ settings: { rate: 1.0, voice: '' } })), set: vi.fn(() => Promise.resolve()) } },
      runtime: { sendMessage: vi.fn() },
      tabs: { query: vi.fn(() => Promise.resolve([{ id: 1, url: 'https://example.com' }])), sendMessage: vi.fn() },
      commands: { onCommand: { addListener: vi.fn() } },
      contextMenus: { create: vi.fn(), onClicked: { addListener: vi.fn() } },
      runtimeOnMessage: { addListener: vi.fn() },
    }
  })

  it('sends pause/resume/stop messages when Options buttons are clicked', async () => {
    render(<Options />)
    const user = userEvent.setup()

    // Buttons labelled Pause / Resume / Stop are present
    const pause = await screen.findByRole('button', { name: /^Pause$/i })
    const resume = await screen.findByRole('button', { name: /^Resume$/i })
    const stop = await screen.findByRole('button', { name: /^Stop$/i })

    await user.click(pause)
    await user.click(resume)
    await user.click(stop)

    const send = (globalThis as any).chrome.runtime.sendMessage
    expect(send).toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith({ action: 'pause-speech' }, expect.any(Function))
    expect(send).toHaveBeenCalledWith({ action: 'resume-speech' }, expect.any(Function))
    expect(send).toHaveBeenCalledWith({ action: 'cancel-speech' }, expect.any(Function))
  })
})
