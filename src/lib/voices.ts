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

export async function fetchServerVoices(ttsUrl: string): Promise<VoiceOption[]> {
  try {
    const voicesUrl = deriveVoicesUrl(ttsUrl)
    if (!voicesUrl) return []
    const res = await fetch(voicesUrl, { method: 'GET' })
    if (!res.ok) return []
    const js = await res.json().catch(() => null)
    if (!js || !Array.isArray(js.voices)) return []

    const uniqueVoices = [...new Set(js.voices.filter((voice): voice is string => typeof voice === 'string' && voice.trim().length > 0))]
    return uniqueVoices.map((voice) => ({ name: voice, label: voice }))
  } catch (e) {
    void e
    return []
  }
}
