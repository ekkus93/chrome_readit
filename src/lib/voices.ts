export type VoiceOption = {
  name: string
  label: string
}

export async function fetchServerVoices(ttsUrl: string): Promise<VoiceOption[]> {
  try {
    const url = new URL(ttsUrl)
    url.pathname = '/api/voices'
    const res = await fetch(url.toString(), { method: 'GET' })
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
