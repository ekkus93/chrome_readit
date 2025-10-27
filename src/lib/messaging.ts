export type Msg =
  | { kind: 'READ_SELECTION' }
  | { kind: 'READ_TEXT'; text: string }

export function sendToContent(tabId: number, msg: Msg) {
  return chrome.tabs.sendMessage(tabId, msg)
}

// Type guards for runtime validation of messages coming from other contexts
export function isReadSelection(m: unknown): m is { kind: 'READ_SELECTION' } {
  return typeof m === 'object' && m !== null && 'kind' in (m as Record<string, unknown>) && (m as any).kind === 'READ_SELECTION'
}

export function isReadText(m: unknown): m is { kind: 'READ_TEXT'; text: string } {
  return (
    typeof m === 'object' &&
    m !== null &&
    'kind' in (m as Record<string, unknown>) &&
    (m as any).kind === 'READ_TEXT' &&
    'text' in (m as Record<string, unknown>) &&
    typeof (m as any).text === 'string'
  )
}

export function isMsg(m: unknown): m is Msg {
  return isReadSelection(m) || isReadText(m)
}
