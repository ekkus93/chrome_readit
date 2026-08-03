import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PLAYBACK_CONTROL, PLAYBACK_STATUS } from './playback-protocol'
import {
  queryPlaybackStatus,
  requestReadSelection,
  requestReadText,
  sendPlaybackControl,
} from './playback-runtime-client'

function installSendMessage(implementation: (message: unknown) => Promise<unknown>) {
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { sendMessage: vi.fn(implementation) },
  }
  return (globalThis as unknown as {
    chrome: { runtime: { sendMessage: ReturnType<typeof vi.fn> } }
  }).chrome.runtime.sendMessage
}

describe('playback runtime client', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('sends explicit sources for supplied text', async () => {
    const sendMessage = installSendMessage(async () => ({
      ok: true,
      accepted: true,
      requestId: 'request-1',
      sessionId: 'session-1',
    }))

    await expect(requestReadText('Hello.', 'popup-test')).resolves.toMatchObject({ ok: true })
    expect(sendMessage).toHaveBeenCalledWith({
      kind: 'READ_TEXT',
      text: 'Hello.',
      source: 'popup-test',
    })
  })

  it('validates selection start responses', async () => {
    installSendMessage(async () => ({ ok: true }))
    await expect(requestReadSelection()).resolves.toMatchObject({
      ok: false,
      error: { code: 'OFFSCREEN_INTERRUPTED' },
    })
  })

  it('converts runtime transport failures to structured errors', async () => {
    installSendMessage(async () => { throw new Error('internal extension URL') })
    const result = await requestReadText('Hello.', 'options-test')
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'OFFSCREEN_INTERRUPTED' },
    })
    if (!result.ok) expect(result.error.message).not.toContain('internal extension URL')
  })

  it('sends expected-session controls and validates responses', async () => {
    const sendMessage = installSendMessage(async () => ({
      ok: true,
      sessionId: 'session-1',
      state: 'paused',
    }))
    await expect(sendPlaybackControl('pause', 'session-1')).resolves.toEqual({
      ok: true,
      sessionId: 'session-1',
      state: 'paused',
    })
    expect(sendMessage).toHaveBeenCalledWith({
      kind: PLAYBACK_CONTROL,
      action: 'pause',
      expectedSessionId: 'session-1',
    })

    installSendMessage(async () => ({ ok: false }))
    await expect(sendPlaybackControl('cancel')).resolves.toMatchObject({
      ok: false,
      error: { code: 'OFFSCREEN_INTERRUPTED' },
    })
  })

  it('validates status responses including monotonic sequence', async () => {
    const sendMessage = installSendMessage(async () => ({
      kind: PLAYBACK_STATUS,
      sequence: 0,
      state: 'idle',
      sessionId: null,
      requestId: null,
      source: null,
      currentChunk: 0,
      totalChunks: 0,
      currentParagraph: 0,
      totalParagraphs: 0,
    }))

    await expect(queryPlaybackStatus()).resolves.toMatchObject({
      ok: true,
      status: { state: 'idle', sequence: 0 },
    })
    expect(sendMessage).toHaveBeenCalledWith({ kind: PLAYBACK_STATUS })

    installSendMessage(async () => ({ kind: PLAYBACK_STATUS, state: 'idle' }))
    await expect(queryPlaybackStatus()).resolves.toMatchObject({
      ok: false,
      error: { code: 'OFFSCREEN_INTERRUPTED' },
    })
  })
})

it('accepts a valid selection start response', async () => {
  installSendMessage(async () => ({
    ok: true,
    accepted: true,
    requestId: 'selection-request',
    sessionId: 'selection-session',
  }))

  await expect(requestReadSelection()).resolves.toEqual({
    ok: true,
    accepted: true,
    requestId: 'selection-request',
    sessionId: 'selection-session',
  })
})

it('rejects an invalid text start response', async () => {
  installSendMessage(async () => ({ accepted: true, sessionId: 42 }))
  await expect(requestReadText('Hello.', 'popup-test')).resolves.toMatchObject({
    ok: false,
    error: { code: 'OFFSCREEN_INTERRUPTED' },
  })
})

it('converts control transport failure to a structured response', async () => {
  installSendMessage(async () => { throw new Error('receiver disappeared') })
  await expect(sendPlaybackControl('resume')).resolves.toMatchObject({
    ok: false,
    error: { code: 'OFFSCREEN_INTERRUPTED' },
  })
})

it('converts status transport failure to a structured response', async () => {
  installSendMessage(async () => { throw new Error('receiver disappeared') })
  await expect(queryPlaybackStatus()).resolves.toMatchObject({
    ok: false,
    error: { code: 'OFFSCREEN_INTERRUPTED' },
  })
})

it('omits expectedSessionId when no session guard is supplied', async () => {
  const sendMessage = installSendMessage(async () => ({
    ok: true,
    sessionId: 'session-1',
    state: 'cancelled',
  }))

  await sendPlaybackControl('cancel')
  expect(sendMessage).toHaveBeenCalledWith({ kind: PLAYBACK_CONTROL, action: 'cancel' })
})
