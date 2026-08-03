export type Settings = {
  voice: string
  rate: number // 0.5..10
  ttsUrl: string
}

type LegacySettingsShape = Partial<Settings> | null | undefined

export const DEFAULT_TTS_URL = 'http://localhost:5002/api/tts'
export const DEFAULT_SETTINGS: Settings = {
  voice: 'p225',
  rate: 1.0,
  ttsUrl: DEFAULT_TTS_URL,
}

const SETTINGS_STORAGE_KEYS = ['settings', 'voice', 'rate', 'ttsUrl'] as const
const HOST_PLAY_PATH_SUFFIX = '/api/tts/play'

function parseTtsUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function pathWithoutTrailingSlashes(pathname: string): string {
  return pathname.replace(/\/+$/, '')
}

export function isHostPlayTtsUrl(value: string): boolean {
  const url = parseTtsUrl(value)
  return url !== null && pathWithoutTrailingSlashes(url.pathname).endsWith(HOST_PLAY_PATH_SUFFIX)
}

export function migrateLegacyTtsUrl(value: string): string {
  const url = parseTtsUrl(value)
  if (!url) return value

  const pathname = pathWithoutTrailingSlashes(url.pathname)
  if (!pathname.endsWith(HOST_PLAY_PATH_SUFFIX)) return value

  url.pathname = pathname.slice(0, -'/play'.length)
  return url.toString()
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(SETTINGS_STORAGE_KEYS)
  const legacySettings = (stored.settings as LegacySettingsShape) ?? {}
  const merged: Settings = {
    ...DEFAULT_SETTINGS,
    ...legacySettings,
    ...(typeof stored.voice === 'string' ? { voice: stored.voice } : {}),
    ...(typeof stored.rate === 'number' ? { rate: stored.rate } : {}),
    ...(typeof stored.ttsUrl === 'string' ? { ttsUrl: stored.ttsUrl } : {}),
  }

  const migratedTtsUrl = migrateLegacyTtsUrl(merged.ttsUrl)
  if (migratedTtsUrl !== merged.ttsUrl) {
    await chrome.storage.sync.set({ ttsUrl: migratedTtsUrl })
    merged.ttsUrl = migratedTtsUrl
  }

  return merged
}

export async function saveSettings(s: Partial<Settings>): Promise<void> {
  const updates: Partial<Settings> = {}
  if (typeof s.voice === 'string') updates.voice = s.voice
  if (typeof s.rate === 'number') updates.rate = s.rate
  if (typeof s.ttsUrl === 'string') updates.ttsUrl = migrateLegacyTtsUrl(s.ttsUrl)
  if (Object.keys(updates).length === 0) return
  await chrome.storage.sync.set(updates)
}
