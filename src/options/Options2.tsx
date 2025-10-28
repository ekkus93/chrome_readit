import React, { useEffect, useMemo, useState } from 'react'

type Settings = {
  voice?: string
  rate: number
  ttsUrl?: string
}

const DEFAULTS: Settings = { rate: 1.0 }
const DEFAULT_TTS_URL = 'http://localhost:5002/api/tts'

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
  const [ttsUrl, setTtsUrl] = useState<string>(DEFAULT_TTS_URL)

  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis.getVoices())
    load()
    const onvc = () => load()
    window.speechSynthesis.addEventListener('voiceschanged', onvc)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', onvc)
  }, [])

  useEffect(() => {
    getSettings().then(s => {
      setRate(s.rate)
      setVoice(s.voice ?? '')
      setTtsUrl(s.ttsUrl ?? DEFAULT_TTS_URL)
      setLoaded(true)
    })
  }, [])

  useEffect(() => { if (!loaded) return; saveSettings({ rate }) }, [rate, loaded])
  useEffect(() => { if (!loaded) return; saveSettings({ voice: voice || undefined }) }, [voice, loaded])
  useEffect(() => { if (!loaded) return; saveSettings({ ttsUrl: ttsUrl || undefined }) }, [ttsUrl, loaded])

  const sysOption = useMemo(() => [{ name: '', label: 'System default' }], [])
  const voiceOptions = sysOption.concat(voices.map(v => ({ name: v.name, label: `${v.name}${v.lang ? ` (${v.lang})` : ''}` })))

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

    chrome.runtime.sendMessage({ action: 'request-tts', text }, (resp) => {
      if (chrome.runtime.lastError) {
        const errMsg = chrome.runtime.lastError?.message ?? 'unknown runtime error'
        console.warn('[readit] request-tts sendMessage failed', errMsg)
        const voicesNow = window.speechSynthesis.getVoices()
        if (voicesNow && voicesNow.length > 0) {
          trySpeakLocally(text)
          setTestStatus('fallback')
          setTestError(errMsg)
          return
        }
        setTestStatus('error')
        setTestError(errMsg)
        return
      }
      if (!resp) { setTestStatus('error'); setTestError('no response from background'); return }
      if (resp.ok && resp.audio) {
        try {
          const buf = resp.audio as ArrayBuffer
          const mime = resp.mime || 'audio/wav'
          const blob = new Blob([buf], { type: mime })
          const url = URL.createObjectURL(blob)
          const a = new Audio(url)
          a.autoplay = true
          a.play().catch((e) => { console.warn('[readit] options player failed to play', e); setTestStatus('error'); setTestError(String(e)) })
          a.onended = () => setTestStatus('ok')
          setTimeout(() => URL.revokeObjectURL(url), 60_000)
          setTestStatus('sending')
          setTestError(null)
          return
        } catch (err) {
          console.warn('[readit] failed to play returned audio', err)
          setTestStatus('error')
          setTestError(String(err))
          return
        }
      }
      if (!resp.ok) { const voicesNow = window.speechSynthesis.getVoices(); if (voicesNow && voicesNow.length > 0) { trySpeakLocally(text); setTestStatus('fallback'); setTestError(resp.error ?? 'background tts failed'); return } setTestStatus('error'); setTestError(resp.error ?? 'background tts failed'); return }
    })
  }

  return (
    <main style={{ maxWidth: 720, padding: 24, lineHeight: 1.5 }}>
      <h1 style={{ marginTop: 0 }}>Read It – Options</h1>
      <section style={{ marginBottom: 24 }}>
        <label htmlFor="voice" style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>Voice</label>
        <select id="voice" value={voice} onChange={(e) => setVoice(e.target.value)} style={{ width: 360, padding: 8 }}>
          {voiceOptions.map(v => (<option key={v.name || 'default'} value={v.name}>{v.label}</option>))}
        </select>
        <p style={{ color: 'GrayText' }}>Choose a TTS voice. Availability depends on your OS and browser.</p>
      </section>
      <section style={{ marginTop: 24 }}>
        <label htmlFor="ttsUrl" style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>TTS service URL (optional, opt‑in)</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input id="ttsUrl" type="text" value={ttsUrl} onChange={e => setTtsUrl(e.target.value)} style={{ width: 440, padding: 8 }} placeholder={DEFAULT_TTS_URL} />
          <button onClick={() => setTtsUrl(DEFAULT_TTS_URL)} style={{ padding: '8px 10px' }}>Use local default</button>
        </div>
        <div style={{ color: 'GrayText', marginTop: 6 }}>If set, Read It will POST text to this URL and play returned audio. The default points to a local Coqui helper ({DEFAULT_TTS_URL}).</div>
      </section>
      <section>
        <label htmlFor="rate" style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>Speech rate: {rate.toFixed(2)}</label>
        <input id="rate" type="range" min={0.5} max={2} step={0.05} value={rate} onChange={(e) => setRate(Number(e.target.value))} style={{ width: 360 }} />
        <div style={{ color: 'GrayText' }}>0.5 (slow) … 2.0 (fast)</div>
      </section>
      <section style={{ marginTop: 24 }}>
        <label htmlFor="test" style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>Test speech</label>
        <textarea id="test" rows={3} value={testText} onChange={e => setTestText(e.target.value)} style={{ width: 520, padding: 8 }} />
        <div style={{ marginTop: 8 }}>
          <button onClick={handleTestSpeech} style={{ padding: '8px 12px' }}>Test speech</button>
          <span style={{ marginLeft: 12 }}>{testStatus === 'sending' && 'Sending…'}{testStatus === 'ok' && <span style={{ color: '#006400' }}> Spoken via local helper</span>}{testStatus === 'fallback' && <span style={{ color: '#006400' }}> Spoken via browser TTS</span>}{testStatus === 'error' && <span style={{ color: '#8b0000' }}> Error: {testError}</span>}</span>
        </div>
      </section>
    </main>
  )
}
