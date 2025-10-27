import { useEffect, useState } from 'react'
import type { Settings } from '../lib/storage'
// Use real Chrome typings from @types/chrome when installed; avoid file-scoped
// shims so TypeScript can check extension APIs correctly.
import { getSettings, saveSettings } from '../lib/storage'

export default function Popup() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [rate, setRate] = useState(1)
  const [voice, setVoice] = useState<string | undefined>()

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

      <p style={{ fontSize: '.85rem', marginTop: 12 }}>
        Tip: Everything here is fully keyboard accessible. Use Tab / Shift+Tab to move, Space/Enter to activate.
      </p>
    </div>
  )
}
