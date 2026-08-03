import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DEBUG_PARAGRAPH_FIXTURE } from '../lib/debug-fixtures'
import {
  isPlaybackEvent,
  type PlaybackControlAction,
  type PlaybackStatus,
} from '../lib/playback-protocol'
import {
  queryPlaybackStatus,
  requestReadSelection,
  requestReadText,
  sendPlaybackControl,
} from '../lib/playback-runtime-client'
import { DEFAULT_SETTINGS, getSettingsResult, saveSettings, type Settings } from '../lib/storage'
import { fetchServerVoices, type VoiceOption } from '../lib/voices'

const ACTIVE_TEST_STATUS_POLL_MS = 100
const TEST_SPEECH_SUPERSEDED_MESSAGE = 'Test speech was superseded by another playback request.'

function isTerminalStatus(status: PlaybackStatus): boolean {
  return ['idle', 'completed', 'cancelled', 'failed'].includes(status.state)
}

function isCancellable(status: PlaybackStatus | null): boolean {
  return status !== null
    && status.sessionId !== null
    && !isTerminalStatus(status)
}

function isPausable(status: PlaybackStatus | null): boolean {
  return status !== null && isCancellable(status) && status.state !== 'paused'
}

export default function Popup() {
  const showDebugFixture = import.meta.env.DEV
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [rate, setRate] = useState(DEFAULT_SETTINGS.rate)
  const [voice, setVoice] = useState<string>(DEFAULT_SETTINGS.voice)
  const [ttsUrl, setTtsUrl] = useState(DEFAULT_SETTINGS.ttsUrl)
  const [ttsServerUp, setTtsServerUp] = useState<boolean | null>(null)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [settingsWarning, setSettingsWarning] = useState<string | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [controlError, setControlError] = useState<string | null>(null)
  const [tryText, setTryText] = useState<string>('Hello from the popup')
  const [tryStatus, setTryStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle')
  const [tryError, setTryError] = useState<string | null>(null)
  const [playbackStatus, setPlaybackStatus] = useState<PlaybackStatus | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const persistedSettingsRef = useRef<Settings>(DEFAULT_SETTINGS)
  const latestPlaybackStatusRef = useRef<PlaybackStatus | null>(null)
  const testSessionIdRef = useRef<string | null>(null)
  const testRequestBaselineSessionIdRef = useRef<string | null>(null)
  const nextTestRequestEpochRef = useRef(0)
  const pendingTestRequestEpochRef = useRef<number | null>(null)
  const completionTimerRef = useRef<number | null>(null)

  useEffect(() => {
    let mounted = true
    void getSettingsResult().then(({ settings, warnings }) => {
      if (!mounted) return
      persistedSettingsRef.current = settings
      setRate(settings.rate)
      setVoice(settings.voice)
      setTtsUrl(settings.ttsUrl)
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
        setVoices(result.voices)
        setVoiceError(null)
      } else {
        setVoices([])
        setVoiceError(result.error.message)
      }
    })
    return () => { mounted = false }
  }, [ttsUrl])

  useEffect(() => {
    let mounted = true
    let pollInFlight = false

    const clearTrackedTest = () => {
      testSessionIdRef.current = null
      testRequestBaselineSessionIdRef.current = null
      pendingTestRequestEpochRef.current = null
    }

    const applyStatus = (status: PlaybackStatus) => {
      if (!mounted) return
      latestPlaybackStatusRef.current = status
      setPlaybackStatus(status)
      setStatusError(status.persistenceDegraded
        ? 'Playback is working, but restart-safe status persistence is unavailable.'
        : null)

      let trackedSessionId = testSessionIdRef.current
      if (!trackedSessionId && pendingTestRequestEpochRef.current !== null) {
        if (status.source === 'popup-test' && status.sessionId !== null) {
          trackedSessionId = status.sessionId
          testSessionIdRef.current = trackedSessionId
        } else if (status.sessionId !== null
          && status.sessionId !== testRequestBaselineSessionIdRef.current) {
          clearTrackedTest()
          setTryStatus('error')
          setTryError(TEST_SPEECH_SUPERSEDED_MESSAGE)
          return
        }
      }
      if (!trackedSessionId) return

      if (status.sessionId !== trackedSessionId) {
        if (!isTerminalStatus(status)) {
          clearTrackedTest()
          setTryStatus('error')
          setTryError(TEST_SPEECH_SUPERSEDED_MESSAGE)
        }
        return
      }

      if (completionTimerRef.current !== null) {
        window.clearTimeout(completionTimerRef.current)
        completionTimerRef.current = null
      }
      if (status.state === 'completed') {
        clearTrackedTest()
        setTryStatus('ok')
        setTryError(null)
        completionTimerRef.current = window.setTimeout(() => {
          if (mounted) setTryStatus('idle')
          completionTimerRef.current = null
        }, 1200)
      } else if (status.state === 'failed' || status.state === 'cancelled') {
        clearTrackedTest()
        setTryStatus('error')
        setTryError(status.error?.code === 'SESSION_SUPERSEDED'
          ? TEST_SPEECH_SUPERSEDED_MESSAGE
          : status.error?.message ?? 'Test speech failed or was cancelled.')
      } else {
        setTryStatus('sending')
        setTryError(null)
      }
    }

    const pollStatus = async (force = false) => {
      if (!mounted || pollInFlight) return
      if (!force
        && pendingTestRequestEpochRef.current === null
        && testSessionIdRef.current === null) return
      pollInFlight = true
      try {
        const result = await queryPlaybackStatus()
        if (!mounted) return
        if (result.ok) applyStatus(result.status)
        else setStatusError(result.error.message)
      } finally {
        pollInFlight = false
      }
    }

    const listener = (message: unknown) => {
      if (!isPlaybackEvent(message)) return false
      applyStatus(message.status)
      return false
    }
    chrome.runtime.onMessage.addListener(listener)
    void pollStatus(true)
    const pollIntervalId = window.setInterval(() => {
      void pollStatus()
    }, ACTIVE_TEST_STATUS_POLL_MS)

    return () => {
      mounted = false
      window.clearInterval(pollIntervalId)
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
          if (!mounted) return
          if (chrome.runtime.lastError) {
            setTtsServerUp(false)
            return
          }
          setTtsServerUp(Boolean(response?.ok))
        })
      } catch {
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

  async function handleReadSelection() {
    const response = await requestReadSelection()
    if (response.ok) {
      setReadError(null)
      return
    }
    setReadError(response.error.message)
  }

  async function handleDebugFixture() {
    const response = await requestReadText(DEBUG_PARAGRAPH_FIXTURE, 'debug-fixture')
    setReadError(response.ok ? null : response.error.message)
  }

  async function handleTrySpeech() {
    const text = tryText.trim()
    if (!text || tryStatus === 'sending') return
    const requestEpoch = ++nextTestRequestEpochRef.current
    pendingTestRequestEpochRef.current = requestEpoch
    testSessionIdRef.current = null
    testRequestBaselineSessionIdRef.current = latestPlaybackStatusRef.current?.sessionId ?? null
    setTryStatus('sending')
    setTryError(null)
    const response = await requestReadText(text, 'popup-test')
    if (pendingTestRequestEpochRef.current !== requestEpoch) return
    if (!response.ok) {
      pendingTestRequestEpochRef.current = null
      testSessionIdRef.current = null
      testRequestBaselineSessionIdRef.current = null
      setTryStatus('error')
      setTryError(response.error.message)
      return
    }
    testSessionIdRef.current = response.sessionId
    testRequestBaselineSessionIdRef.current = null
    pendingTestRequestEpochRef.current = null
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
        {voiceError && <div role="alert" style={{ color: '#8b0000' }}>{voiceError}</div>}
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
        <div aria-live="polite">
          {tryStatus === 'ok' && <div style={{ color: '#006400', marginTop: 8 }}>Test speech completed.</div>}
          {tryStatus === 'error' && <div role="alert" style={{ color: '#8b0000', marginTop: 8 }}>{tryError ?? 'Test speech failed.'}</div>}
        </div>
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
          <button onClick={() => handleControl('pause')} disabled={!isPausable(playbackStatus)} style={{ padding: '8px 10px', flex: 1 }}>Pause</button>
          <button onClick={() => handleControl('resume')} disabled={playbackStatus?.state !== 'paused'} style={{ padding: '8px 10px', flex: 1 }}>Resume</button>
          <button onClick={() => handleControl('cancel')} disabled={!isCancellable(playbackStatus)} style={{ padding: '8px 10px', flex: 1 }}>Cancel</button>
        </div>
        {controlError && <div role="alert" style={{ color: '#8b0000', marginTop: 8 }}>{controlError}</div>}
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
      {settingsWarning && <div role="status" style={{ marginTop: 8, color: '#7a4b00' }}>{settingsWarning}</div>}
      {settingsError && <div role="alert" style={{ marginTop: 8, color: '#8b0000' }}>{settingsError}</div>}
      {statusError && <div role="alert" style={{ marginTop: 8, color: '#8b0000' }}>{statusError}</div>}
      {readError && (
        <div role="alert" style={{ marginTop: 12, padding: 8, background: '#fff4f4', color: '#8b0000', borderRadius: 4 }}>
          {readError}
        </div>
      )}
    </div>
  )
}

const root = document.getElementById('root')
if (root) createRoot(root).render(<Popup />)
