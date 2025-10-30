import { describe, it, expect } from 'vitest'
import { decodeBase64ToUint8Array, prefixHexFromU8 } from './player'

describe('content/player helpers', () => {
  it('decodes base64 to expected bytes', () => {
    // 0x01 0x02 0x03
    const b64 = 'AQID'
    const u8 = decodeBase64ToUint8Array(b64)
    expect(u8).toBeInstanceOf(Uint8Array)
    expect(Array.from(u8)).toEqual([1, 2, 3])
  })

  it('prefixHexFromU8 formats bytes', () => {
    const u8 = new Uint8Array([0x01, 0x02, 0xff, 0x0a])
    const p = prefixHexFromU8(u8, 3)
    expect(p).toBe('01 02 ff')
  })

  it('prefixHexFromU8 handles null/undefined', () => {
    expect(prefixHexFromU8(null)).toBe('<empty>')
    expect(prefixHexFromU8(undefined)).toBe('<empty>')
  })
})
