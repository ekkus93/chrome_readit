import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as storage from './storage'

describe('storage.getSettings / saveSettings', () => {
  const DEFAULTS = { rate: 1.0, ttsUrl: 'http://localhost:5002/api/tts', voice: 'p225' }

  beforeEach(() => {
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
    const s = await storage.getSettings()
    expect(s).toEqual(DEFAULTS)
    expect(storage.DEFAULT_TTS_URL).toBe('http://localhost:5002/api/tts')
    expect(storage.DEFAULT_SETTINGS.ttsUrl).toBe('http://localhost:5002/api/tts')
  })

  it('merges legacy stored settings with defaults', async () => {
    ;(globalThis as unknown as { chrome: { storage: { sync: { get: (...a: unknown[]) => unknown } } } }).chrome.storage.sync.get = vi.fn(() => Promise.resolve({ settings: { rate: 1.5, voice: 'Alice' } }))
    const s = await storage.getSettings()
    expect(s).toEqual({ rate: 1.5, voice: 'Alice', ttsUrl: 'http://localhost:5002/api/tts' })
  })

  it('prefers per-setting keys over legacy settings values', async () => {
    ;(globalThis as unknown as { chrome: { storage: { sync: { get: (...a: unknown[]) => unknown } } } }).chrome.storage.sync.get = vi.fn(() => Promise.resolve({
      settings: { rate: 1.1, voice: 'Legacy', ttsUrl: 'http://legacy.example/api/tts' },
      rate: 1.7,
      voice: 'Fresh',
    }))

    await expect(storage.getSettings()).resolves.toEqual({
      rate: 1.7,
      voice: 'Fresh',
      ttsUrl: 'http://legacy.example/api/tts',
    })
  })

  it.each([
    ['http://localhost:5002/api/tts/play', 'http://localhost:5002/api/tts'],
    ['http://localhost:5002/api/tts/play/', 'http://localhost:5002/api/tts'],
    ['https://example.com/local/tts/api/tts/play?voice=p225', 'https://example.com/local/tts/api/tts?voice=p225'],
  ])('migrates a legacy host-play URL once: %s', async (legacyUrl, expectedUrl) => {
    const setMock = vi.fn(() => Promise.resolve())
    ;(globalThis as unknown as { chrome: { storage: { sync: { get: (...a: unknown[]) => unknown; set: (...a: unknown[]) => unknown } } } }).chrome.storage.sync.get = vi.fn(() => Promise.resolve({ ttsUrl: legacyUrl }))
    ;(globalThis as unknown as { chrome: { storage: { sync: { set: (...a: unknown[]) => unknown } } } }).chrome.storage.sync.set = setMock

    await expect(storage.getSettings()).resolves.toMatchObject({ ttsUrl: expectedUrl })
    expect(setMock).toHaveBeenCalledTimes(1)
    expect(setMock).toHaveBeenCalledWith({ ttsUrl: expectedUrl })
  })

  it('leaves malformed URLs unchanged so validation can report them', () => {
    expect(storage.migrateLegacyTtsUrl('not a url')).toBe('not a url')
    expect(storage.isHostPlayTtsUrl('not a url')).toBe(false)
  })

  it('identifies host-play endpoints without matching the normal endpoint', () => {
    expect(storage.isHostPlayTtsUrl('http://localhost:5002/api/tts/play?x=1')).toBe(true)
    expect(storage.isHostPlayTtsUrl('http://localhost:5002/api/tts')).toBe(false)
  })

  it('saveSettings writes only the changed keys', async () => {
    const setMock = vi.fn(() => Promise.resolve())
    ;(globalThis as unknown as { chrome: { storage: { sync: { set: (...a: unknown[]) => unknown } } } }).chrome.storage.sync.set = setMock

    await storage.saveSettings({ voice: 'Bob' })

    expect(setMock).toHaveBeenCalledWith({ voice: 'Bob' })
  })

  it('saveSettings repairs a legacy URL before persisting it', async () => {
    const setMock = vi.fn(() => Promise.resolve())
    ;(globalThis as unknown as { chrome: { storage: { sync: { set: (...a: unknown[]) => unknown } } } }).chrome.storage.sync.set = setMock

    await storage.saveSettings({ ttsUrl: 'http://localhost:5002/api/tts/play' })

    expect(setMock).toHaveBeenCalledWith({ ttsUrl: 'http://localhost:5002/api/tts' })
  })

  it('concurrent partial saves do not overwrite one another', async () => {
    const persisted: Record<string, unknown> = {}
    const setMock = vi.fn(async (update: Record<string, unknown>) => {
      Object.assign(persisted, update)
    })
    const getMock = vi.fn(async () => persisted)
    ;(globalThis as unknown as { chrome: { storage: { sync: { get: (...a: unknown[]) => unknown; set: (...a: unknown[]) => unknown } } } }).chrome.storage.sync.get = getMock
    ;(globalThis as unknown as { chrome: { storage: { sync: { set: (...a: unknown[]) => unknown } } } }).chrome.storage.sync.set = setMock

    await Promise.all([
      storage.saveSettings({ voice: 'Alice' }),
      storage.saveSettings({ rate: 1.4 }),
      storage.saveSettings({ ttsUrl: 'https://example.com/tts/api/tts' }),
    ])

    await expect(storage.getSettings()).resolves.toEqual({
      rate: 1.4,
      voice: 'Alice',
      ttsUrl: 'https://example.com/tts/api/tts',
    })
    expect(setMock).toHaveBeenCalledTimes(3)
  })
})
