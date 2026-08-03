import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as storage from './storage'

type SyncMock = {
  get: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
}

function syncMock(): SyncMock {
  return (globalThis as unknown as { chrome: { storage: { sync: SyncMock } } }).chrome.storage.sync
}

function setStored(values: Record<string, unknown>) {
  syncMock().get.mockResolvedValue(values)
}

describe('storage.getSettings / saveSettings', () => {
  const DEFAULTS = { rate: 1.0, ttsUrl: 'http://localhost:5002/api/tts', voice: 'p225' }

  beforeEach(() => {
    ;(globalThis as unknown as { chrome?: unknown }).chrome = {
      storage: {
        sync: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
    }
  })

  it('returns defaults without warnings when storage is empty', async () => {
    await expect(storage.getSettingsResult()).resolves.toEqual({ settings: DEFAULTS, warnings: [] })
    await expect(storage.getSettings()).resolves.toEqual(DEFAULTS)
    expect(syncMock().set).not.toHaveBeenCalled()
  })

  it('merges legacy stored settings and prefers per-setting keys', async () => {
    setStored({
      settings: { rate: 1.1, voice: 'Legacy', ttsUrl: 'http://legacy.example/api/tts' },
      rate: 1.7,
      voice: ' Fresh ',
    })

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
    setStored({ ttsUrl: legacyUrl })

    const result = await storage.getSettingsResult()

    expect(result.settings.ttsUrl).toBe(expectedUrl)
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'MIGRATED_TTS_URL' }))
    expect(syncMock().set).toHaveBeenCalledWith({ ttsUrl: expectedUrl })
  })

  it.each([
    [{ voice: '' }, 'INVALID_VOICE', { voice: 'p225' }],
    [{ voice: [] }, 'INVALID_VOICE', { voice: 'p225' }],
    [{ voice: {} }, 'INVALID_VOICE', { voice: 'p225' }],
    [{ rate: 'fast' }, 'INVALID_RATE', { rate: 1 }],
    [{ rate: Number.NaN }, 'INVALID_RATE', { rate: 1 }],
    [{ rate: Number.POSITIVE_INFINITY }, 'INVALID_RATE', { rate: 1 }],
    [{ rate: -1 }, 'INVALID_RATE', { rate: 0.5 }],
    [{ rate: 99 }, 'INVALID_RATE', { rate: 10 }],
    [{ ttsUrl: 'not a url' }, 'INVALID_TTS_URL', { ttsUrl: storage.DEFAULT_TTS_URL }],
    [{ ttsUrl: 'file:///tmp/tts' }, 'INVALID_TTS_URL', { ttsUrl: storage.DEFAULT_TTS_URL }],
    [{ ttsUrl: [] }, 'INVALID_TTS_URL', { ttsUrl: storage.DEFAULT_TTS_URL }],
  ])('repairs untrusted stored value %#', async (stored, warningCode, expected) => {
    setStored(stored as Record<string, unknown>)

    const result = await storage.getSettingsResult()

    expect(result.settings).toMatchObject(expected)
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: warningCode }))
    expect(syncMock().set).toHaveBeenCalledWith(expect.objectContaining(expected))
  })

  it('identifies valid synthesis and obsolete host-play endpoints', () => {
    expect(storage.isValidTtsUrl('http://localhost:5002/api/tts')).toBe(true)
    expect(storage.isValidTtsUrl('https://example.com/api/tts')).toBe(true)
    expect(storage.isValidTtsUrl('file:///tmp/tts')).toBe(false)
    expect(storage.isHostPlayTtsUrl('http://localhost:5002/api/tts/play?x=1')).toBe(true)
    expect(storage.isHostPlayTtsUrl('http://localhost:5002/api/tts')).toBe(false)
  })

  it('saveSettings validates, trims, clamps, and migrates before writing', async () => {
    await storage.saveSettings({
      voice: ' Alice ',
      rate: 99,
      ttsUrl: 'http://localhost:5002/api/tts/play',
    })

    expect(syncMock().set).toHaveBeenCalledWith({
      voice: 'Alice',
      rate: 10,
      ttsUrl: 'http://localhost:5002/api/tts',
    })
  })

  it.each([
    [{ voice: '' }, 'Voice'],
    [{ rate: Number.NaN }, 'Rate'],
    [{ rate: Number.POSITIVE_INFINITY }, 'Rate'],
    [{ ttsUrl: 'invalid' }, 'TTS URL'],
    [{ ttsUrl: 'ftp://example.com/tts' }, 'TTS URL'],
  ])('rejects invalid save input %#', async (update, message) => {
    await expect(storage.saveSettings(update)).rejects.toThrow(message)
    expect(syncMock().set).not.toHaveBeenCalled()
  })

  it('concurrent partial saves do not overwrite one another', async () => {
    const persisted: Record<string, unknown> = {}
    syncMock().set.mockImplementation(async (update: Record<string, unknown>) => {
      Object.assign(persisted, update)
    })
    syncMock().get.mockImplementation(async () => persisted)

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
    expect(syncMock().set).toHaveBeenCalledTimes(3)
  })

  it('propagates storage write failure so the UI can retain dirty state', async () => {
    syncMock().set.mockRejectedValue(new Error('quota exceeded'))
    await expect(storage.saveSettings({ voice: 'Alice' })).rejects.toThrow('quota exceeded')
  })
})
