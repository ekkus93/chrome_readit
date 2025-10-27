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
    })
  }, [])

  // Persist on change
  useEffect(() => { saveSettings({ rate }) }, [rate])
  useEffect(() => { saveSettings({ voice: voice || undefined }) }, [voice])

  const sysOption = useMemo(() => [{ name: '', label: 'System default' }], [])
  const voiceOptions = sysOption.concat(
    voices.map(v => ({ name: v.name, label: `${v.name}${v.lang ? ` (${v.lang})` : ''}` })),
  )

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
    </main>
  )
}
