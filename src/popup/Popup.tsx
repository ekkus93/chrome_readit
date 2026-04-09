import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DEBUG_PARAGRAPH_FIXTURE } from '../lib/debug-fixtures'
import { DEFAULT_SETTINGS, getSettings, saveSettings, type Settings } from '../lib/storage'
import { fetchServerVoices, type VoiceOption } from '../lib/voices'
// Use real Chrome typings from @types/chrome when installed; avoid file-scoped
// shims so TypeScript can check extension APIs correctly.

export default function Popup() {
  const showDebugFixture = import.meta.env.DEV
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [rate, setRate] = useState(DEFAULT_SETTINGS.rate)
  const [voice, setVoice] = useState<string>(DEFAULT_SETTINGS.voice)
  const [ttsUrl, setTtsUrl] = useState(DEFAULT_SETTINGS.ttsUrl)
  const [ttsServerUp, setTtsServerUp] = useState<boolean | null>(null)
  const [tryText, setTryText] = useState<string>('Hello from the popup')
  const [tryStatus, setTryStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle')
  const [readError, setReadError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const persistedSettingsRef = useRef<Settings>(DEFAULT_SETTINGS)

  useEffect(() => {
    let mounted = true
    void getSettings().then((s) => {
      if (!mounted) return
      persistedSettingsRef.current = s
      setRate(s.rate)
      setVoice(s.voice)
      setTtsUrl(s.ttsUrl)
      setLoaded(true)
    })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!loaded || rate === persistedSettingsRef.current.rate) return
    const timeoutId = window.setTimeout(() => {
      if (rate === persistedSettingsRef.current.rate) return
      persistedSettingsRef.current = { ...persistedSettingsRef.current, rate }
      void saveSettings({ rate })
    }, 200)
    return () => window.clearTimeout(timeoutId)
  }, [rate, loaded])

  useEffect(() => {
    if (!loaded || voice === persistedSettingsRef.current.voice) return
    persistedSettingsRef.current = { ...persistedSettingsRef.current, voice }
    void saveSettings({ voice })
  }, [voice, loaded])

  useEffect(() => {
    if (!ttsUrl) return
    let mounted = true
    void fetchServerVoices(ttsUrl).then((serverVoices) => {
      if (!mounted) return
      setVoices(serverVoices)
    })
    return () => {
      mounted = false
    }
  }, [ttsUrl])

  // Probe the configured TTS server through the background so the popup can
  // surface whether the extension can currently reach it.
  useEffect(() => {
    let mounted = true
    const probe = () => {
      try {
        chrome.runtime.sendMessage({ action: 'probe-tts' }, (resp) => {
          if (!mounted) return
          if (resp && resp.ok) setTtsServerUp(true)
          else setTtsServerUp(false)
        })
      } catch (err) {
        if (!mounted) return
        console.warn('readit: probe-tts failed', err)
        setTtsServerUp(false)
      }
    }
    probe()
    // allow re-probe on focus so the popup updates if the helper is started
    const onFocus = () => probe()
    window.addEventListener('focus', onFocus)
    return () => { mounted = false; window.removeEventListener('focus', onFocus) }
  }, [])

  async function requestRead(message: { kind: 'READ_SELECTION' } | { kind: 'READ_TEXT'; text: string }) {
    return await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message ?? 'unknown runtime error'))
          return
        }
        resolve(response as Record<string, unknown> | undefined)
      })
    })
  }

  async function handleReadSelection() {
    // Route read selection requests through the background so it can
    // use the same injection/fallback logic when a content script is
    // not present on the page.
    try {
      const response = await requestRead({ kind: 'READ_SELECTION' })
      if (response?.ok) {
        setReadError(null)
        return
      }
      setReadError(typeof response?.error === 'string' ? response.error : 'Unable to start playback.')
    } catch (err) {
      console.warn('readit: failed to request background read', err)
      setReadError(String(err))
    }
  }

  async function handleDebugFixture() {
    try {
      const response = await requestRead({ kind: 'READ_TEXT', text: DEBUG_PARAGRAPH_FIXTURE })
      if (response?.ok) {
        setReadError(null)
        return
      }
      setReadError(typeof response?.error === 'string' ? response.error : 'Unable to start debug playback.')
    } catch (err) {
      console.warn('readit: failed to request debug fixture playback', err)
      setReadError(String(err))
    }
  }

  async function handleTrySpeech() {
    const text = (tryText || '').trim()
    if (!text) return
    setTryStatus('sending')
    try {
      const resp = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'request-tts', text }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message ?? 'unknown runtime error'))
            return
          }
          resolve(response as Record<string, unknown> | undefined)
        })
      })

      if (!resp || !resp.ok) {
        console.warn('[readit] popup tts failed', resp?.error)
        setTryStatus('error')
        return
      }

      const audio = resp.audio
      const mime = typeof resp.mime === 'string' ? resp.mime : 'audio/wav'
      if (typeof audio !== 'string' || audio.length === 0) {
        console.warn('[readit] popup tts: no playable audio in response')
        setTryStatus('error')
        return
      }
      if (!mime.startsWith('audio/')) {
        console.warn('[readit] popup tts: non-audio payload returned', mime)
        setTryStatus('error')
        return
      }

      const bin = atob(audio)
      const len = bin.length
      if (len === 0) {
        console.warn('[readit] popup tts: decoded audio payload is empty')
        setTryStatus('error')
        return
      }
      const u8 = new Uint8Array(len)
      for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i)
      const blob = new Blob([u8], { type: mime })
      const url = URL.createObjectURL(blob)
      const player = new Audio(url)
      player.playbackRate = rate
      player.autoplay = true
      try {
        await player.play()
        setTryStatus('ok')
        setTimeout(() => setTryStatus('idle'), 1200)
      } catch (err) {
        console.warn('[readit] popup audio play failed', err)
        setTryStatus('error')
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
      }
    } catch (err) {
      console.warn('readit: try speech failed', err)
      setTryStatus('error')
    }
  }

  const labelStyle = { display: 'block', fontWeight: 600 }
  const buttonStyle = { width: '100%', padding: '12px', fontSize: '1rem' } as const
  const selectStyle = { width: '100%', padding: 8 } as const
  const sliderStyle = { width: '100%' } as const

  // Control handlers for pause/resume/cancel reading
  async function handlePause() {
    try { chrome.runtime.sendMessage({ kind: 'PAUSE_SPEECH' }, () => {}) } catch (e) { console.warn('readit: pause failed', e) }
  }
  async function handleResume() {
    try { chrome.runtime.sendMessage({ kind: 'RESUME_SPEECH' }, () => {}) } catch (e) { console.warn('readit: resume failed', e) }
  }
  async function handleCancel() {
    try { chrome.runtime.sendMessage({ kind: 'CANCEL_SPEECH' }, () => {}) } catch (e) { console.warn('readit: cancel failed', e) }
  }

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
      {showDebugFixture && (
        <button
          onClick={handleDebugFixture}
          aria-label="Debug paragraph transitions"
          style={{ ...buttonStyle, marginTop: 8 }}
        >
          Debug paragraph transitions
        </button>
      )}

      <div style={{ marginTop: 12 }}>
        <label htmlFor="voice" style={labelStyle}>Voice</label>
        <select
          id="voice"
          value={voice}
          onChange={e => { const nextVoice = e.target.value || DEFAULT_SETTINGS.voice; setVoice(nextVoice) }}
          style={selectStyle}
        >
          {!voices.some((option) => option.name === voice) && <option value={voice}>{voice}</option>}
          {voices.map(v => (
            <option key={v.name} value={v.name}>{v.label}</option>
          ))}
        </select>
        <p style={{ fontSize: '.8rem', color: 'GrayText', marginTop: 6 }}>
          Voices come from the configured TTS server/model.
        </p>
      </div>

      <div style={{ marginTop: 12 }}>
        <label htmlFor="rate" style={labelStyle}>Rate: {rate.toFixed(2)}</label>
        <input
          id="rate"
          type="range"
          min={0.5} max={10} step={0.05}
          value={rate}
          onChange={e => { const r = Number(e.target.value); setRate(r) }}
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
        {tryStatus === 'ok' && <div style={{ color: '#006400', marginTop: 8 }}>Played test speech in the popup.</div>}
        {tryStatus === 'error' && <div style={{ color: '#8b0000', marginTop: 8 }}>Failed to play returned speech audio.</div>}
      </section>

      <section style={{ marginTop: 12 }}>
        <label style={labelStyle}>Playback controls</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handlePause} style={{ padding: '8px 10px', flex: 1 }}>Pause</button>
          <button onClick={handleResume} style={{ padding: '8px 10px', flex: 1 }}>Resume</button>
          <button onClick={handleCancel} style={{ padding: '8px 10px', flex: 1 }}>Cancel</button>
        </div>
      </section>

      <p style={{ fontSize: '.85rem', marginTop: 12 }}>
        Tip: Everything here is fully keyboard accessible. Use Tab / Shift+Tab to move, Space/Enter to activate.
      </p>
      {ttsServerUp === false && (
        <div style={{ marginTop: 12, padding: 8, background: '#fff4f4', color: '#8b0000', borderRadius: 4 }}>
          Configured TTS server unavailable.
        </div>
      )}
      {ttsServerUp === true && (
        <div style={{ marginTop: 12, padding: 8, background: '#f4fff7', color: '#006400', borderRadius: 4 }}>
          Configured TTS server available.
        </div>
      )}
      {readError && (
        <div style={{ marginTop: 12, padding: 8, background: '#fff4f4', color: '#8b0000', borderRadius: 4 }}>
          {readError}
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
