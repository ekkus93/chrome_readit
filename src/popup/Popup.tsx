import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Settings } from '../lib/storage'
// Use real Chrome typings from @types/chrome when installed; avoid file-scoped
// shims so TypeScript can check extension APIs correctly.
import { getSettings, saveSettings } from '../lib/storage'

export default function Popup() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [rate, setRate] = useState(1)
  const [voice, setVoice] = useState<string | undefined>()
  const [ttsHelperUp, setTtsHelperUp] = useState<boolean | null>(null)
  const [tryText, setTryText] = useState<string>('Hello from the popup')
  const [tryStatus, setTryStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle')

  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis.getVoices())
    load()
    if (speechSynthesis.onvoiceschanged === null) {
      // Firefox compat; Chrome also fires this
      speechSynthesis.addEventListener('voiceschanged', load)
      return () => speechSynthesis.removeEventListener('voiceschanged', load)
    } else {
      speechSynthesis.onvoiceschanged = load
    }
  }, [])

  useEffect(() => { getSettings().then(s => { setRate(s.rate); setVoice(s.voice) }) }, [])

  // Probe the local TTS helper via the background proxy. Background will
  // perform a GET /ping to the helper and return { ok: true } when present.
  useEffect(() => {
    let mounted = true
    const probe = () => {
      try {
        chrome.runtime.sendMessage({ action: 'probe-tts' }, (resp) => {
          if (!mounted) return
          if (resp && resp.ok) setTtsHelperUp(true)
          else setTtsHelperUp(false)
        })
      } catch (err) {
        if (!mounted) return
        console.warn('readit: probe-tts failed', err)
        setTtsHelperUp(false)
      }
    }
    probe()
    // allow re-probe on focus so the popup updates if the helper is started
    const onFocus = () => probe()
    window.addEventListener('focus', onFocus)
    return () => { mounted = false; window.removeEventListener('focus', onFocus) }
  }, [])

  async function handleReadSelection() {
    // Route read selection requests through the background so it can
    // use the same injection/fallback logic when a content script is
    // not present on the page.
    try {
      await chrome.runtime.sendMessage({ kind: 'READ_SELECTION' })
    } catch (err) {
      console.warn('readit: failed to request background read', err)
    }
  }

  async function handleTrySpeech() {
    const text = (tryText || '').trim()
    if (!text) return
    setTryStatus('sending')
    try {
      // Request the background to read text on the active tab (or inject)
      await chrome.runtime.sendMessage({ kind: 'READ_TEXT', text })
      setTryStatus('ok')
      setTimeout(() => setTryStatus('idle'), 1200)
    } catch (err) {
      console.warn('readit: try speech failed', err)
      setTryStatus('error')
    }
  }

  async function persist(part: Partial<Settings>) { await saveSettings(part) }

  const labelStyle = { display: 'block', fontWeight: 600 }
  const buttonStyle = { width: '100%', padding: '12px', fontSize: '1rem' } as const
  const selectStyle = { width: '100%', padding: 8 } as const
  const sliderStyle = { width: '100%' } as const

  return (
    <div
      role="application"
      style={{ minWidth: 280, padding: 12, lineHeight: 1.4 }}
    >
      <h1 style={{ fontSize: '1.1rem', margin: '0 0 8px' }}>Read It</h1>

      <button
        onClick={handleReadSelection}
        aria-label="Read selected text"
        style={buttonStyle}
      >
        Read selection (Alt+Shift+R)
      </button>

      <div style={{ marginTop: 12 }}>
        <label htmlFor="voice" style={labelStyle}>Voice</label>
        <select
          id="voice"
          value={voice ?? ''}
          onChange={e => { setVoice(e.target.value || undefined); persist({ voice: e.target.value || undefined }) }}
          style={selectStyle}
        >
          <option value="">System default</option>
          {voices.map(v => (
            <option key={v.name} value={v.name}>
              {v.name} {v.lang ? `(${v.lang})` : ''}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginTop: 12 }}>
        <label htmlFor="rate" style={labelStyle}>Rate: {rate.toFixed(2)}</label>
        <input
          id="rate"
          type="range"
          min={0.5} max={2} step={0.05}
          value={rate}
          onChange={e => { const r = Number(e.target.value); setRate(r); persist({ rate: r }) }}
          style={sliderStyle}
        />
      </div>

      <section style={{ marginTop: 12 }}>
        <label htmlFor="tryText" style={labelStyle}>Try speech on current page</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input id="tryText" value={tryText} onChange={e => setTryText(e.target.value)} style={{ flex: 1, padding: 8 }} />
          <button onClick={handleTrySpeech} style={{ padding: '8px 12px' }}>
            {tryStatus === 'sending' ? 'Sending…' : 'Try speech'}
          </button>
        </div>
        {tryStatus === 'ok' && <div style={{ color: '#006400', marginTop: 8 }}>Requested speech on the active tab.</div>}
        {tryStatus === 'error' && <div style={{ color: '#8b0000', marginTop: 8 }}>Failed to request speech. See background console.</div>}
      </section>

      <p style={{ fontSize: '.85rem', marginTop: 12 }}>
        Tip: Everything here is fully keyboard accessible. Use Tab / Shift+Tab to move, Space/Enter to activate.
      </p>
      {ttsHelperUp === false && (
        <div style={{ marginTop: 12, padding: 8, background: '#fff4f4', color: '#8b0000', borderRadius: 4 }}>
          Local TTS helper not running. Start the helper (see project scripts/README.md) if you rely on local system voices.
        </div>
      )}
      {ttsHelperUp === true && (
        <div style={{ marginTop: 12, padding: 8, background: '#f4fff7', color: '#006400', borderRadius: 4 }}>
          Local TTS helper available.
        </div>
      )}
    </div>
  )
}

// Auto-mount when this file is loaded as a page entry (popup.html).
// This keeps the file self-contained and mirrors `src/main.tsx`'s behavior.
const root = document.getElementById('root')
if (root) {
  createRoot(root).render(<Popup />)
}

