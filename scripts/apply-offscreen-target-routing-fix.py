from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
protocol_path = ROOT / "src/lib/playback-protocol.ts"
worker_path = ROOT / "src/background/service-worker.ts"
offscreen_path = ROOT / "src/offscreen.ts"
offscreen_test_path = ROOT / "src/offscreen.test.ts"
worker_test_path = ROOT / "src/background/service-worker.test.ts"
consolidated_path = ROOT / "src/fix2-consolidated-state.test.ts"

protocol = protocol_path.read_text(encoding="utf-8")
old_constants = """export const PLAYBACK_EVENT = 'PLAYBACK_EVENT' as const
"""
new_constants = """export const PLAYBACK_EVENT = 'PLAYBACK_EVENT' as const
export const OFFSCREEN_PLAYBACK_TARGET = 'OFFSCREEN_PLAYBACK' as const
"""
if protocol.count(old_constants) != 1:
    raise SystemExit("Protocol constants anchor did not match exactly once")
protocol = protocol.replace(old_constants, new_constants)
protocol_path.write_text(protocol, encoding="utf-8")

worker = worker_path.read_text(encoding="utf-8")
old_import = """  PLAYBACK_CONTROL,
  PLAYBACK_STATUS,
  START_PLAYBACK,
"""
new_import = """  OFFSCREEN_PLAYBACK_TARGET,
  PLAYBACK_CONTROL,
  PLAYBACK_STATUS,
  START_PLAYBACK,
"""
if worker.count(old_import) != 1:
    raise SystemExit("Service-worker import anchor did not match exactly once")
worker = worker.replace(old_import, new_import)
old_record = """function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
"""
new_record = """function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function targetOffscreenMessage(message: unknown): unknown {
  return isRecord(message)
    ? { ...message, target: OFFSCREEN_PLAYBACK_TARGET }
    : message
}
"""
if worker.count(old_record) != 1:
    raise SystemExit("Service-worker record helper anchor did not match exactly once")
worker = worker.replace(old_record, new_record)
old_ready = """      const response = await chrome.runtime.sendMessage({ kind: PLAYBACK_STATUS })
"""
new_ready = """      const response = await chrome.runtime.sendMessage(targetOffscreenMessage({ kind: PLAYBACK_STATUS }))
"""
if worker.count(old_ready) != 1:
    raise SystemExit("Offscreen readiness send did not match exactly once")
worker = worker.replace(old_ready, new_ready)
old_send = """  return await chrome.runtime.sendMessage(message)
"""
new_send = """  return await chrome.runtime.sendMessage(targetOffscreenMessage(message))
"""
if worker.count(old_send) != 1:
    raise SystemExit("Offscreen transport send did not match exactly once")
worker = worker.replace(old_send, new_send)
worker_path.write_text(worker, encoding="utf-8")

offscreen = offscreen_path.read_text(encoding="utf-8")
old_offscreen_import = """  createPlaybackError,
  isPlaybackControlRequest,
"""
new_offscreen_import = """  OFFSCREEN_PLAYBACK_TARGET,
  createPlaybackError,
  isPlaybackControlRequest,
"""
if offscreen.count(old_offscreen_import) != 1:
    raise SystemExit("Offscreen import anchor did not match exactly once")
offscreen = offscreen.replace(old_offscreen_import, new_offscreen_import)
old_listener = """  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (isStartPlaybackRequest(message)) {
"""
new_listener = """  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isRecord(message) || message.target !== OFFSCREEN_PLAYBACK_TARGET) return false

    if (isStartPlaybackRequest(message)) {
"""
if offscreen.count(old_listener) != 1:
    raise SystemExit("Offscreen listener anchor did not match exactly once")
offscreen = offscreen.replace(old_listener, new_listener)
offscreen_path.write_text(offscreen, encoding="utf-8")

offscreen_test = offscreen_test_path.read_text(encoding="utf-8")
offscreen_test = offscreen_test.replace(
    "import { PLAYBACK_STATUS } from './lib/playback-protocol'",
    "import { OFFSCREEN_PLAYBACK_TARGET, PLAYBACK_STATUS } from './lib/playback-protocol'",
)
helper_anchor = """let chromeMock: ChromeMock

describe('offscreen message routing', () => {
"""
helper_replacement = """let chromeMock: ChromeMock

function target<T extends Record<string, unknown>>(message: T): T & { target: typeof OFFSCREEN_PLAYBACK_TARGET } {
  return { ...message, target: OFFSCREEN_PLAYBACK_TARGET }
}

describe('offscreen message routing', () => {
"""
if offscreen_test.count(helper_anchor) != 1:
    raise SystemExit("Offscreen test helper anchor did not match exactly once")
offscreen_test = offscreen_test.replace(helper_anchor, helper_replacement)
replacements = {
    "listener({ kind: PLAYBACK_STATUS }, null, sendResponse)": "listener(target({ kind: PLAYBACK_STATUS }), null, sendResponse)",
    "listener(startRequest(), null, startResponse)": "listener(target(startRequest()), null, startResponse)",
    "listener({ kind: 'PLAYBACK_CONTROL', action: 'pause', expectedSessionId: 'session-1' }, null, controlResponse)": "listener(target({ kind: 'PLAYBACK_CONTROL', action: 'pause', expectedSessionId: 'session-1' }), null, controlResponse)",
    "listener({ kind: 'PLAYBACK_CONTROL', action: 'cancel' }, null, controlResponse)": "listener(target({ kind: 'PLAYBACK_CONTROL', action: 'cancel' }), null, controlResponse)",
    "listener({ kind: 'PLAYBACK_DIAGNOSTICS_OFFSCREEN' }, null, sendResponse)": "listener(target({ kind: 'PLAYBACK_DIAGNOSTICS_OFFSCREEN' }), null, sendResponse)",
    "listener({ kind: 'START_PLAYBACK', requestId: 4 }, null, vi.fn())": "listener(target({ kind: 'START_PLAYBACK', requestId: 4 }), null, vi.fn())",
    "listener({ kind: 'PLAYBACK_CONTROL', action: 'explode' }, null, vi.fn())": "listener(target({ kind: 'PLAYBACK_CONTROL', action: 'explode' }), null, vi.fn())",
    "listener({ kind: PLAYBACK_STATUS, unexpected: true }, null, vi.fn())": "listener(target({ kind: PLAYBACK_STATUS, unexpected: true }), null, vi.fn())",
}
for old, new in replacements.items():
    if old not in offscreen_test:
        raise SystemExit(f"Offscreen test call missing: {old}")
    offscreen_test = offscreen_test.replace(old, new)
old_unrelated = """  it('does not claim unrelated runtime messages', async () => {
    await import('./offscreen')
    const listener = chromeMock.runtime.onMessage.addListener.mock.calls[0]?.[0] as Listener

    expect(listener({ kind: 'UNRELATED' }, null, vi.fn())).toBe(false)
  })
"""
new_unrelated = """  it('does not claim unrelated runtime messages', async () => {
    await import('./offscreen')
    const listener = chromeMock.runtime.onMessage.addListener.mock.calls[0]?.[0] as Listener

    expect(listener({ kind: 'UNRELATED' }, null, vi.fn())).toBe(false)
  })

  it('does not claim valid playback messages that were not targeted by the service worker', async () => {
    await import('./offscreen')
    const listener = chromeMock.runtime.onMessage.addListener.mock.calls[0]?.[0] as Listener

    expect(listener({ kind: PLAYBACK_STATUS }, null, vi.fn())).toBe(false)
    expect(listener(startRequest(), null, vi.fn())).toBe(false)
    expect(listener({ kind: 'PLAYBACK_CONTROL', action: 'pause' }, null, vi.fn())).toBe(false)
  })
"""
if offscreen_test.count(old_unrelated) != 1:
    raise SystemExit("Offscreen untargeted-test anchor did not match exactly once")
offscreen_test = offscreen_test.replace(old_unrelated, new_unrelated)
offscreen_test_path.write_text(offscreen_test, encoding="utf-8")

worker_test = worker_test_path.read_text(encoding="utf-8")
old_worker_import = """import { PLAYBACK_CONTROL, PLAYBACK_STATUS, START_PLAYBACK, type PlaybackStatus } from '../lib/playback-protocol'
"""
new_worker_import = """import { OFFSCREEN_PLAYBACK_TARGET, PLAYBACK_CONTROL, PLAYBACK_STATUS, START_PLAYBACK, type PlaybackStatus } from '../lib/playback-protocol'
"""
if worker_test.count(old_worker_import) != 1:
    raise SystemExit("Service-worker test import did not match exactly once")
worker_test = worker_test.replace(old_worker_import, new_worker_import)
old_exact = """    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      kind: START_PLAYBACK,
"""
new_exact = """    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      target: OFFSCREEN_PLAYBACK_TARGET,
      kind: START_PLAYBACK,
"""
if worker_test.count(old_exact) != 1:
    raise SystemExit("Service-worker exact start expectation did not match exactly once")
worker_test = worker_test.replace(old_exact, new_exact)
worker_test_path.write_text(worker_test, encoding="utf-8")

consolidated = consolidated_path.read_text(encoding="utf-8")
anchor = """    expect(worker).toContain('await ensureOffscreenPlaybackDocument()')
"""
replacement = """    expect(worker).toContain('await ensureOffscreenPlaybackDocument()')
    expect(worker).toContain('target: OFFSCREEN_PLAYBACK_TARGET')
    expect(offscreen).toContain('message.target !== OFFSCREEN_PLAYBACK_TARGET')
"""
if consolidated.count(anchor) != 1:
    raise SystemExit("Consolidated routing contract anchor did not match exactly once")
consolidated = consolidated.replace(anchor, replacement)
consolidated_path.write_text(consolidated, encoding="utf-8")

Path(__file__).unlink()
