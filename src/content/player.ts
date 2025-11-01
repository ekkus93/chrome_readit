// Small, testable helpers for content script playback logic.
// Keep these pure and minimal so they can be unit tested easily.

export function decodeBase64ToUint8Array(b64: string): Uint8Array {
  // atob throws on invalid input; callers may catch.
  const bin = atob(b64)
  const len = bin.length
  const u8 = new Uint8Array(len)
  for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i)
  return u8
}

export function prefixHexFromU8(u8: Uint8Array | null | undefined, len = 32): string {
  if (!u8) return '<empty>'
  try {
    const slice = u8.subarray(0, Math.min(len, u8.length))
    return Array.from(slice).map((b) => b.toString(16).padStart(2, '0')).join(' ')
  } catch {
    return '<err>'
  }
}
