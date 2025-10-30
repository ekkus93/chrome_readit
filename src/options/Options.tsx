import React, { useEffect, useMemo, useState, useRef } from 'react'

type Settings = {
  voice?: string
  rate: number // 0.5..2.0
  ttsUrl?: string
}

// Exported helper for tests: fetch available voices from a configured TTS URL.
export async function fetchVoicesForTtsUrl(ttsUrl: string): Promise<string[]> {
  try {
    const url = new URL(ttsUrl)
    url.pathname = '/api/voices'
    const res = await fetch(url.toString(), { method: 'GET' })
    if (!res.ok) return []
    const js = await res.json().catch(() => null)
    if (!js || !Array.isArray(js.voices)) return []
    return js.voices
  } catch {
    return []
  }
}

const DEFAULTS: Settings = { rate: 1.0, voice: 'p225' }

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
  const [voice, setVoice] = useState<string | ''>('')
  const [rate, setRate] = useState<number>(1)
  const [loaded, setLoaded] = useState<boolean>(false)
  const [testText, setTestText] = useState<string>('Hello — this is a quick test of Read It.')
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle')
  const [testError, setTestError] = useState<string | null>(null)
  const [ttsUrl, setTtsUrl] = useState<string>(DEFAULT_TTS_URL)
  const [voicesList, setVoicesList] = useState<Array<{ name: string; label: string }>>([])
  const [serverPlaying, setServerPlaying] = useState<boolean>(false)
  const [checkingPlaying, setCheckingPlaying] = useState(false)
  const testAudioRef = useRef<HTMLAudioElement | null>(null)
  

  // NOTE: we no longer use the browser SpeechSynthesis fallback. Keep
  // voice selection as a stored preference only.

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

  const voiceOptions = useMemo(() => [{ name: '', label: 'System default' }, ...voicesList], [voicesList])

  useEffect(() => {
    if (!ttsUrl) return
    let mounted = true
    async function fetchVoices() {
      try {
        const voices = await fetchVoicesForTtsUrl(ttsUrl)
        if (!mounted) return
        setVoicesList(voices.map((v: string) => ({ name: v, label: v })))
      } catch (err) {
        // ignore; leave voicesList empty
      }
    }
    fetchVoices()
    return () => { mounted = false }
  }, [ttsUrl])

  useEffect(() => {
    let poll: number | undefined
    async function checkPlaying() {
      if (!ttsUrl) return
      setCheckingPlaying(true)
      try {
        const url = new URL(ttsUrl)
        url.pathname = '/api/playing'
        const res = await fetch(url.toString())
        if (!res.ok) {
          setServerPlaying(false)
        } else {
          const js = await res.json().catch(() => null)
          setServerPlaying(Boolean(js?.playing))
        }
      } catch {
        setServerPlaying(false)
      } finally {
        setCheckingPlaying(false)
      }
    }
    // poll while serverPlaying is true (to detect end) and otherwise do a single check
    checkPlaying()
    poll = window.setInterval(checkPlaying, 2500)
    return () => { if (poll) clearInterval(poll) }
  }, [ttsUrl])

  async function cancelPlayback() {
    if (!ttsUrl) return
    try {
      const url = new URL(ttsUrl)
      url.pathname = '/api/tts/cancel'
      const res = await fetch(url.toString(), { method: 'POST' })
      if (!res.ok) {
        // ignore for now
      } else {
        const js = await res.json().catch(() => null)
        if (js && js.canceled) setServerPlaying(false)
      }
    } catch {
      // ignore
    }
  }

  // UI controls to pause/resume/cancel in-page playback (sends messages
  // to the background which will notify the active tab/content script).
  async function handlePause() {
    try { chrome.runtime.sendMessage({ action: 'pause-speech' }, () => {}) } catch (e) { console.warn('readit: pause failed', e) }
  }
  async function handleResume() {
    try { chrome.runtime.sendMessage({ action: 'resume-speech' }, () => {}) } catch (e) { console.warn('readit: resume failed', e) }
  }
  async function handleCancel() {
    try { chrome.runtime.sendMessage({ action: 'cancel-speech' }, () => {}) } catch (e) { console.warn('readit: cancel failed', e) }
  }

  // Browser speechSynthesis fallback removed — extension now requires the
  // configured server to perform playback. Errors are surfaced to the user.

  function isProbablyAudio(buf: ArrayBuffer | Uint8Array, mime?: string) {
    try {
      if (mime && mime.startsWith('audio/')) return true
      const view = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf
      if (view.length >= 4) {
        // WAV -> "RIFF"
        if (view[0] === 0x52 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x46) return true
        // Ogg -> "OggS"
        if (view[0] === 0x4F && view[1] === 0x67 && view[2] === 0x67 && view[3] === 0x53) return true
        // FLAC -> "fLaC"
        if (view[0] === 0x66 && view[1] === 0x4C && view[2] === 0x61 && view[3] === 0x43) return true
        // ID3 (MP3 tag) -> "ID3"
        if (view[0] === 0x49 && view[1] === 0x44 && view[2] === 0x33) return true
      }
    } catch {
      // ignore
    }
    return false
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
        setTestStatus('error')
        setTestError(errMsg)
        return
      }
      if (!resp) { setTestStatus('error'); setTestError('no response from background'); return }
  if (resp.ok && resp.audio) {
        try {
          const mime = resp.mime || 'audio/wav'
          
          // Decode base64 audio back to ArrayBuffer
          let buf: ArrayBuffer
          if (typeof resp.audio === 'string') {
            // Base64 encoded audio from service worker
            try {
              const binary = atob(resp.audio)
              const len = binary.length
              const u8 = new Uint8Array(len)
              for (let i = 0; i < len; i++) u8[i] = binary.charCodeAt(i)
              buf = u8.buffer
            } catch (err) {
              console.warn('[readit] failed to decode base64 audio', err)
              setTestStatus('error')
              setTestError('Failed to decode audio data')
              return
            }
          } else {
            // Direct ArrayBuffer (fallback)
            buf = resp.audio as ArrayBuffer
          }

          // Check that the returned buffer actually looks like audio. Some
          // endpoints (e.g. the server-side play-only path) may return JSON
          // or other non-audio payloads; attempting to play those causes
          // NotSupportedError. Use a lightweight signature check before
          // creating the Blob.
          // Peek a small prefix for debugging (hex) so we can see what the
          // server actually returned when diagnosing NotSupportedError.
          let prefixHex = ''
          try {
            const v = new Uint8Array(buf)
            const len = Math.min(16, v.length)
            const parts: string[] = []
            for (let i = 0; i < len; i++) parts.push(v[i].toString(16).padStart(2, '0'))
            prefixHex = parts.join(' ')
          } catch {
            prefixHex = '<unavailable>'
          }

          // If the buffer is empty, avoid attempting to play it and report
          // a clear error — empty payloads commonly cause NotSupportedError.
          try {
            const v = new Uint8Array(buf)
            if (v.length === 0) {
              console.warn('[readit] options: returned audio buffer is empty', { mime, prefixHex })
              setTestStatus('error')
              setTestError(`TTS service returned an empty payload (${mime})`)
              return
            }
          } catch {
            // ignore
          }

          if (!isProbablyAudio(buf, mime)) {
            console.warn('[readit] options: returned payload does not appear to be audio', { mime, prefixHex })
            setTestStatus('error')
            setTestError(`TTS service returned non-audio payload (${mime})`)
            return
          }

          const blob = new Blob([buf], { type: mime })
          const url = URL.createObjectURL(blob)
          const a = new Audio(url)
          // keep a reference so the element isn't GC'd while playback runs
          testAudioRef.current = a
          a.autoplay = true
          a.play().catch((e) => {
            // Log the full DOMException/object for debugging (not just String)
            console.warn('[readit] options player failed to play', { mime, prefixHex, error: e })
            setTestStatus('error')
            setTestError(String(e))
            testAudioRef.current = null
          })
          a.onended = () => {
            setTestStatus('ok')
            testAudioRef.current = null
          }
          setTimeout(() => { try { URL.revokeObjectURL(url) } catch {} }, 60_000)
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
      if (!resp.ok) { setTestStatus('error'); setTestError(resp.error ?? 'background tts failed'); return }
    })
  }

  const [serverHealth, setServerHealth] = useState<'unknown' | 'ok' | 'error'>('unknown')
  const [serverTesting, setServerTesting] = useState(false)
  const [serverTestError, setServerTestError] = useState<string | null>(null)

  async function testServer() {
    setServerTesting(true)
    setServerTestError(null)
    try {
      const res = await fetch(ttsUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'health-check' }) })
      if (!res.ok) {
        setServerHealth('error')
        setServerTestError(`HTTP ${res.status} ${res.statusText}`)
      } else {
        setServerHealth('ok')
      }
    } catch (err) {
      setServerHealth('error')
      setServerTestError(String(err))
    } finally {
      setServerTesting(false)
    }
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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <div style={{ marginLeft: 8 }}>
            <button onClick={testServer} disabled={serverTesting} style={{ padding: '6px 10px' }}>{serverTesting ? 'Testing…' : 'Test server'}</button>
          </div>
          <div style={{ marginLeft: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 12, height: 12, borderRadius: 12, background: serverHealth === 'ok' ? '#00c853' : serverHealth === 'error' ? '#d50000' : '#bdbdbd' }} />
            <div style={{ color: serverHealth === 'ok' ? '#006400' : serverHealth === 'error' ? '#8b0000' : 'GrayText' }}>{serverHealth === 'ok' ? 'Server reachable' : serverHealth === 'error' ? `Server error${serverTestError ? `: ${serverTestError}` : ''}` : 'Server status unknown'}</div>
          </div>
          <div style={{ marginLeft: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 12, height: 12, borderRadius: 12, background: serverPlaying ? '#00c853' : '#bdbdbd' }} />
            <div style={{ color: serverPlaying ? '#006400' : 'GrayText' }}>{serverPlaying ? 'Server speaking' : 'Server idle'}</div>
            <button onClick={cancelPlayback} disabled={!serverPlaying || checkingPlaying} style={{ padding: '6px 10px' }}>Cancel playback</button>
            <div style={{ display: 'flex', gap: 8, marginLeft: 12 }}>
              <button onClick={handlePause} style={{ padding: '6px 10px' }}>Pause</button>
              <button onClick={handleResume} style={{ padding: '6px 10px' }}>Resume</button>
              <button onClick={handleCancel} style={{ padding: '6px 10px' }}>Stop</button>
            </div>
          </div>
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
          <span style={{ marginLeft: 12 }}>{testStatus === 'sending' && 'Sending…'}{testStatus === 'ok' && <span style={{ color: '#006400' }}> Spoken via local helper</span>}{testStatus === 'error' && <span style={{ color: '#8b0000' }}> Error: {testError}</span>}</span>
        </div>
      </section>
    </main>
  )
}
