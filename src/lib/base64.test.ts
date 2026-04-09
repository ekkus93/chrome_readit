import { describe, expect, it } from 'vitest'

import { encodeArrayBufferToBase64 } from './base64'

describe('encodeArrayBufferToBase64', () => {
  it('encodes small buffers', () => {
    expect(encodeArrayBufferToBase64(new Uint8Array([97, 98, 99]).buffer)).toBe(btoa('abc'))
  })

  it('encodes large buffers in chunks', () => {
    const bytes = new Uint8Array(100_000)
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 251

    const encoded = encodeArrayBufferToBase64(bytes.buffer)
    expect(atob(encoded).length).toBe(bytes.length)
  })
})
