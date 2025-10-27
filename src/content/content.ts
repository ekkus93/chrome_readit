import type { Msg } from '../lib/messaging'
import { getSettings } from '../lib/storage'

// Use page context Web Speech API
async function speak(text: string) {
  const s = await getSettings()
  const utter = new SpeechSynthesisUtterance(text)
  utter.rate = s.rate
  if (s.voice) {
    const voice = speechSynthesis.getVoices().find(v => v.name === s.voice)
    if (voice) utter.voice = voice
  }
  speechSynthesis.cancel() // stop any previous
  speechSynthesis.speak(utter)
}

chrome.runtime.onMessage.addListener((msg: Msg, sender, _sendResponse) => {
  try {
    // Debug logging to help diagnose silent failures when the user triggers
    // the read-selection command or uses the popup. Check this log in the
    // page console (or the content script console) to verify message arrival.
    console.debug('[readit] content script received message', msg, 'from', sender)
    if (msg && (msg as any).kind === 'READ_SELECTION') {
      const sel = window.getSelection()?.toString().trim()
      console.debug('[readit] selection text:', sel)
      if (sel) speak(sel)
    } else if (msg && (msg as any).kind === 'READ_TEXT') {
      if ((msg as any).text?.trim()) speak((msg as any).text.trim())
    }
  } catch (err) {
    console.warn('[readit] content script handler error', err)
  }
  // no async response
  return false
})

// Bridge for page scripts: page context cannot call chrome.runtime directly
// and is subject to page CSP. A page can dispatch a CustomEvent named
// 'readit-proxy-speak' with { detail: { text: string } } and the content
// script will forward that request to the background service worker which
// can reach localhost. The response (success/failure) is re-dispatched as
// 'readit-proxy-speak-response' with detail { ok, ... }.
window.addEventListener('readit-proxy-speak', (ev: Event) => {
  try {
    const detail = (ev as CustomEvent)?.detail as { text?: unknown } | undefined
    if (!detail || typeof detail.text !== 'string') return
    chrome.runtime.sendMessage({ action: 'proxy-speak', text: detail.text }, (resp) => {
      try {
        window.dispatchEvent(new CustomEvent('readit-proxy-speak-response', { detail: resp }))
      } catch {}
    })
  } catch (err) {
    // best-effort bridge; avoid throwing into the page
    console.warn('readit: proxy-speak bridge failed', err)
  }
})

// Older approach injected an inline script into the page to create
// `window.readitProxySpeak`. That can be blocked by strict page CSPs
// (Refused to execute inline script). To avoid inline scripts we expose
// a postMessage-based API the page can call from console or page scripts.
//
// Usage from a page (console):
// const id = Date.now();
// window.addEventListener('message', function onResp(e){ if (e.source===window && e.data?.source==='readit-response' && e.data.id===id) { console.log(e.data.resp); window.removeEventListener('message', onResp) } });
// window.postMessage({ source: 'readit', type: 'proxy-speak', text: 'Hello', id }, '*');
//
// The content script listens for postMessage and forwards to the
// background proxy; the background response is posted back to the page.
window.addEventListener('message', (event: MessageEvent) => {
  try {
    // Must come from the same window (page -> content script uses window.postMessage)
    if (event.source !== window) return
    const data = event.data as Record<string, unknown> | undefined
    if (!data || data.source !== 'readit' || data.type !== 'proxy-speak') return
    const text = typeof data.text === 'string' ? data.text : ''
    const id = data.id
    try {
      chrome.runtime.sendMessage({ action: 'proxy-speak', text }, (resp) => {
        try {
          window.postMessage({ source: 'readit-response', id, resp }, '*')
        } catch {}
      })
    } catch (err) {
      try {
        window.postMessage({ source: 'readit-response', id, resp: { ok: false, error: String(err) } }, '*')
      } catch {}
    }
  } catch (err) {
    // swallow; don't break page
    console.warn('readit: postMessage bridge failed', err)
  }
})
