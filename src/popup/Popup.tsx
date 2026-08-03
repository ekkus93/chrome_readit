import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DEBUG_PARAGRAPH_FIXTURE } from '../lib/debug-fixtures'
import {
  isPlaybackEvent,
  isPlaybackStatus,
  type PlaybackSource,
  type PlaybackStatus,
} from '../lib/playback-protocol'
import { DEFAULT_SETTINGS, getSettings, saveSettings, type Settings } from '../lib/storage'
import { fetchServerVoices, type VoiceOption } from '../lib/voices'

function responseError(response: Record<string, unknown> | undefined, fallback: string): string {
  if (typeof response?.error === 'string') return response.error
  if (response?.error && typeof response.error === 'object' && 'message' in response.error) {
    const message = (response.error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return fallback
}

export default function Popup() {
  const showDebugFixture = import.meta.env.DEV
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [rate, setRate] = useState(DEFAULT_SETTINGS.rate)
  const [voice, setVoice] = useState<string>(DEFAULT_SETTINGS.voice)
  const [ttsUrl, setTtsUrl] = useState(DEFAULT_SETTINGS.ttsUrl)
  const [ttsServerUp, setTtsServerUp] = useState<boolean | null>(null)
  const [tryText, setTryText] = useState<string>('Hello from the popup')
  const [tryStatus, setTryStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle')
  const [playbackStatus, setPlaybackStatus] = useState<PlaybackStatus | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const persistedSettingsRef = useRef<Settings>(DEFAULT_SETTINGS)
  const completionTimerRef = useRef<number | null>(null)

  useEffect(() => {
    let mounted = true
    void getSettings().then((settings) => {
      if (!mounted) return
      persistedSettingsRef.current = settings
      setRate(settings.rate)
      setVoice(settings.voice)
      setTtsUrl(settings.ttsUrl)
      setLoaded(true)
    })
    return () => { mounted = false }
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
      if (mounted) setVoices(serverVoices)
    })
    return () => { mounted = false }
  }, [ttsUrl])

  useEffect(() => {
    let mounted = true
    const applyStatus = (status: PlaybackStatus) => {
      if (!mounted) return
      setPlaybackStatus(status)
      if (status.source !== 'popup-test') return
      if (completionTimerRef.current !== null) {
        window.clearTimeout(completionTimerRef.current)
        completionTimerRef.current = null
      }
      if (status.state === 'completed') {
        setTryStatus('ok')
        completionTimerRef.current = window.setTimeout(() => {
          if (mounted) setTryStatus('idle')
          completionTimerRef.current = null
        }, 1200)
      } else if (status.state === 'failed' || status.state === 'cancelled') {
        setTryStatus('error')
      } else if (status.state !== 'idle') {
        setTryStatus('sending')
      }
    }

    const listener = (message: unknown) => {
      if (!isPlaybackEvent(message)) return false
      applyStatus(message.status)
      return false
    }
    chrome.runtime.onMessage.addListener(listener)
    chrome.runtime.sendMessage({ kind: 'SPEECH_STATUS' }, (response) => {
      if (!chrome.runtime.lastError && isPlaybackStatus(response)) applyStatus(response)
    })

    return () => {
      mounted = false
      chrome.runtime.onMessage.removeListener?.(listener)
      if (completionTimerRef.current !== null) {
        window.clearTimeout(completionTimerRef.current)
        completionTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    let mounted = true
    const probe = () => {
      try {
        chrome.runtime.sendMessage({ action: 'probe-tts' }, (response) => {
          if (mounted) setTtsServerUp(Boolean(response?.ok))
        })
      } catch (error) {
        console.warn('readit: probe-tts failed', error)
        if (mounted) setTtsServerUp(false)
      }
    }
    probe()
    window.addEventListener('focus', probe)
    return () => {
      mounted = false
      window.removeEventListener('focus', probe)
    }
  }, [])

  async function requestRead(message: {
    kind: 'READ_SELECTION'
  } | {
    kind: 'READ_TEXT'
    text: string
    source?: PlaybackSource
  }) {
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
    try {
      const response = await requestRead({ kind: 'READ_SELECTION' })
      if (response?.ok) {
        setReadError(null)
        return
      }
      setReadError(responseError(response, 'Unable to start playback.'))
    } catch (error) {
      console.warn('readit: failed to request background read', error)
      setReadError(String(error))
    }
  }

  async function handleDebugFixture() {
    try {
      const response = await requestRead({ kind: 'READ_TEXT', text: DEBUG_PARAGRAPH_FIXTURE, source: 'debug-fixture' })
      if (response?.ok) {
        setReadError(null)
        return
      }
      setReadError(responseError(response, 'Unable to start debug playback.'))
    } catch (error) {
      console.warn('readit: failed to request debug fixture playback', error)
      setReadError(String(error))
    }
  }

  async function handleTrySpeech() {
    const text = tryText.trim()
    if (!text || tryStatus === 'sending') return
    setTryStatus('sending')
    try {
      const response = await requestRead({ kind: 'READ_TEXT', text, source: 'popup-test' })
      if (!response?.ok) {
        console.warn('[readit] popup test speech failed', responseError(response, 'Unable to start test speech.'))
        setTryStatus('error')
      }
    } catch (error) {
      console.warn('readit: try speech failed', error)
      setTryStatus('error')
    }
  }

  async function handlePause() {
    try { chrome.runtime.sendMessage({ kind: 'PAUSE_SPEECH' }, () => {}) } catch (error) { console.warn('readit: pause failed', error) }
  }

  async function handleResume() {
    try { chrome.runtime.sendMessage({ kind: 'RESUME_SPEECH' }, () => {}) } catch (error) { console.warn('readit: resume failed', error) }
  }

  async function handleCancel() {
    try { chrome.runtime.sendMessage({ kind: 'CANCEL_SPEECH' }, () => {}) } catch (error) { console.warn('readit: cancel failed', error) }
  }

  const labelStyle = { display: 'block', fontWeight: 600 }
  const buttonStyle = { width: '100%', padding: '12px', fontSize: '1rem' } as const
  const selectStyle = { width: '100%', padding: 8 } as const

  return (
    <div role="application" style={{ minWidth: 280, padding: 12, lineHeight: 1.4 }}>
      <h1 style={{ fontSize: '1.1rem', margin: '0 0 8px' }}>Read It</h1>

      <button onClick={handleReadSelection} aria-label="Read selected text" style={buttonStyle}>
        Read selection (Alt+Shift+R)
      </button>
      {showDebugFixture && (
        <button onClick={handleDebugFixture} aria-label="Debug paragraph transitions" style={{ ...buttonStyle, marginTop: 8 }}>
          Debug paragraph transitions
        </button>
      )}

      <div style={{ marginTop: 12 }}>
        <label htmlFor="voice" style={labelStyle}>Voice</label>
        <select
          id="voice"
          value={voice}
          onChange={(event) => setVoice(event.target.value || DEFAULT_SETTINGS.voice)}
          style={selectStyle}
        >
          {!voices.some((option) => option.name === voice) && <option value={voice}>{voice}</option>}
          {voices.map((option) => <option key={option.name} value={option.name}>{option.label}</option>)}
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
          min={0.5}
          max={10}
          step={0.05}
          value={rate}
          onChange={(event) => setRate(Number(event.target.value))}
          style={{ width: '100%' }}
        />
      </div>

      <section style={{ marginTop: 12 }}>
        <label htmlFor="tryText" style={labelStyle}>Try speech</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input id="tryText" value={tryText} onChange={(event) => setTryText(event.target.value)} style={{ flex: 1, padding: 8 }} />
          <button onClick={handleTrySpeech} disabled={tryStatus === 'sending'} style={{ padding: '8px 12px' }}>
            {tryStatus === 'sending' ? 'Playing…' : 'Try speech'}
          </button>
        </div>
        {tryStatus === 'ok' && <div style={{ color: '#006400', marginTop: 8 }}>Test speech completed.</div>}
        {tryStatus === 'error' && <div style={{ color: '#8b0000', marginTop: 8 }}>Test speech failed or was cancelled.</div>}
      </section>

      <section style={{ marginTop: 12 }}>
        <label style={labelStyle}>Playback controls</label>
        {playbackStatus && (
          <div aria-live="polite" style={{ fontSize: '.85rem', color: 'GrayText', marginBottom: 6 }}>
            Playback: {playbackStatus.state}
            {playbackStatus.totalChunks > 0 && ` — chunk ${playbackStatus.currentChunk} of ${playbackStatus.totalChunks}`}
          </div>
        )}
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

const root = document.getElementById('root')
if (root) createRoot(root).render(<Popup />)
