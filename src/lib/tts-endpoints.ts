export type TtsSiblingEndpoint = 'ping' | 'ready' | 'voices'

export function deriveTtsSiblingUrl(ttsUrl: string, sibling: TtsSiblingEndpoint): string | null {
  try {
    const url = new URL(ttsUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    const pathname = url.pathname.replace(/\/+$/, '')
    url.pathname = pathname.endsWith('/api/tts')
      ? `${pathname.slice(0, -'/tts'.length)}/${sibling}`
      : `${pathname}/${sibling}`
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

export function sanitizeEndpointForDisplay(value: string): string {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return 'the configured endpoint'
  }
}
