/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import Options from './Options'

describe('Options playback control buttons', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
  ;(globalThis as unknown as { chrome?: unknown }).chrome = {
      storage: { sync: { get: vi.fn(() => Promise.resolve({ settings: { rate: 1.0, voice: '' } })), set: vi.fn(() => Promise.resolve()) } },
      runtime: { sendMessage: vi.fn() },
      tabs: { query: vi.fn(() => Promise.resolve([{ id: 1, url: 'https://example.com' }])), sendMessage: vi.fn() },
      commands: { onCommand: { addListener: vi.fn() } },
      contextMenus: { create: vi.fn(), onClicked: { addListener: vi.fn() } },
      runtimeOnMessage: { addListener: vi.fn() },
    }
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

    const runtimeSend = getGlobal(['chrome', 'runtime', 'sendMessage']) as unknown as { mock?: { calls?: unknown[][] } }
    const calls = (runtimeSend.mock?.calls as unknown[][]) || []
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.some((c) => (c[0] as Record<string, unknown>)?.action === 'pause-speech')).toBeTruthy()
    expect(calls.some((c) => (c[0] as Record<string, unknown>)?.action === 'resume-speech')).toBeTruthy()
    expect(calls.some((c) => (c[0] as Record<string, unknown>)?.action === 'cancel-speech')).toBeTruthy()
  })
})
