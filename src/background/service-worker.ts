import type { Msg } from '../lib/messaging'
import { getSettings } from '../lib/storage'
import { isMsg } from '../lib/messaging'

// When building, proper Chrome typings from @types/chrome will provide
// accurate types for the extension APIs. Avoid in-file shims where
// possible so the real types are used instead.

async function getActiveHttpTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || !tab.url) return null
  // only inject on regular pages
  if (!/^https?:|^file:/.test(tab.url)) return null
  return tab
}

export async function sendToActiveTabOrInject(msg: Msg) {
  const tab = await getActiveHttpTab()
  if (!tab) {
    console.warn('[readit] No eligible tab (http/https/file) to inject into.')
    return
  }
  try {
    await chrome.tabs.sendMessage(tab.id!, msg)
  } catch {
    // No content script present yet. Read current settings in the extension
    // context and inject a one-off page script that reads the current
    // selection and speaks it immediately. We pass settings as args so the
    // page script doesn't need extension APIs.
    try {
      const s = await getSettings()
      // If the message contains text (READ_TEXT), pass it through to the
      // injected function; otherwise the injected function will read the
      // current selection.
      const textArg = (msg.kind === 'READ_TEXT' ? msg.text : null)
      await chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        world: 'MAIN',
        func: (voiceName: string | undefined, rate: number, textArg: string | null) => {
          try {
            const text = textArg ?? window.getSelection?.()?.toString().trim()
            if (!text) return
            const u = new SpeechSynthesisUtterance(text)
            u.rate = rate ?? 1
            if (voiceName) {
              const v = speechSynthesis.getVoices().find((x) => x.name === voiceName)
              if (v) u.voice = v
            }
            speechSynthesis.cancel()
            speechSynthesis.speak(u)
          } catch (err) {
            // best-effort; avoid throwing from page script
            console.warn('readit: speak injection failed', err)
          }
        },
        args: [s.voice, s.rate, textArg],
      })
    } catch (err) {
      console.warn('[readit] injection fallback failed', err)
    }
  }
}

// Keyboard shortcut
chrome.commands.onCommand.addListener(async (command: string) => {
  if (command === 'read-selection') {
    await sendToActiveTabOrInject({ kind: 'READ_SELECTION' })
  }
})

// Allow other extension contexts (popup/options) to request a read via
// runtime messages. Route these through the same helper so injection
// fallback is centralized.
chrome.runtime.onMessage.addListener(async (msg: unknown) => {
  try {
    // Use shared guards from lib/messaging
    if (isMsg(msg)) {
      await sendToActiveTabOrInject(msg)
    }
  } catch (err) {
    console.warn('[readit] runtime message handler failed', err)
  }
  // No async response; return false.
  return false
})

// Context menu
chrome.runtime.onInstalled.addListener(() => {
  if (!chrome.contextMenus) return
  chrome.contextMenus.create({
    id: 'read-selection',
    title: 'Read selection aloud',
    contexts: ['selection'],
  })
})
if (chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener(async (info: chrome.contextMenus.OnClickData) => {
    if (info.menuItemId === 'read-selection') {
      await sendToActiveTabOrInject({ kind: 'READ_SELECTION' })
    }
  })
}
