import { describe, expect, it } from 'vitest'
import { deriveTtsSiblingUrl, sanitizeEndpointForDisplay } from './tts-endpoints'

describe('TTS endpoint helpers', () => {
  it.each([
    ['http://localhost:5002/api/tts', 'voices', 'http://localhost:5002/api/voices'],
    ['http://localhost:5002/api/tts/', 'ready', 'http://localhost:5002/api/ready'],
    ['https://example.com/prefix/api/tts?voice=p225#fragment', 'ping', 'https://example.com/prefix/api/ping'],
    ['https://example.com/custom/base', 'voices', 'https://example.com/custom/base/voices'],
    ['https://example.com/custom/base/', 'ready', 'https://example.com/custom/base/ready'],
  ] as const)('derives %s sibling %s', (input, sibling, expected) => {
    expect(deriveTtsSiblingUrl(input, sibling)).toBe(expected)
  })

  it.each([
    'not a URL',
    'file:///tmp/tts',
    'ftp://example.com/api/tts',
    'chrome-extension://abc/api/tts',
  ])('rejects unsupported endpoint %s', (input) => {
    expect(deriveTtsSiblingUrl(input, 'voices')).toBeNull()
  })

  it('removes credentials, query, and fragments from display values', () => {
    expect(sanitizeEndpointForDisplay('https://user:secret@example.com/api/tts?token=private#fragment'))
      .toBe('https://example.com/api/tts')
  })

  it('uses a generic label when endpoint parsing fails', () => {
    expect(sanitizeEndpointForDisplay('not a URL')).toBe('configured endpoint')
  })
})
