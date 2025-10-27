export type Settings = {
  voice?: string
  rate: number // 0.5..2
}

const DEFAULTS: Settings = { rate: 1.0 }

export async function getSettings(): Promise<Settings> {
  const s = await chrome.storage.sync.get(['settings'])
  return { ...DEFAULTS, ...(s.settings ?? {}) }
}

export async function saveSettings(s: Partial<Settings>) {
  const current = await getSettings()
  await chrome.storage.sync.set({ settings: { ...current, ...s } })
}
