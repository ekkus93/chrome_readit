import { useEffect, useMemo, useRef, useState } from 'react'
import { DEBUG_PARAGRAPH_FIXTURE } from '../lib/debug-fixtures'
import {
  isPlaybackEvent,
  isPlaybackStatus,
  type PlaybackStatus,
} from '../lib/playback-protocol'
import { DEFAULT_SETTINGS, DEFAULT_TTS_URL, getSettings, saveSettings, type Settings } from '../lib/storage'
import { fetchServerVoices, type VoiceOption } from '../lib/voices'

function responseError(response: unknown, fallback: string): string {
  if (!response || typeof response !== 'object') return fallback
  const error = (response as { error?: unknown }).error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return fallback
}

export default function Options() {
  const showDebugFixture = import.meta.env.DEV
  const [voice, setVoice] = useState(DEFAULT_SETTINGS.voice)
  const [rate, setRate] = useState(DEFAULT_SETTINGS.rate)
  const [loaded, setLoaded] = useState(false)
  const [testText, setTestText] = useState('Hello — this is a quick test of Read It.')
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle')
  const [testError, setTestError] = useState<string | null>(null)
  const [playbackStatus, setPlaybackStatus] = useState<PlaybackStatus | null>(null)
  const [ttsUrl, setTtsUrl] = useState(DEFAULT_SETTINGS.ttsUrl)
  const [voicesList, setVoicesList] = useState<VoiceOption[]>([])
  const [serverHealth, setServerHealth] = useState<'unknown' | 'ok' | 'error'>('unknown')
  const [serverTesting, setServerTesting] = useState(false)
  const [serverTestError, setServerTestError] = useState<string | null>(null)
  const persistedSettingsRef = useRef<Settings>(DEFAULT_SETTINGS)

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
    const nextTtsUrl = ttsUrl || DEFAULT_TTS_URL
    if (!loaded || nextTtsUrl === persistedSettingsRef.current.ttsUrl) return
    persistedSettingsRef.current = { ...persistedSettingsRef.current, ttsUrl: nextTtsUrl }
    void saveSettings({ ttsUrl: nextTtsUrl })
  }, [ttsUrl, loaded])

  useEffect(() => {
    if (!ttsUrl) return
    let mounted = true
    void fetchServerVoices(ttsUrl).then((voices) => {
      if (mounted) setVoicesList(voices)
    })
    return () => { mounted = false }
  }, [ttsUrl])

  useEffect(() => {
    let mounted = true
    const applyStatus = (status: PlaybackStatus) => {
      if (!mounted) return
      setPlaybackStatus(status)
      if (status.source !== 'options-test') return
      if (status.state === 'completed') {
        setTestStatus('ok')
        setTestError(null)
      } else if (status.state === 'failed' || status.state === 'cancelled') {
        setTestStatus('error')
        setTestError(status.error?.message ?? 'Test speech failed or was cancelled.')
      } else if (status.state !== 'idle') {
        setTestStatus('sending')
        setTestError(null)
      }
    }

    const listener = (message: unknown) => {
      if (!isPlaybackEvent(message)) return false
      applyStatus(message.status)
      return false
    }
    chrome.runtime.onMessage.addListener(listener)
    void chrome.runtime.sendMessage({ kind: 'SPEECH_STATUS' }).then((response) => {
      if (isPlaybackStatus(response)) applyStatus(response)
    }).catch(() => undefined)

    return () => {
      mounted = false
      chrome.runtime.onMessage.removeListener?.(listener)
    }
  }, [])

  const voiceOptions = useMemo(() => {
    if (voicesList.some((option) => option.name === voice)) return voicesList
    return [{ name: voice, label: voice }, ...voicesList]
  }, [voice, voicesList])

  async function sendControl(kind: 'PAUSE_SPEECH' | 'RESUME_SPEECH' | 'CANCEL_SPEECH') {
    try { await chrome.runtime.sendMessage({ kind }) } catch (error) { console.warn(`readit: ${kind} failed`, error) }
  }

  async function handleDebugFixture() {
    try {
      await chrome.runtime.sendMessage({ kind: 'READ_TEXT', text: DEBUG_PARAGRAPH_FIXTURE, source: 'debug-fixture' })
    } catch (error) {
      console.warn('readit: debug fixture failed', error)
    }
  }

  async function handleTestSpeech() {
    const text = testText.trim()
    if (!text || testStatus === 'sending') return
    setTestStatus('sending')
    setTestError(null)
    try {
      const response = await chrome.runtime.sendMessage({ kind: 'READ_TEXT', text, source: 'options-test' })
      if (!response?.ok) {
        setTestStatus('error')
        setTestError(responseError(response, 'Unable to start test speech.'))
      }
    } catch (error) {
      setTestStatus('error')
      setTestError(String(error))
    }
  }

  async function testServer() {
    setServerTesting(true)
    setServerTestError(null)
    try {
      const response = await chrome.runtime.sendMessage({ action: 'probe-tts' })
      if (response?.ok) setServerHealth('ok')
      else {
        setServerHealth('error')
        setServerTestError(responseError(response, 'Server unavailable.'))
      }
    } catch (error) {
      setServerHealth('error')
      setServerTestError(String(error))
    } finally {
      setServerTesting(false)
    }
  }

  return (
    <main style={{ maxWidth: 720, padding: 24, lineHeight: 1.5 }}>
      <h1 style={{ marginTop: 0 }}>Read It – Options</h1>
      <section style={{ marginBottom: 24 }}>
        <label htmlFor="voice" style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>Voice</label>
        <select id="voice" value={voice} onChange={(event) => setVoice(event.target.value)} style={{ width: 360, padding: 8 }}>
          {voiceOptions.map((option) => <option key={option.name || 'default'} value={option.name}>{option.label}</option>)}
        </select>
        <p style={{ color: 'GrayText' }}>Choose a voice exposed by the configured TTS server/model.</p>
      </section>

      <section style={{ marginTop: 24 }}>
        <label htmlFor="ttsUrl" style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>TTS service URL (optional, opt-in)</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input id="ttsUrl" type="text" value={ttsUrl} onChange={(event) => setTtsUrl(event.target.value)} style={{ width: 440, padding: 8 }} placeholder={DEFAULT_TTS_URL} />
          <button onClick={() => setTtsUrl(DEFAULT_TTS_URL)} style={{ padding: '8px 10px' }}>Use local default</button>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <button onClick={testServer} disabled={serverTesting} style={{ padding: '6px 10px' }}>{serverTesting ? 'Testing…' : 'Test server'}</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 12, height: 12, borderRadius: 12, background: serverHealth === 'ok' ? '#00c853' : serverHealth === 'error' ? '#d50000' : '#bdbdbd' }} />
            <div style={{ color: serverHealth === 'ok' ? '#006400' : serverHealth === 'error' ? '#8b0000' : 'GrayText' }}>
              {serverHealth === 'ok' ? 'Server reachable' : serverHealth === 'error' ? `Server error${serverTestError ? `: ${serverTestError}` : ''}` : 'Server status unknown'}
            </div>
          </div>
          <button onClick={() => sendControl('PAUSE_SPEECH')} style={{ padding: '6px 10px' }}>Pause</button>
          <button onClick={() => sendControl('RESUME_SPEECH')} style={{ padding: '6px 10px' }}>Resume</button>
          <button onClick={() => sendControl('CANCEL_SPEECH')} style={{ padding: '6px 10px' }}>Stop</button>
          {showDebugFixture && <button onClick={handleDebugFixture} style={{ padding: '6px 10px' }}>Debug paragraph transitions</button>}
        </div>
        {playbackStatus && (
          <div aria-live="polite" style={{ color: 'GrayText', marginTop: 8 }}>
            Playback: {playbackStatus.state}
            {playbackStatus.totalChunks > 0 && ` — chunk ${playbackStatus.currentChunk} of ${playbackStatus.totalChunks}`}
            {playbackStatus.totalParagraphs > 0 && `, paragraph ${playbackStatus.currentParagraph} of ${playbackStatus.totalParagraphs}`}
          </div>
        )}
        <div style={{ color: 'GrayText', marginTop: 6 }}>Read It posts text to the configured synthesis endpoint. The default is {DEFAULT_TTS_URL}.</div>
      </section>

      <section>
        <label htmlFor="rate" style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>Speech rate: {rate.toFixed(2)}</label>
        <input id="rate" type="range" min={0.5} max={10} step={0.05} value={rate} onChange={(event) => setRate(Number(event.target.value))} style={{ width: 360 }} />
        <div style={{ color: 'GrayText' }}>0.5 (slow) … 10.0 (max)</div>
      </section>

      <section style={{ marginTop: 24 }}>
        <label htmlFor="test" style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>Test speech</label>
        <textarea id="test" rows={3} value={testText} onChange={(event) => setTestText(event.target.value)} style={{ width: 520, padding: 8 }} />
        <div style={{ marginTop: 8 }}>
          <button onClick={handleTestSpeech} disabled={testStatus === 'sending'} style={{ padding: '8px 12px' }}>
            {testStatus === 'sending' ? 'Playing…' : 'Test speech'}
          </button>
          <span style={{ marginLeft: 12 }}>
            {testStatus === 'ok' && <span style={{ color: '#006400' }}> Completed</span>}
            {testStatus === 'error' && <span style={{ color: '#8b0000' }}> Error: {testError}</span>}
          </span>
        </div>
      </section>
    </main>
  )
}
