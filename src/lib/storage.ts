import { clampPlaybackRate } from './playback-pacing'

export type Settings = {
  voice: string
  rate: number // 0.5..10
  ttsUrl: string
}

export type SettingsWarningCode = 'INVALID_VOICE' | 'INVALID_RATE' | 'INVALID_TTS_URL' | 'MIGRATED_TTS_URL'

export type SettingsWarning = {
  code: SettingsWarningCode
  message: string
}

export type SettingsLoadResult = {
  settings: Settings
  warnings: SettingsWarning[]
}

export const DEFAULT_TTS_URL = 'http://localhost:5002/api/tts'
export const DEFAULT_SETTINGS: Settings = {
  voice: 'p225',
  rate: 1.0,
  ttsUrl: DEFAULT_TTS_URL,
}

const SETTINGS_STORAGE_KEYS = ['settings', 'voice', 'rate', 'ttsUrl'] as const
const HOST_PLAY_PATH_SUFFIX = '/api/tts/play'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseTtsUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function pathWithoutTrailingSlashes(pathname: string): string {
  return pathname.replace(/\/+$/, '')
}

export function isValidTtsUrl(value: unknown): value is string {
  return typeof value === 'string' && parseTtsUrl(value.trim()) !== null
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

function selectedValue(stored: Record<string, unknown>, legacy: Record<string, unknown>, key: keyof Settings): unknown {
  return stored[key] !== undefined ? stored[key] : legacy[key]
}

function normalizeVoice(value: unknown, warnings: SettingsWarning[]): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value !== undefined) warnings.push({
    code: 'INVALID_VOICE',
    message: 'The stored voice was invalid and was reset to the default voice.',
  })
  return DEFAULT_SETTINGS.voice
}

function normalizeRate(value: unknown, warnings: SettingsWarning[]): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const clamped = clampPlaybackRate(value)
    if (clamped !== value) warnings.push({
      code: 'INVALID_RATE',
      message: 'The stored playback rate was outside the supported range and was clamped.',
    })
    return clamped
  }
  if (value !== undefined) warnings.push({
    code: 'INVALID_RATE',
    message: 'The stored playback rate was invalid and was reset to the default rate.',
  })
  return DEFAULT_SETTINGS.rate
}

function normalizeTtsUrl(value: unknown, warnings: SettingsWarning[]): string {
  if (typeof value !== 'string' || !isValidTtsUrl(value)) {
    if (value !== undefined) warnings.push({
      code: 'INVALID_TTS_URL',
      message: 'The stored TTS endpoint was invalid and was reset to the local default.',
    })
    return DEFAULT_SETTINGS.ttsUrl
  }

  const trimmed = value.trim()
  const migrated = migrateLegacyTtsUrl(trimmed)
  if (migrated !== trimmed) warnings.push({
    code: 'MIGRATED_TTS_URL',
    message: 'The obsolete host-play endpoint was migrated to the synthesis-only endpoint.',
  })
  return migrated
}

export async function getSettingsResult(): Promise<SettingsLoadResult> {
  const storedUnknown: unknown = await chrome.storage.sync.get(SETTINGS_STORAGE_KEYS)
  const stored = isRecord(storedUnknown) ? storedUnknown : {}
  const legacy = isRecord(stored.settings) ? stored.settings : {}
  const warnings: SettingsWarning[] = []

  const settings: Settings = {
    voice: normalizeVoice(selectedValue(stored, legacy, 'voice'), warnings),
    rate: normalizeRate(selectedValue(stored, legacy, 'rate'), warnings),
    ttsUrl: normalizeTtsUrl(selectedValue(stored, legacy, 'ttsUrl'), warnings),
  }

  const repairs: Partial<Settings> = {}
  if (selectedValue(stored, legacy, 'voice') !== undefined && selectedValue(stored, legacy, 'voice') !== settings.voice) repairs.voice = settings.voice
  if (selectedValue(stored, legacy, 'rate') !== undefined && selectedValue(stored, legacy, 'rate') !== settings.rate) repairs.rate = settings.rate
  if (selectedValue(stored, legacy, 'ttsUrl') !== undefined && selectedValue(stored, legacy, 'ttsUrl') !== settings.ttsUrl) repairs.ttsUrl = settings.ttsUrl
  if (Object.keys(repairs).length > 0) await chrome.storage.sync.set(repairs)

  return { settings, warnings }
}

export async function getSettings(): Promise<Settings> {
  return (await getSettingsResult()).settings
}

export async function saveSettings(s: Partial<Settings>): Promise<void> {
  const updates: Partial<Settings> = {}
  if (s.voice !== undefined) {
    if (typeof s.voice !== 'string' || !s.voice.trim()) throw new TypeError('Voice must be a non-empty string.')
    updates.voice = s.voice.trim()
  }
  if (s.rate !== undefined) {
    if (typeof s.rate !== 'number' || !Number.isFinite(s.rate)) throw new TypeError('Rate must be a finite number.')
    updates.rate = clampPlaybackRate(s.rate)
  }
  if (s.ttsUrl !== undefined) {
    if (!isValidTtsUrl(s.ttsUrl)) throw new TypeError('TTS URL must be a valid HTTP(S) URL.')
    updates.ttsUrl = migrateLegacyTtsUrl(s.ttsUrl.trim())
  }
  if (Object.keys(updates).length === 0) return
  await chrome.storage.sync.set(updates)
}
