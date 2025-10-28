import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as storage from './storage'

describe('storage.getSettings / saveSettings', () => {
  const DEFAULTS = { rate: 1.0, ttsUrl: 'http://localhost:5002/api/tts' }

  beforeEach(() => {
    // Reset global chrome mock
    // Provide a minimal mock for chrome.storage.sync. Use typed mocks to
    // avoid `any` while keeping tests simple.
    type SyncMock = { get: (...a: unknown[]) => Promise<unknown>; set: (...a: unknown[]) => Promise<unknown> }
    ;(globalThis as unknown as { chrome?: { storage?: { sync?: SyncMock } } }).chrome = {
      storage: {
        sync: {
          get: vi.fn(() => Promise.resolve({})),
          set: vi.fn(() => Promise.resolve()),
        },
      },
    }
  })

  it('returns defaults when storage empty', async () => {
    // Replace get with a mock that resolves the desired value
    ;(globalThis as unknown as { chrome: { storage: { sync: { get: (...a: unknown[]) => unknown } } } }).chrome.storage.sync.get = vi.fn(() => Promise.resolve({}))
  const s = await storage.getSettings()
  expect(s).toEqual(DEFAULTS)
  })

  it('merges stored settings with defaults', async () => {
    ;(globalThis as unknown as { chrome: { storage: { sync: { get: (...a: unknown[]) => unknown } } } }).chrome.storage.sync.get = vi.fn(() => Promise.resolve({ settings: { rate: 1.5, voice: 'Alice' } }))
  const s = await storage.getSettings()
  expect(s).toEqual({ rate: 1.5, voice: 'Alice', ttsUrl: 'http://localhost:5002/api/tts' })
  })

  it('saveSettings merges and calls storage.set', async () => {
    // initial stored settings
    ;(globalThis as unknown as { chrome: { storage: { sync: { get: (...a: unknown[]) => unknown } } } }).chrome.storage.sync.get = vi.fn(() => Promise.resolve({ settings: { rate: 1.2 } }))

    const setMock = vi.fn(() => Promise.resolve())
    ;(globalThis as unknown as { chrome: { storage: { sync: { set: (...a: unknown[]) => unknown } } } }).chrome.storage.sync.set = setMock

    await storage.saveSettings({ voice: 'Bob' })

  expect(setMock).toHaveBeenCalledWith({ settings: { rate: 1.2, ttsUrl: 'http://localhost:5002/api/tts', voice: 'Bob' } })
  })
})
