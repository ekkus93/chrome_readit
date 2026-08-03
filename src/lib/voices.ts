import { deriveTtsSiblingUrl } from './tts-endpoints'

export type VoiceOption = {
  name: string
  label: string
}

export type VoiceDiscoveryErrorCode =
  | 'INVALID_URL'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'INVALID_JSON'
  | 'INVALID_SCHEMA'

export type VoiceDiscoveryResult =
  | { ok: true; voices: VoiceOption[] }
  | { ok: false; error: { code: VoiceDiscoveryErrorCode; message: string; status?: number } }

export const DEFAULT_VOICE_DISCOVERY_TIMEOUT_MS = 5_000

export function deriveVoicesUrl(ttsUrl: string): string | null {
  return deriveTtsSiblingUrl(ttsUrl, 'voices')
}

function extractVoiceNames(payload: unknown): string[] | null {
  if (!payload || typeof payload !== 'object' || !('voices' in payload)) return null
  const voices = (payload as { voices?: unknown }).voices
  if (!Array.isArray(voices)) return null
  if (!voices.every((voice) => typeof voice === 'string')) return null
  return [...new Set(voices.map((voice) => voice.trim()).filter(Boolean))]
}

export async function fetchServerVoices(
  ttsUrl: string,
  timeoutMs = DEFAULT_VOICE_DISCOVERY_TIMEOUT_MS,
): Promise<VoiceDiscoveryResult> {
  const voicesUrl = deriveVoicesUrl(ttsUrl)
  if (!voicesUrl) {
    return { ok: false, error: { code: 'INVALID_URL', message: 'The configured TTS endpoint is invalid.' } }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), Math.max(1, timeoutMs))
  try {
    let response: Response
    try {
      response = await fetch(voicesUrl, { method: 'GET', signal: controller.signal })
    } catch {
      return controller.signal.aborted
        ? { ok: false, error: { code: 'TIMEOUT', message: 'Voice discovery timed out.' } }
        : { ok: false, error: { code: 'NETWORK_ERROR', message: 'The TTS voice endpoint could not be reached.' } }
    }

    if (!response.ok) {
      return {
        ok: false,
        error: {
          code: 'HTTP_ERROR',
          message: `The TTS voice endpoint returned HTTP ${response.status}.`,
          status: response.status,
        },
      }
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return { ok: false, error: { code: 'INVALID_JSON', message: 'The TTS voice endpoint returned invalid JSON.' } }
    }

    const names = extractVoiceNames(payload)
    if (names === null) {
      return { ok: false, error: { code: 'INVALID_SCHEMA', message: 'The TTS voice endpoint returned an invalid response shape.' } }
    }

    return {
      ok: true,
      voices: names.map((voice) => ({ name: voice, label: voice })),
    }
  } finally {
    clearTimeout(timeoutId)
  }
}
