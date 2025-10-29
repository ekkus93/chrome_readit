export type Settings = {
  voice?: string
  rate: number // 0.5..2
  // Optional: URL to an opt-in TTS service (e.g., http://localhost:5002/api/tts)
  ttsUrl?: string
}

// Default TTS service URL — points at the local Coqui docker server included
// in this repository (docker/coqui-local). This makes the service the
// default target; users can still change or clear it in Options.
const DEFAULTS: Settings = { rate: 1.0, ttsUrl: 'http://localhost:5002/api/tts/play' }

export async function getSettings(): Promise<Settings> {
  const s = await chrome.storage.sync.get(['settings'])
  return { ...DEFAULTS, ...(s.settings ?? {}) }
}

export async function saveSettings(s: Partial<Settings>) {
  const current = await getSettings()
  await chrome.storage.sync.set({ settings: { ...current, ...s } })
}
