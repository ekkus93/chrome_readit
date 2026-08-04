import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}

describe('offscreen playback routing contract', () => {
  it('leaves document-originated playback requests to the service worker', () => {
    const source = read('src/offscreen.ts')

    expect(source).toContain('function isDocumentPlaybackRequest')
    expect(source).toContain("typeof sender.documentId !== 'string'")
    expect(source).toContain('isStartPlaybackRequest(message)')
    expect(source).toContain('isPlaybackControlRequest(message)')
    expect(source).toContain('isPlaybackStatusRequest(message)')
    expect(source).toContain('if (isDocumentPlaybackRequest(message, sender)) return false')
  })
})
