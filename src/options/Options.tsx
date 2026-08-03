import { useEffect, useMemo, useRef, useState } from 'react'
import { DEBUG_PARAGRAPH_FIXTURE } from '../lib/debug-fixtures'
import {
  isPlaybackEvent,
  type PlaybackControlAction,
  type PlaybackStatus,
} from '../lib/playback-protocol'
import {
  queryPlaybackStatus,
  requestReadText,
  sendPlaybackControl,
} from '../lib/playback-runtime-client'
import {
  DEFAULT_SETTINGS,
  DEFAULT_TTS_URL,
  getSettingsResult,
  isValidTtsUrl,
  saveSettings,
  type Settings,
} from '../lib/storage'
import { fetchServerVoices, type VoiceOption } from '../lib/voices'

function isCancellable(status: PlaybackStatus | null): boolean {
  return status !== null
    && status.sessionId !== null
    && !['idle', 'completed', 'cancelled', 'failed'].includes(status.state)
}

function isPausable(status: PlaybackStatus | null): boolean {
  return isCancellable(status) && status.state !== 'paused'
}

export default function Options() {
  const showDebugFixture = import.meta.env.DEV
  const [voice, setVoice] = useState(DEFAULT_SETTINGS.voice)
  const [rate, setRate] = useState(DEFAULT_SETTINGS.rate)
  const [loaded, setLoaded] = useState(false)
  const [settingsWarning, setSettingsWarning] = useState<string | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [testText, setTestText] = useState('Hello — this is a quick test of Read It.')
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle')
  const [testError, setTestError] = useState<string | null>(null)
  const [playbackStatus, setPlaybackStatus] = useState<PlaybackStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [controlError, setControlError] = useState<string | null>(null)
  const [ttsUrl, setTtsUrl] = useState(DEFAULT_SETTINGS.ttsUrl)
  const [ttsUrlDraft, setTtsUrlDraft] = useState(DEFAULT_SETTINGS.ttsUrl)
  const [ttsUrlError, setTtsUrlError] = useState<string | null>(null)
  const [voicesList, setVoicesList] = useState<VoiceOption[]>([])
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [serverHealth, setServerHealth] = useState<'unknown' | 'ok' | 'error'>('unknown')
  const [serverTesting, setServerTesting] = useState(false)
  const [serverTestError, setServerTestError] = useState<string | null>(null)
  const persistedSettingsRef = useRef<Settings>(DEFAULT_SETTINGS)
  const testSessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    let mounted = true
    void getSettingsResult().then(({ settings, warnings }) => {
      if (!mounted) return
      persistedSettingsRef.current = settings
      setRate(settings.rate)
      setVoice(settings.voice)
      setTtsUrl(settings.ttsUrl)
      setTtsUrlDraft(settings.ttsUrl)
      setSettingsWarning(warnings.map((warning) => warning.message).join(' ') || null)
      setLoaded(true)
    }).catch(() => {
      if (!mounted) return
      setSettingsError('Settings could not be loaded. Reload the extension and try again.')
      setLoaded(true)
    })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (!loaded || rate === persistedSettingsRef.current.rate) return
    let mounted = true
    const timeoutId = window.setTimeout(() => {
      void saveSettings({ rate }).then(() => {
        if (!mounted) return
        persistedSettingsRef.current = { ...persistedSettingsRef.current, rate }
        setSettingsError(null)
      }).catch(() => {
        if (mounted) setSettingsError('The playback rate could not be saved. Change it again to retry.')
      })
    }, 200)
    return () => {
      mounted = false
      window.clearTimeout(timeoutId)
    }
  }, [rate, loaded])

  useEffect(() => {
    if (!loaded || voice === persistedSettingsRef.current.voice) return
    let mounted = true
    void saveSettings({ voice }).then(() => {
      if (!mounted) return
      persistedSettingsRef.current = { ...persistedSettingsRef.current, voice }
      setSettingsError(null)
    }).catch(() => {
      if (mounted) setSettingsError('The selected voice could not be saved. Select it again to retry.')
    })
    return () => { mounted = false }
  }, [voice, loaded])

  useEffect(() => {
    if (!ttsUrl) return
    let mounted = true
    void fetchServerVoices(ttsUrl).then((result) => {
      if (!mounted) return
      if (result.ok) {
        setVoicesList(result.voices)
        setVoiceError(null)
      } else {
        setVoicesList([])
        setVoiceError(result.error.message)
      }
    })
    return () => { mounted = false }
  }, [ttsUrl])

  useEffect(() => {
    let mounted = true
    const applyStatus = (status: PlaybackStatus) => {
      if (!mounted) return
      setPlaybackStatus(status)
      setStatusError(status.persistenceDegraded
        ? 'Playback is working, but restart-safe status persistence is unavailable.'
        : null)

      const trackedSessionId = testSessionIdRef.current
      if (!trackedSessionId) return
      if (status.sessionId !== trackedSessionId) {
        if (!['idle', 'completed', 'cancelled', 'failed'].includes(status.state)) {
          testSessionIdRef.current = null
          setTestStatus('error')
          setTestError('Test speech was superseded by another playback request.')
        }
        return
      }
      if (status.state === 'completed') {
        testSessionIdRef.current = null
        setTestStatus('ok')
        setTestError(null)
      } else if (status.state === 'failed' || status.state === 'cancelled') {
        testSessionIdRef.current = null
        setTestStatus('error')
        setTestError(status.error?.message ?? 'Test speech failed or was cancelled.')
      } else {
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
    void queryPlaybackStatus().then((result) => {
      if (!mounted) return
      if (result.ok) applyStatus(result.status)
      else setStatusError(result.error.message)
    })

    return () => {
      mounted = false
      chrome.runtime.onMessage.removeListener?.(listener)
    }
  }, [])

  const voiceOptions = useMemo(() => {
    if (voicesList.some((option) => option.name === voice)) return voicesList
    return [{ name: voice, label: voice }, ...voicesList]
  }, [voice, voicesList])

  async function commitTtsUrl(candidate: string) {
    const trimmed = candidate.trim()
    if (!isValidTtsUrl(trimmed)) {
      setTtsUrlError('Enter a valid HTTP or HTTPS synthesis endpoint.')
      return
    }
    try {
      await saveSettings({ ttsUrl: trimmed })
      persistedSettingsRef.current = { ...persistedSettingsRef.current, ttsUrl: trimmed }
      setTtsUrl(trimmed)
      setTtsUrlDraft(trimmed)
      setTtsUrlError(null)
      setSettingsError(null)
      setServerHealth('unknown')
    } catch {
      setTtsUrlError('The TTS endpoint could not be saved. Try again.')
    }
  }

  async function handleControl(action: PlaybackControlAction) {
    setControlError(null)
    const response = await sendPlaybackControl(action, playbackStatus?.sessionId ?? undefined)
    if (!response.ok) {
      setControlError(response.error.message)
      return
    }
    setPlaybackStatus((current) => current ? { ...current, state: response.state } : current)
  }

  async function handleDebugFixture() {
    const response = await requestReadText(DEBUG_PARAGRAPH_FIXTURE, 'debug-fixture')
    if (!response.ok) setControlError(response.error.message)
  }

  async function handleTestSpeech() {
    const text = testText.trim()
    if (!text || testStatus === 'sending') return
    setTestStatus('sending')
    setTestError(null)
    const response = await requestReadText(text, 'options-test')
    if (!response.ok) {
      testSessionIdRef.current = null
      setTestStatus('error')
      setTestError(response.error.message)
      return
    }
    testSessionIdRef.current = response.sessionId
  }

  async function testServer() {
    setServerTesting(true)
    setServerTestError(null)
    try {
      const response = await chrome.runtime.sendMessage({ action: 'probe-tts' })
      if (response?.ok) setServerHealth('ok')
      else {
        setServerHealth('error')
        setServerTestError(typeof response?.error === 'string' ? response.error : 'Server unavailable.')
      }
    } catch {
      setServerHealth('error')
      setServerTestError('The server test could not be completed.')
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
        {voiceError && <div role="alert" style={{ color: '#8b0000' }}>{voiceError}</div>}
      </section>

      <section style={{ marginTop: 24 }}>
        <label htmlFor="ttsUrl" style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>TTS synthesis endpoint</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            id="ttsUrl"
            type="text"
            value={ttsUrlDraft}
            onChange={(event) => setTtsUrlDraft(event.target.value)}
            style={{ width: 440, padding: 8 }}
            placeholder={DEFAULT_TTS_URL}
            aria-invalid={Boolean(ttsUrlError)}
          />
          <button onClick={() => commitTtsUrl(ttsUrlDraft)} style={{ padding: '8px 10px' }}>Save endpoint</button>
          <button onClick={() => commitTtsUrl(DEFAULT_TTS_URL)} style={{ padding: '8px 10px' }}>Use local default</button>
        </div>
        <div style={{ color: 'GrayText', marginTop: 6 }}>Saved endpoint: {ttsUrl}</div>
        {ttsUrlError && <div role="alert" style={{ color: '#8b0000', marginTop: 6 }}>{ttsUrlError}</div>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <button onClick={testServer} disabled={serverTesting} style={{ padding: '6px 10px' }}>{serverTesting ? 'Testing…' : 'Test server'}</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 12, height: 12, borderRadius: 12, background: serverHealth === 'ok' ? '#00c853' : serverHealth === 'error' ? '#d50000' : '#bdbdbd' }} />
            <div style={{ color: serverHealth === 'ok' ? '#006400' : serverHealth === 'error' ? '#8b0000' : 'GrayText' }}>
              {serverHealth === 'ok' ? 'Server accepting requests' : serverHealth === 'error' ? `Server error${serverTestError ? `: ${serverTestError}` : ''}` : 'Server status unknown'}
            </div>
          </div>
          <button onClick={() => handleControl('pause')} disabled={!isPausable(playbackStatus)} style={{ padding: '6px 10px' }}>Pause</button>
          <button onClick={() => handleControl('resume')} disabled={playbackStatus?.state !== 'paused'} style={{ padding: '6px 10px' }}>Resume</button>
          <button onClick={() => handleControl('cancel')} disabled={!isCancellable(playbackStatus)} style={{ padding: '6px 10px' }}>Stop</button>
          {showDebugFixture && <button onClick={handleDebugFixture} style={{ padding: '6px 10px' }}>Debug paragraph transitions</button>}
        </div>
        {playbackStatus && (
          <div aria-live="polite" style={{ color: 'GrayText', marginTop: 8 }}>
            Playback: {playbackStatus.state}
            {playbackStatus.totalChunks > 0 && ` — chunk ${playbackStatus.currentChunk} of ${playbackStatus.totalChunks}`}
            {playbackStatus.totalParagraphs > 0 && `, paragraph ${playbackStatus.currentParagraph} of ${playbackStatus.totalParagraphs}`}
          </div>
        )}
        {controlError && <div role="alert" style={{ color: '#8b0000', marginTop: 8 }}>{controlError}</div>}
        {statusError && <div role="alert" style={{ color: '#8b0000', marginTop: 8 }}>{statusError}</div>}
        <div style={{ color: 'GrayText', marginTop: 6 }}>Read It posts selected text to the saved synthesis endpoint.</div>
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
          <span aria-live="polite" style={{ marginLeft: 12 }}>
            {testStatus === 'ok' && <span style={{ color: '#006400' }}> Completed</span>}
            {testStatus === 'error' && <span role="alert" style={{ color: '#8b0000' }}> Error: {testError}</span>}
          </span>
        </div>
      </section>

      {settingsWarning && <div role="status" style={{ marginTop: 16, color: '#7a4b00' }}>{settingsWarning}</div>}
      {settingsError && <div role="alert" style={{ marginTop: 16, color: '#8b0000' }}>{settingsError}</div>}
    </main>
  )
}
