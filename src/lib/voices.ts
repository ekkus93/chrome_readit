export type VoiceOption = {
  name: string
  label: string
}

export function deriveVoicesUrl(ttsUrl: string): string | null {
  try {
    const url = new URL(ttsUrl)
    if (url.pathname.endsWith('/tts')) {
      url.pathname = `${url.pathname.slice(0, -'/tts'.length)}/voices`
      return url.toString()
    }
    url.pathname = new URL('voices', `${url.origin}${url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`}`).pathname
    return url.toString()
  } catch {
    return null
  }
}

function extractVoiceNames(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object' || !('voices' in payload)) return []
  const voices = (payload as { voices?: unknown }).voices
  if (!Array.isArray(voices)) return []
  return voices.filter((voice): voice is string => typeof voice === 'string' && voice.trim().length > 0)
}

export async function fetchServerVoices(ttsUrl: string): Promise<VoiceOption[]> {
  try {
    const voicesUrl = deriveVoicesUrl(ttsUrl)
    if (!voicesUrl) return []
    const res = await fetch(voicesUrl, { method: 'GET' })
    if (!res.ok) return []
    const payload: unknown = await res.json().catch(() => null)
    const uniqueVoices = [...new Set(extractVoiceNames(payload))]
    return uniqueVoices.map((voice) => ({ name: voice, label: voice }))
  } catch {
    return []
  }
}
