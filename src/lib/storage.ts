export type Settings = {
  voice: string
  rate: number // 0.5..10
  ttsUrl: string
}

export const DEFAULT_TTS_URL = 'http://localhost:5002/api/tts'
export const DEFAULT_SETTINGS: Settings = {
  voice: 'p225',
  rate: 1.0,
  ttsUrl: DEFAULT_TTS_URL,
}

export async function getSettings(): Promise<Settings> {
  const s = await chrome.storage.sync.get(['settings'])
  return { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) }
}

export async function saveSettings(s: Partial<Settings>): Promise<void> {
  const current = await getSettings()
  await chrome.storage.sync.set({ settings: { ...current, ...s } })
}
