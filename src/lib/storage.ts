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

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(SETTINGS_STORAGE_KEYS)
  const legacySettings = (stored.settings as LegacySettingsShape) ?? {}

  return {
    ...DEFAULT_SETTINGS,
    ...legacySettings,
    ...(typeof stored.voice === 'string' ? { voice: stored.voice } : {}),
    ...(typeof stored.rate === 'number' ? { rate: stored.rate } : {}),
    ...(typeof stored.ttsUrl === 'string' ? { ttsUrl: stored.ttsUrl } : {}),
  }
}

export async function saveSettings(s: Partial<Settings>): Promise<void> {
  const updates: Partial<Settings> = {}
  if (typeof s.voice === 'string') updates.voice = s.voice
  if (typeof s.rate === 'number') updates.rate = s.rate
  if (typeof s.ttsUrl === 'string') updates.ttsUrl = s.ttsUrl
  if (Object.keys(updates).length === 0) return
  await chrome.storage.sync.set(updates)
}
