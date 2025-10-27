import React, { useEffect, useMemo, useState } from 'react'

type Settings = {
  voice?: string
  rate: number // 0.5..2.0
}

const DEFAULTS: Settings = { rate: 1.0 }

async function getSettings(): Promise<Settings> {
  const s = await chrome.storage.sync.get(['settings'])
  return { ...DEFAULTS, ...(s.settings ?? {}) }
}

async function saveSettings(patch: Partial<Settings>) {
  const curr = await getSettings()
  await chrome.storage.sync.set({ settings: { ...curr, ...patch } })
}

export default function Options() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [voice, setVoice] = useState<string | ''>('')
  const [rate, setRate] = useState<number>(1)
  const [loaded, setLoaded] = useState<boolean>(false)
  const [testText, setTestText] = useState<string>('Hello — this is a quick test of Read It.')
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'ok' | 'fallback' | 'error'>('idle')
  const [testError, setTestError] = useState<string | null>(null)

  // Load voices (some browsers populate asynchronously)
  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis.getVoices())
    load()
    const onvc = () => load()
    window.speechSynthesis.addEventListener('voiceschanged', onvc)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', onvc)
  }, [])

  // Load saved settings
  useEffect(() => {
    getSettings().then(s => {
      setRate(s.rate)
      setVoice(s.voice ?? '')
      // Mark that initial settings have been loaded. Persistence effects
      // should only run after this to avoid overwriting stored settings
      // with defaults during mount.
      setLoaded(true)
    })
  }, [])

  // Persist on change
  useEffect(() => {
    if (!loaded) return
    saveSettings({ rate })
  }, [rate, loaded])

  useEffect(() => {
    if (!loaded) return
    saveSettings({ voice: voice || undefined })
  }, [voice, loaded])

  const sysOption = useMemo(() => [{ name: '', label: 'System default' }], [])
  const voiceOptions = sysOption.concat(
    voices.map(v => ({ name: v.name, label: `${v.name}${v.lang ? ` (${v.lang})` : ''}` })),
  )

  async function trySpeakLocally(text: string) {
    try {
      const utter = new SpeechSynthesisUtterance(text)
      utter.rate = rate ?? 1
      if (voice) {
        const v = window.speechSynthesis.getVoices().find(x => x.name === voice)
        if (v) utter.voice = v
      }
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(utter)
      setTestStatus('fallback')
      setTestError(null)
    } catch (err) {
      setTestStatus('error')
      setTestError(String(err))
    }
  }

  function handleTestSpeech() {
    const text = (testText || '').trim()
    if (!text) return
    setTestStatus('sending')
    setTestError(null)
    try {
      chrome.runtime.sendMessage({ action: 'proxy-speak', text }, (resp) => {
        // If background successfully proxied to the local helper, we're done.
        if (resp && resp.ok) {
          setTestStatus('ok')
          setTestError(null)
          return
        }
        // Otherwise fall back to browser TTS if available.
        // If no voices are available, show an error instructing to run helper.
        const voicesNow = window.speechSynthesis.getVoices()
        if (!voicesNow || voicesNow.length === 0) {
          setTestStatus('error')
          setTestError('No system voices available; start the local TTS helper (see scripts/README.md)')
          return
        }
        trySpeakLocally(text)
      })
    } catch (err) {
      // If runtime messaging fails, try local speak or show error
      const voicesNow = window.speechSynthesis.getVoices()
      if (voicesNow && voicesNow.length > 0) {
        trySpeakLocally(text)
      } else {
        setTestStatus('error')
        setTestError(String(err))
      }
    }
  }

  return (
    <main style={{ maxWidth: 720, padding: 24, lineHeight: 1.5 }}>
      <h1 style={{ marginTop: 0 }}>Read It – Options</h1>

      <section style={{ marginBottom: 24 }}>
        <label htmlFor="voice" style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
          Voice
        </label>
        <select
          id="voice"
          value={voice}
          onChange={(e) => setVoice(e.target.value)}
          style={{ width: 360, padding: 8 }}
        >
          {voiceOptions.map(v => (
            <option key={v.name || 'default'} value={v.name}>{v.label}</option>
          ))}
        </select>
        <p style={{ color: 'GrayText' }}>
          Choose a TTS voice. Availability depends on your OS and browser.
        </p>
      </section>

      <section>
        <label htmlFor="rate" style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
          Speech rate: {rate.toFixed(2)}
        </label>
        <input
          id="rate"
          type="range"
          min={0.5}
          max={2}
          step={0.05}
          value={rate}
          onChange={(e) => setRate(Number(e.target.value))}
          style={{ width: 360 }}
        />
        <div style={{ color: 'GrayText' }}>0.5 (slow) … 2.0 (fast)</div>
      </section>

      <section style={{ marginTop: 24 }}>
        <label htmlFor="test" style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>Test speech</label>
        <textarea id="test" rows={3} value={testText} onChange={e => setTestText(e.target.value)} style={{ width: 520, padding: 8 }} />
        <div style={{ marginTop: 8 }}>
          <button onClick={handleTestSpeech} style={{ padding: '8px 12px' }}>Test speech</button>
          <span style={{ marginLeft: 12 }}>
            {testStatus === 'sending' && 'Sending…'}
            {testStatus === 'ok' && <span style={{ color: '#006400' }}> Spoken via local helper</span>}
            {testStatus === 'fallback' && <span style={{ color: '#006400' }}> Spoken via browser TTS</span>}
            {testStatus === 'error' && <span style={{ color: '#8b0000' }}> Error: {testError}</span>}
          </span>
        </div>
      </section>
    </main>
  )
}
