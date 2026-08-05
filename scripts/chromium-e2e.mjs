import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const EXTENSION_DIR = resolve(ROOT, 'dist')
const FIXTURE_PATH = resolve(ROOT, 'fixtures/playback-collision.txt')
const CHROME_PATH = process.env.CHROME_PATH || process.env.CHROMIUM_PATH || 'google-chrome'
const EXTENSION_NAME = 'Read It – Reader'
const START_PLAYBACK = 'READ_TEXT'
const PLAYBACK_STATUS = 'PLAYBACK_STATUS'
const PLAYBACK_CONTROL = 'PLAYBACK_CONTROL'
const DIAGNOSTICS = 'PLAYBACK_DIAGNOSTICS'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

async function waitFor(label, operation, timeoutMs = 30_000, intervalMs = 25) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = await operation()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await delay(intervalMs)
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError}` : ''}`)
}

function makeSilentWav(durationMs = 120, sampleRate = 8_000) {
  const sampleCount = Math.max(1, Math.floor(sampleRate * durationMs / 1_000))
  const dataLength = sampleCount * 2
  const buffer = Buffer.alloc(44 + dataLength)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataLength, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataLength, 40)
  return buffer
}

async function readJsonBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function startFakeTtsServer() {
  const requests = []
  const server = createServer(async (request, response) => {
    response.setHeader('access-control-allow-origin', '*')
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'access-control-allow-headers': 'content-type',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
      })
      response.end()
      return
    }

    if (request.method === 'GET' && request.url === '/api/ping') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true }))
      return
    }
    if (request.method === 'GET' && request.url === '/api/ready') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        ok: true,
        ready: true,
        accepting_requests: true,
        queue_capacity: 4,
        slots_in_use: 0,
        active_inference: 0,
        queued_futures: 0,
        timed_out_running: 0,
      }))
      return
    }
    if (request.method === 'GET' && request.url === '/api/voices') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ voices: ['p225'] }))
      return
    }
    if (request.method === 'POST' && request.url === '/api/tts') {
      try {
        const body = await readJsonBody(request)
        const text = String(body.text ?? '')
        const voice = String(body.voice ?? '')
        requests.push({ text, voice, receivedAtMs: performance.now() })
        const invalid = text.includes('INVALID_AUDIO_FIXTURE')
        const durationMs = text.includes('RESTART_CONTROL_FIXTURE') ? 900 : 120
        const audio = invalid ? Buffer.from('not-a-valid-wave') : makeSilentWav(durationMs)
        response.writeHead(200, {
          'content-type': 'audio/wav',
          'content-length': String(audio.length),
        })
        response.end(audio)
      } catch {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ ok: false, error: { code: 'INVALID_REQUEST', message: 'Invalid request.' } }))
      }
      return
    }

    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: false }))
  })
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  assert(address && typeof address !== 'string', 'Fake TTS server did not bind')
  return {
    requests,
    url: `http://127.0.0.1:${address.port}/api/tts`,
    close: () => new Promise((resolveClose, rejectClose) => {
      server.close((error) => (error ? rejectClose(error) : resolveClose()))
    }),
  }
}

function findDevtoolsPort(stderr) {
  const match = stderr.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)
  return match ? Number(match[1]) : null
}

async function connectCdp(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`)
  if (!response.ok) throw new Error(`DevTools version request failed with ${response.status}`)
  const version = await response.json()
  const socket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true })
    socket.addEventListener('error', rejectOpen, { once: true })
  })

  let nextId = 0
  const pending = new Map()
  socket.addEventListener('message', (message) => {
    const payload = JSON.parse(String(message.data))
    if (!payload.id) return
    const callbacks = pending.get(payload.id)
    if (!callbacks) return
    pending.delete(payload.id)
    if (payload.error) callbacks.reject(new Error(payload.error.message))
    else callbacks.resolve(payload.result)
  })

  return {
    send(method, params = {}, sessionId) {
      const id = ++nextId
      return new Promise((resolveResult, rejectResult) => {
        pending.set(id, { resolve: resolveResult, reject: rejectResult })
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
      })
    },
    close() {
      socket.close()
    },
  }
}

async function evaluate(cdp, sessionId, expression, awaitPromise = true) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  }, sessionId)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed')
  return result.result.value
}

async function sendExtensionMessage(cdp, sessionId, message) {
  return await evaluate(cdp, sessionId, `new Promise((resolve) => chrome.runtime.sendMessage(${JSON.stringify(message)}, resolve))`)
}

async function resolveExtensionId(cdp) {
  return await waitFor('extension service worker', async () => {
    const targets = await cdp.send('Target.getTargets')
    const target = targets.targetInfos.find((candidate) => (
      candidate.type === 'service_worker' && candidate.url.startsWith('chrome-extension://')
    ))
    return target ? new URL(target.url).host : null
  })
}

async function findExtensionPageTarget(cdp, extensionId, path) {
  const targets = await cdp.send('Target.getTargets')
  return targets.targetInfos.find((candidate) => (
    candidate.url === `chrome-extension://${extensionId}/${path}`
  )) ?? null
}

async function attachToTarget(cdp, targetId) {
  const attached = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  await cdp.send('Runtime.enable', {}, attached.sessionId)
  return attached.sessionId
}

async function ensureOffscreenTarget(cdp, extensionId, pageSessionId) {
  await sendExtensionMessage(cdp, pageSessionId, { kind: DIAGNOSTICS })
  return await waitFor('offscreen target', async () => (
    await findExtensionPageTarget(cdp, extensionId, 'src/offscreen.html')
  ))
}

async function findExtensionPageByMarker(cdp, extensionId, marker) {
  const targets = await cdp.send('Target.getTargets')
  for (const target of targets.targetInfos) {
    if (!target.url.startsWith(`chrome-extension://${extensionId}/`)) continue
    if (!['page', 'other'].includes(target.type)) continue
    let probeSessionId
    try {
      probeSessionId = await attachToTarget(cdp, target.targetId)
      const found = await evaluate(cdp, probeSessionId, `document.body?.textContent?.includes(${JSON.stringify(marker)}) === true`)
      if (found) return { targetId: target.targetId, sessionId: probeSessionId }
    } catch {
      // Ignore transient targets that disappear while the browser UI is moving.
    } finally {
      if (probeSessionId) {
        await cdp.send('Target.detachFromTarget', { sessionId: probeSessionId }).catch(() => undefined)
      }
    }
  }
  return null
}

async function createExtensionPage(cdp, extensionId, path = 'src/popup.html') {
  const created = await cdp.send('Target.createTarget', { url: `chrome-extension://${extensionId}/${path}` })
  const attached = await cdp.send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
  const sessionId = attached.sessionId
  await cdp.send('Runtime.enable', {}, sessionId)
  await waitFor(`extension page ${path}`, async () => (
    await evaluate(cdp, sessionId, 'document.readyState') === 'complete'
  ))
  return { targetId: created.targetId, sessionId }
}

async function setSettings(cdp, sessionId, settings) {
  await evaluate(cdp, sessionId, `chrome.storage.sync.set(${JSON.stringify(settings)})`)
}

async function queryStatus(cdp, sessionId) {
  return await sendExtensionMessage(cdp, sessionId, { kind: PLAYBACK_STATUS })
}

async function queryDiagnostics(cdp, sessionId) {
  const diagnostics = await sendExtensionMessage(cdp, sessionId, { kind: DIAGNOSTICS })
  assert(diagnostics?.ok === true, 'Playback diagnostics were unavailable in the test build')
  return diagnostics
}

async function waitForState(cdp, sessionId, playbackSessionId, states, timeoutMs = 20_000) {
  const allowed = new Set(Array.isArray(states) ? states : [states])
  return await waitFor(`session ${playbackSessionId} state ${[...allowed].join('/')}`, async () => {
    const status = await queryStatus(cdp, sessionId)
    return status?.sessionId === playbackSessionId && allowed.has(status.state) ? status : null
  }, timeoutMs)
}

function normalizeSemanticText(value) {
  return value.replace(/\s+/g, ' ').trim()
}

function assertEventIntervals(events) {
  let active = null
  for (const event of events) {
    if (event.event === 'accepted') {
      assert(active === null, `Session ${event.status.sessionId} was accepted while ${active?.chunkId} remained active`)
    }
    if (event.event === 'chunk-started') {
      assert(active === null, `Chunk ${event.chunkId} started while ${active?.chunkId} was active`)
      active = { chunkId: event.chunkId, sessionId: event.status.sessionId }
    }
    if (event.event === 'chunk-ended') {
      assert(active?.chunkId === event.chunkId, `Chunk ${event.chunkId} ended while ${active?.chunkId ?? 'none'} was active`)
      active = null
    }
    if (['completed', 'cancelled', 'superseded', 'failed'].includes(event.event)
      && active?.sessionId === event.status.sessionId) active = null
  }
  assert(active === null, `Diagnostic stream ended with ${active?.chunkId} active`)
}

function expectedGapMs(transition, rate) {
  const base = { continuation: 60, sentence: 180, paragraph: 550 }
  const minimum = { continuation: 20, sentence: 60, paragraph: 180 }
  return Math.max(minimum[transition], Math.round(base[transition] / rate))
}

function measuredTransitionGaps(events) {
  const output = []
  let ended = null
  for (const event of events) {
    if (event.event === 'chunk-ended') ended = event
    if (event.event === 'chunk-started' && ended) {
      output.push({
        transition: ended.transition,
        gapMs: event.atMs - ended.atMs,
        fromChunk: ended.chunkId,
        toChunk: event.chunkId,
      })
      ended = null
    }
  }
  return output
}

function assertPlayerDelta(before, after, expectedChunks, label) {
  assert(after.player.activePlayerCount === 0, `${label}: player remained active after terminal status`)
  assert(after.player.maxActivePlayerCount <= 1, `${label}: max active players was ${after.player.maxActivePlayerCount}`)
  assert(after.player.invariantViolationCount === 0, `${label}: player invariant violations were recorded`)
  assert(after.player.playAttemptCount - before.player.playAttemptCount === expectedChunks, `${label}: play-attempt count mismatch`)
  assert(after.player.successfulPlayStartCount - before.player.successfulPlayStartCount === expectedChunks, `${label}: successful-start count mismatch`)
  assert(after.player.settlementCount - before.player.settlementCount === expectedChunks, `${label}: settlement count mismatch`)
}

function transitionFixture() {
  const sentenceOne = `Sentence alpha ${'alpha '.repeat(45).trim()}.`
  const sentenceTwo = `Sentence beta ${'beta '.repeat(45).trim()}.`
  const oversized = `Oversized continuation begins; ${'continuation '.repeat(55).trim()}.`
  return `${sentenceOne} ${sentenceTwo}\n\n${oversized}`
}

async function runCompletedSession({ cdp, pageSessionId, fakeTts, text, source, rate, label }) {
  await setSettings(cdp, pageSessionId, { rate })
  const diagnosticsBefore = await queryDiagnostics(cdp, pageSessionId)
  const requestMarker = fakeTts.requests.length
  const start = await sendExtensionMessage(cdp, pageSessionId, { kind: START_PLAYBACK, source, text })
  assert(start?.ok === true, `${label}: playback was rejected: ${JSON.stringify(start)}`)
  const terminal = await waitForState(cdp, pageSessionId, start.sessionId, 'completed', 30_000)
  const diagnosticsAfter = await queryDiagnostics(cdp, pageSessionId)
  const events = diagnosticsAfter.events.filter((event) => event.status.sessionId === start.sessionId)
  const requests = fakeTts.requests.slice(requestMarker)

  assertEventIntervals(events)
  assert(requests.length === terminal.totalChunks, `${label}: synthesized ${requests.length}, expected ${terminal.totalChunks}`)
  assertPlayerDelta(diagnosticsBefore, diagnosticsAfter, terminal.totalChunks, label)
  return { start, terminal, events, requests, diagnosticsBefore, diagnosticsAfter }
}

async function verifyCanonicalFixture(context, fixture) {
  const result = await runCompletedSession({
    ...context,
    text: fixture,
    source: 'debug-fixture',
    rate: 4,
    label: 'canonical collision fixture',
  })
  assert(
    normalizeSemanticText(result.requests.map((request) => request.text).join(' ')) === normalizeSemanticText(fixture),
    'Canonical fixture text was dropped, duplicated, or reordered',
  )
  assert(result.requests.some((request) => request.text.includes('clause; it must not force another synthesis request.')), 'Semicolon clause was not preserved')
  assert(result.requests.some((request) => request.text.includes('3.14') && request.text.includes('1.2.3')), 'Decimal/version text was damaged')
  assert(result.requests.some((request) => request.text.includes('example.com') && request.text.includes('reader@example.com')), 'Domain/email text was damaged')
}

async function verifyPacingMatrix(context) {
  const text = transitionFixture()
  for (const rate of [0.5, 1, 2, 4, 10]) {
    const result = await runCompletedSession({
      ...context,
      text,
      source: 'debug-fixture',
      rate,
      label: `pacing rate ${rate}`,
    })
    const gaps = measuredTransitionGaps(result.events)
    const observed = new Map()
    for (const gap of gaps) {
      if (!['continuation', 'sentence', 'paragraph'].includes(gap.transition)) continue
      const required = expectedGapMs(gap.transition, rate)
      assert(gap.gapMs >= required - 20, `Rate ${rate} ${gap.transition} gap ${gap.gapMs}ms was below ${required}ms`)
      if (!observed.has(gap.transition)) observed.set(gap.transition, gap.gapMs)
    }
    for (const transition of ['continuation', 'sentence', 'paragraph']) {
      assert(observed.has(transition), `Rate ${rate} did not exercise a ${transition} transition`)
    }
    assert(observed.get('paragraph') > observed.get('sentence'), `Rate ${rate}: paragraph gap did not exceed sentence gap`)
    assert(observed.get('sentence') > observed.get('continuation'), `Rate ${rate}: sentence gap did not exceed continuation gap`)
  }
}

async function verifyMixedSourceReplacement(context) {
  const { cdp, pageSessionId } = context
  await setSettings(cdp, pageSessionId, { rate: 0.5 })
  const before = await queryDiagnostics(cdp, pageSessionId)
  const starts = []
  const sources = ['selection', 'popup-test', 'options-test', 'selection', 'debug-fixture']
  for (let index = 0; index < sources.length; index += 1) {
    const start = await sendExtensionMessage(cdp, pageSessionId, {
      kind: START_PLAYBACK,
      source: sources[index],
      text: `Replacement ${index} paragraph one.\n\nReplacement ${index} paragraph two.\n\nReplacement ${index} paragraph three.`,
    })
    assert(start?.ok === true, `Replacement ${index} was rejected`)
    starts.push(start)
    await waitForState(cdp, pageSessionId, start.sessionId, ['synthesizing', 'playing', 'waiting', 'paused'])
  }
  const latest = starts.at(-1)
  const completed = await waitForState(cdp, pageSessionId, latest.sessionId, 'completed', 30_000)
  assert(completed.source === 'debug-fixture', 'Latest replacement source was not authoritative')
  const after = await queryDiagnostics(cdp, pageSessionId)
  for (const prior of starts.slice(0, -1)) {
    const terminal = after.events.find((event) => (
      event.status.sessionId === prior.sessionId && ['superseded', 'cancelled'].includes(event.event)
    ))
    assert(terminal, `Prior session ${prior.sessionId} did not record supersession/cancellation`)
  }
  assert(after.player.activePlayerCount === 0, 'Player remained active after replacement matrix')
  assert(after.player.maxActivePlayerCount <= 1, 'Replacement matrix overlapped players')
  assert(after.player.invariantViolationCount === 0, 'Replacement matrix recorded a player invariant violation')
}

async function verifyPauseResumeCancel(context) {
  const { cdp, pageSessionId } = context
  await setSettings(cdp, pageSessionId, { rate: 0.5 })
  const before = await queryDiagnostics(cdp, pageSessionId)
  const start = await sendExtensionMessage(cdp, pageSessionId, {
    kind: START_PLAYBACK,
    source: 'debug-fixture',
    text: 'RESTART_CONTROL_FIXTURE. This chunk is intentionally long enough for pause and resume.',
  })
  assert(start?.ok === true, 'Pause/resume/cancel fixture was rejected')
  await waitForState(cdp, pageSessionId, start.sessionId, 'playing')

  const paused = await sendExtensionMessage(cdp, pageSessionId, {
    kind: PLAYBACK_CONTROL,
    action: 'pause',
    expectedSessionId: start.sessionId,
  })
  assert(paused?.ok === true && paused.state === 'paused', 'Pause command was not acknowledged')
  await delay(150)
  const pausedStatus = await queryStatus(cdp, pageSessionId)
  assert(pausedStatus.state === 'paused', 'Paused session advanced unexpectedly')

  const resumed = await sendExtensionMessage(cdp, pageSessionId, {
    kind: PLAYBACK_CONTROL,
    action: 'resume',
    expectedSessionId: start.sessionId,
  })
  assert(resumed?.ok === true, 'Resume command was not acknowledged')
  await waitForState(cdp, pageSessionId, start.sessionId, 'playing')

  const cancelled = await sendExtensionMessage(cdp, pageSessionId, {
    kind: PLAYBACK_CONTROL,
    action: 'cancel',
    expectedSessionId: start.sessionId,
  })
  assert(cancelled?.ok === true && cancelled.state === 'cancelled', 'Cancel command was not acknowledged')
  await waitForState(cdp, pageSessionId, start.sessionId, 'cancelled')

  const after = await queryDiagnostics(cdp, pageSessionId)
  assert(after.player.activePlayerCount === 0, 'Player remained active after cancel')
  assert(after.player.maxActivePlayerCount <= 1, 'Pause/resume/cancel overlapped players')
  assert(after.player.invariantViolationCount === 0, 'Pause/resume/cancel recorded a player invariant violation')
  assert(after.player.playAttemptCount - before.player.playAttemptCount === 1, 'Pause/resume unexpectedly created another play attempt')
  assert(after.player.successfulPlayStartCount - before.player.successfulPlayStartCount === 1, 'Pause/resume unexpectedly created another successful start')
  assert(after.player.settlementCount - before.player.settlementCount === 1, 'Pause/resume/cancel settlement count mismatch')
}

async function verifyInvalidAudioFailure(context) {
  const { cdp, pageSessionId } = context
  const before = await queryDiagnostics(cdp, pageSessionId)
  const start = await sendExtensionMessage(cdp, pageSessionId, {
    kind: START_PLAYBACK,
    source: 'debug-fixture',
    text: 'INVALID_AUDIO_FIXTURE.',
  })
  assert(start?.ok === true, 'Invalid-audio fixture was rejected before playback')
  const failed = await waitForState(cdp, pageSessionId, start.sessionId, 'failed')
  assert(failed.error?.code === 'AUDIO_PLAYBACK_FAILED', `Unexpected invalid-audio error ${failed.error?.code}`)
  const after = await queryDiagnostics(cdp, pageSessionId)
  assert(after.player.activePlayerCount === 0, 'Player remained active after invalid audio')
  assert(after.player.maxActivePlayerCount <= 1, 'Invalid audio overlapped players')
  assert(after.player.invariantViolationCount === 0, 'Invalid audio recorded a player invariant violation')
  assert(after.player.playAttemptCount - before.player.playAttemptCount === 1, 'Invalid audio did not produce exactly one play attempt')
  assert(after.player.successfulPlayStartCount - before.player.successfulPlayStartCount === 0, 'Invalid audio reported a successful start')
  assert(after.player.settlementCount - before.player.settlementCount === 1, 'Invalid audio did not settle exactly once')
}

async function verifyImmediateReplacement(context) {
  const { cdp, pageSessionId } = context
  await setSettings(cdp, pageSessionId, { rate: 0.5 })
  const before = await queryDiagnostics(cdp, pageSessionId)
  const first = await sendExtensionMessage(cdp, pageSessionId, {
    kind: START_PLAYBACK,
    source: 'selection',
    text: 'RESTART_CONTROL_FIXTURE. First session must be superseded immediately.',
  })
  assert(first?.ok === true, 'First immediate-replacement session was rejected')
  await waitForState(cdp, pageSessionId, first.sessionId, 'playing')
  const second = await sendExtensionMessage(cdp, pageSessionId, {
    kind: START_PLAYBACK,
    source: 'popup-test',
    text: 'Second session should replace the first without overlap.',
  })
  assert(second?.ok === true, 'Second immediate-replacement session was rejected')
  const completed = await waitForState(cdp, pageSessionId, second.sessionId, 'completed')
  assert(completed.source === 'popup-test', 'Replacement session source was not authoritative')

  const after = await queryDiagnostics(cdp, pageSessionId)
  const superseded = after.events.find((event) => event.status.sessionId === first.sessionId && event.event === 'superseded')
  assert(superseded, 'First session did not emit superseded')
  assert(after.player.activePlayerCount === 0, 'Player remained active after immediate replacement')
  assert(after.player.maxActivePlayerCount <= 1, 'Immediate replacement overlapped players')
  assert(after.player.invariantViolationCount === 0, 'Immediate replacement recorded a player invariant violation')
  assert(after.player.playAttemptCount - before.player.playAttemptCount === 2, 'Immediate replacement play-attempt count mismatch')
  assert(after.player.successfulPlayStartCount - before.player.successfulPlayStartCount === 2, 'Immediate replacement successful-start count mismatch')
  assert(after.player.settlementCount - before.player.settlementCount === 2, 'Immediate replacement settlement count mismatch')
}

async function verifyOneShotRestart(context) {
  const { cdp, pageSessionId } = context
  await setSettings(cdp, pageSessionId, { rate: 0.5 })
  const before = await queryDiagnostics(cdp, pageSessionId)
  const first = await sendExtensionMessage(cdp, pageSessionId, {
    kind: START_PLAYBACK,
    source: 'debug-fixture',
    text: 'RESTART_CONTROL_FIXTURE. First restart session.',
  })
  assert(first?.ok === true, 'First restart session was rejected')
  await waitForState(cdp, pageSessionId, first.sessionId, 'playing')
  const cancelled = await sendExtensionMessage(cdp, pageSessionId, {
    kind: PLAYBACK_CONTROL,
    action: 'cancel',
    expectedSessionId: first.sessionId,
  })
  assert(cancelled?.ok === true, 'Restart cancel was not acknowledged')
  await waitForState(cdp, pageSessionId, first.sessionId, 'cancelled')

  const second = await sendExtensionMessage(cdp, pageSessionId, {
    kind: START_PLAYBACK,
    source: 'debug-fixture',
    text: 'Second restart session must complete cleanly.',
  })
  assert(second?.ok === true, 'Second restart session was rejected')
  await waitForState(cdp, pageSessionId, second.sessionId, 'completed')

  const after = await queryDiagnostics(cdp, pageSessionId)
  assert(after.player.activePlayerCount === 0, 'Player remained active after restart')
  assert(after.player.maxActivePlayerCount <= 1, 'Restart sequence overlapped players')
  assert(after.player.invariantViolationCount === 0, 'Restart sequence recorded a player invariant violation')
  assert(after.player.playAttemptCount - before.player.playAttemptCount === 2, 'Restart sequence play-attempt count mismatch')
  assert(after.player.successfulPlayStartCount - before.player.successfulPlayStartCount === 2, 'Restart sequence successful-start count mismatch')
  assert(after.player.settlementCount - before.player.settlementCount === 2, 'Restart sequence settlement count mismatch')
}

async function verifyDiagnosticFailure(context) {
  const { cdp, pageSessionId } = context
  const response = await sendExtensionMessage(cdp, pageSessionId, { kind: DIAGNOSTICS, forceError: true })
  assert(response?.ok === false, 'Forced diagnostics failure did not return a typed failure')
  assert(response.error?.code === 'DIAGNOSTICS_FAILED', `Unexpected diagnostics failure code ${response.error?.code}`)
}

async function main() {
  const profileDir = await mkdtemp(resolve(tmpdir(), 'chrome-readit-e2e-'))
  const fakeTts = await startFakeTtsServer()
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    `--disable-extensions-except=${EXTENSION_DIR}`,
    `--load-extension=${EXTENSION_DIR}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })

  let stderr = ''
  chrome.stderr.setEncoding('utf8')
  chrome.stderr.on('data', (chunk) => {
    stderr += chunk
    process.stderr.write(chunk)
  })

  let cdp
  try {
    const port = await waitFor('DevTools port', async () => findDevtoolsPort(stderr), 20_000, 50)
    cdp = await connectCdp(port)
    const extensionId = await resolveExtensionId(cdp)
    const page = await createExtensionPage(cdp, extensionId)
    await setSettings(cdp, page.sessionId, { ttsUrl: fakeTts.url, voice: 'p225', rate: 1 })
    await ensureOffscreenTarget(cdp, extensionId, page.sessionId)
    const fixture = await readFile(FIXTURE_PATH, 'utf8')

    const context = { cdp, extensionId, pageSessionId: page.sessionId, fakeTts }
    await verifyCanonicalFixture(context, fixture)
    await verifyPacingMatrix(context)
    await verifyMixedSourceReplacement(context)
    await verifyPauseResumeCancel(context)
    await verifyInvalidAudioFailure(context)
    await verifyImmediateReplacement(context)
    await verifyOneShotRestart(context)
    await verifyDiagnosticFailure(context)

    const diagnostics = await queryDiagnostics(cdp, page.sessionId)
    assert(diagnostics.player.activePlayerCount === 0, 'Final diagnostics reported an active player')
    assert(diagnostics.player.maxActivePlayerCount <= 1, 'Final diagnostics reported overlapping players')
    assert(diagnostics.player.invariantViolationCount === 0, 'Final diagnostics reported player invariant violations')
    console.log(JSON.stringify({
      ok: true,
      extensionId,
      requests: fakeTts.requests.length,
      player: diagnostics.player,
      cleanup: { profileDir },
    }, null, 2))
  } finally {
    cdp?.close()
    chrome.kill('SIGTERM')
    await new Promise((resolveExit) => {
      const timer = setTimeout(resolveExit, 2_000)
      chrome.once('exit', () => {
        clearTimeout(timer)
        resolveExit()
      })
    })
    await fakeTts.close()
    await rm(profileDir, { recursive: true, force: true })
  }
}

await main()
