import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as storage from './storage'

describe('storage.getSettings / saveSettings', () => {
  const DEFAULTS = { rate: 1.0 }

  beforeEach(() => {
    // Reset global chrome mock
        // Provide a minimal mock for chrome.storage.sync. Use `any` here so
        // TypeScript doesn't enforce the full SyncStorageArea shape in tests.
        // Provide a minimal mock and attach to globalThis using `any` so the
        // TypeScript declared `chrome` module/type isn't enforced here.
        ;(globalThis as any).chrome = {
          storage: {
            sync: {
              get: (() => Promise.resolve({})) as any,
              set: (() => Promise.resolve()) as any,
            },
          },
        }
  })

  it('returns defaults when storage empty', async () => {
  // Replace get with a mock that resolves the desired value
  // @ts-ignore
  ;(globalThis as any).chrome.storage.sync.get = vi.fn(() => Promise.resolve({}))
    const s = await storage.getSettings()
    expect(s).toEqual(DEFAULTS)
  })

  it('merges stored settings with defaults', async () => {
  // @ts-ignore
  ;(globalThis as any).chrome.storage.sync.get = vi.fn(() => Promise.resolve({ settings: { rate: 1.5, voice: 'Alice' } }))
    const s = await storage.getSettings()
    expect(s).toEqual({ rate: 1.5, voice: 'Alice' })
  })

  it('saveSettings merges and calls storage.set', async () => {
    // initial stored settings
  // @ts-ignore
  ;(globalThis as any).chrome.storage.sync.get = vi.fn(() => Promise.resolve({ settings: { rate: 1.2 } }))

  const setMock = vi.fn(() => Promise.resolve())
  // @ts-ignore
  ;(globalThis as any).chrome.storage.sync.set = setMock

  await storage.saveSettings({ voice: 'Bob' })

  expect(setMock).toHaveBeenCalledWith({ settings: { rate: 1.2, voice: 'Bob' } })
  })
})
