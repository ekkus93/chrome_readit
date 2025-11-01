export async function fetchVoicesForTtsUrl(ttsUrl: string): Promise<string[]> {
  try {
    const url = new URL(ttsUrl)
    url.pathname = '/api/voices'
    const res = await fetch(url.toString(), { method: 'GET' })
    if (!res.ok) return []
    const js = await res.json().catch(() => null)
    if (!js || !Array.isArray(js.voices)) return []
    return js.voices
  } catch (e) {
    void e
    return []
  }
}
