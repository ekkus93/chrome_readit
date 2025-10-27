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
  console.debug('[readit] sendToActiveTabOrInject -> tab', tab.id, tab.url, 'msg', msg)
  try {
    await chrome.tabs.sendMessage(tab.id!, msg)
    console.debug('[readit] sent message to content script on tab', tab.id)
  } catch {
    // No content script present yet. We'll try a safer approach:
    // 1) If the message carries text (READ_TEXT), attempt to proxy it to
    //    the local helper (service worker fetch) so page CSP doesn't matter.
    // 2) If the message is READ_SELECTION, try to read the selection via
    //    scripting.executeScript (returns selection string). If selection
    //    exists, proxy to local helper. If proxy fails, fall back to
    //    injecting a speak script into the page as a last resort.
    try {
      const s = await getSettings()
      const isReadText = msg.kind === 'READ_TEXT'
      let textArg: string | null = isReadText ? (msg as any).text : null

      // helper to proxy text to local TTS helper from service worker
      const tryProxy = async (text: string) => {
        try {
          const resp = await fetch('http://127.0.0.1:4000/speak', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          })
          console.debug('[readit] proxy result', resp.status)
          return resp.ok
        } catch (err) {
          console.warn('[readit] proxy to local helper failed', err)
          return false
        }
      }

      if (isReadText && textArg) {
        const proxied = await tryProxy(textArg)
        if (proxied) return
        // fall through to inject if proxy unavailable
      }

      if (!isReadText) {
        // Read selection by executing a script that returns the selection string
        try {
          const r = await chrome.scripting.executeScript({
            target: { tabId: tab.id! },
            world: 'MAIN',
            func: () => window.getSelection?.()?.toString().trim() ?? '',
          })
          const sel = Array.isArray(r) && r.length > 0 ? (r[0] as any).result : (r as any).result
          console.debug('[readit] selection from page', sel)
          if (sel) {
            const proxied = await tryProxy(sel as string)
            if (proxied) return
            // if proxy failed, fall through to injection
            textArg = sel as string
          } else {
            // nothing selected – nothing to do
            return
          }
        } catch (err) {
          console.warn('[readit] failed to read selection via executeScript', err)
          // continue to injection attempt below
        }
      }

      // Last-resort: inject a speak call into the page (may be subject to
      // page speech availability); pass the final textArg (may be null)
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
            console.warn('readit: speak injection failed', err)
          }
        },
        args: [s.voice, s.rate, textArg],
      })
      console.debug('[readit] executed injection script on tab', tab.id)
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
chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  // Keep channel open for asynchronous responses when we need to call
  // external processes (e.g. the local TTS helper) from the privileged
  // extension context. Return true at the end to indicate we'll call
  // sendResponse asynchronously.
  ;(async () => {
    try {
      // A lightweight proxy action used by page scripts that cannot call
      // extension APIs directly (page CSP blocks connect-src to 127.0.0.1).
      // The content script will forward a CustomEvent to the extension,
      // which arrives here as { action: 'proxy-speak', text: string }.
      if (
        typeof msg === 'object' &&
        msg !== null &&
        'action' in (msg as Record<string, unknown>) &&
        (msg as Record<string, unknown>).action === 'proxy-speak' &&
        'text' in (msg as Record<string, unknown>) &&
        typeof (msg as Record<string, unknown>).text === 'string'
      ) {
        const text = (msg as Record<string, any>).text as string
        try {
          // Proxy to the local helper; this fetch runs in the service worker
          // context and is not affected by the page's CSP.
          const res = await fetch('http://127.0.0.1:4000/speak', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          })
          sendResponse({ ok: res.ok, status: res.status })
        } catch (err) {
          console.warn('[readit] proxy-speak failed', err)
          sendResponse({ ok: false, error: String(err) })
        }
        return
      }

      // Lightweight probe for popup/options UI to check whether the local
      // helper is up. The helper exposes GET /ping which returns {ok:true}.
      if (
        typeof msg === 'object' &&
        msg !== null &&
        'action' in (msg as Record<string, unknown>) &&
        (msg as Record<string, unknown>).action === 'probe-tts'
      ) {
        try {
          const res = await fetch('http://127.0.0.1:4000/ping', { method: 'GET' })
          if (res.ok) {
            sendResponse({ ok: true })
          } else {
            sendResponse({ ok: false, status: res.status })
          }
        } catch (err) {
          sendResponse({ ok: false, error: String(err) })
        }
        return
      }

      // Use shared guards from lib/messaging for the normal read messages
      if (isMsg(msg)) {
        await sendToActiveTabOrInject(msg)
      }
    } catch (err) {
      console.warn('[readit] runtime message handler failed', err)
    }
  })()

  // Return true to indicate we'll call sendResponse asynchronously when
  // handling proxy-speak or other async operations.
  return true
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
