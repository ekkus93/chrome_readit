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
    response.end(JSON.stringify({ error: 'not found' }))
  })

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  assert(address && typeof address === 'object', 'Fake TTS server did not expose an address')
  return {
    port: address.port,
    requests,
    close: () => new Promise((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose())
    }),
  }
}

class CdpConnection {
  constructor(url) {
    this.url = url
    this.socket = null
    this.nextId = 1
    this.pending = new Map()
  }

  async connect() {
    assert(typeof WebSocket === 'function', 'Node.js WebSocket support is unavailable')
    this.socket = new WebSocket(this.url)
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (!message.id) return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(`${message.error.code}: ${message.error.message}`))
      else pending.resolve(message.result)
    })
    this.socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('CDP connection closed'))
      this.pending.clear()
    })
    await new Promise((resolveOpen, rejectOpen) => {
      this.socket.addEventListener('open', resolveOpen, { once: true })
      this.socket.addEventListener('error', rejectOpen, { once: true })
    })
  }

  send(method, params = {}, sessionId) {
    assert(this.socket?.readyState === WebSocket.OPEN, 'CDP connection is not open')
    const id = this.nextId++
    const message = { id, method, params, ...(sessionId ? { sessionId } : {}) }
    return new Promise((resolveMessage, rejectMessage) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        rejectMessage(new Error(`CDP command timed out: ${method}`))
      }, 15_000)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout)
          resolveMessage(value)
        },
        reject: (error) => {
          clearTimeout(timeout)
          rejectMessage(error)
        },
      })
      this.socket.send(JSON.stringify(message))
    })
  }

  close() {
    this.socket?.close()
  }
}

async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`)
  if (!response.ok) throw new Error(`Unable to list Chrome targets: HTTP ${response.status}`)
  return await response.json()
}

async function launchChrome() {
  const profileDirectory = await mkdtemp(resolve(tmpdir(), 'chrome-readit-e2e-'))
  const stderr = []
  const chromeProcess = spawn(CHROME_PATH, [
    `--user-data-dir=${profileDirectory}`,
    `--disable-extensions-except=${EXTENSION_DIR}`,
    `--load-extension=${EXTENSION_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-sync',
    '--metrics-recording-only',
    '--autoplay-policy=no-user-gesture-required',
    '--remote-debugging-port=0',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  chromeProcess.stderr.setEncoding('utf8')
  chromeProcess.stderr.on('data', (chunk) => {
    stderr.push(chunk)
    if (stderr.join('').length > 30_000) stderr.shift()
  })

  const activePort = await waitFor('Chrome DevTools port', async () => {
    const text = await readFile(resolve(profileDirectory, 'DevToolsActivePort'), 'utf8')
    const [portLine, browserPath] = text.trim().split('\n')
    const port = Number(portLine)
    return Number.isInteger(port) && browserPath ? { port, browserPath } : null
  })

  return {
    ...activePort,
    process: chromeProcess,
    profileDirectory,
    stderr,
    async close() {
      chromeProcess.kill('SIGTERM')
      await Promise.race([
        new Promise((resolveExit) => chromeProcess.once('exit', resolveExit)),
        delay(3_000).then(() => chromeProcess.kill('SIGKILL')),
      ])
      await rm(profileDirectory, { recursive: true, force: true })
    },
  }
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  }, sessionId)
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  }
  return result.result?.value
}

async function sendExtensionMessage(cdp, sessionId, message) {
  return await evaluate(
    cdp,
    sessionId,
    `(async () => await chrome.runtime.sendMessage(${JSON.stringify(message)}))()`,
  )
}

async function findReadItWorkerTarget(cdp, port) {
  const targets = await listTargets(port)
  const workers = targets.filter((target) => (
    target.type === 'service_worker' && String(target.url).startsWith('chrome-extension://')
  ))

  for (const target of workers) {
    let probeSessionId
    try {
      const attached = await cdp.send('Target.attachToTarget', {
        targetId: target.id,
        flatten: true,
      })
      probeSessionId = attached.sessionId
      await cdp.send('Runtime.enable', {}, probeSessionId)
      const name = await evaluate(cdp, probeSessionId, 'chrome.runtime?.getManifest?.().name')
      if (name === EXTENSION_NAME) return target
    } catch {
      // Unrelated or disappearing extension targets are expected while Chrome
      // starts; final target discovery remains fail-closed through waitFor.
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
  const base = { continuation: 60, sentence: 180, paragraph: 275 }
  const minimum = { continuation: 20, sentence: 60, paragraph: 90 }
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
    assert(start?.ok === true, `Replacement ${index} failed to start`)
    starts.push(start)
    await waitForState(cdp, pageSessionId, start.sessionId, ['synthesizing', 'playing', 'waiting'])
  }
  await waitForState(cdp, pageSessionId, starts.at(-1).sessionId, 'completed')
  const after = await queryDiagnostics(cdp, pageSessionId)
  const marker = before.events.length
  const events = after.events.slice(marker)
  assertEventIntervals(events)
  assert(after.player.maxActivePlayerCount <= 1, 'Mixed replacement exceeded one active player')
  assert(after.player.invariantViolationCount === 0, 'Mixed replacement recorded a player invariant violation')
  for (const old of starts.slice(0, -1)) {
    assert(events.some((event) => event.event === 'superseded' && event.status.sessionId === old.sessionId), `Session ${old.sessionId} lacked superseded event`)
    assert(!events.some((event) => event.event === 'completed' && event.status.sessionId === old.sessionId), `Superseded session ${old.sessionId} completed`)
  }
}

async function verifyInvalidAudioFailure(context) {
  const { cdp, pageSessionId } = context
  const before = await queryDiagnostics(cdp, pageSessionId)
  const start = await sendExtensionMessage(cdp, pageSessionId, {
    kind: START_PLAYBACK,
    source: 'debug-fixture',
    text: 'INVALID_AUDIO_FIXTURE.',
  })
  assert(start?.ok === true, 'Invalid-audio session was not accepted')
  const failed = await waitForState(cdp, pageSessionId, start.sessionId, 'failed')
  assert(['AUDIO_PLAYBACK_FAILED', 'INTERNAL_PLAYBACK_ERROR'].includes(failed.error?.code), `Unexpected invalid-audio error ${failed.error?.code}`)
  const after = await queryDiagnostics(cdp, pageSessionId)
  assert(after.player.activePlayerCount === 0, 'Invalid audio left a player active')
  assert(after.player.maxActivePlayerCount <= 1, 'Invalid audio exceeded one active player')
  assert(after.player.settlementCount - before.player.settlementCount === 1, 'Invalid audio was not settled exactly once')
}

async function terminateWorker(cdp, chromePort, extensionId) {
  const worker = (await listTargets(chromePort)).find((target) => (
    target.type === 'service_worker' && String(target.url).startsWith(`chrome-extension://${extensionId}/`)
  ))
  assert(worker, 'Unable to find the active service worker target')
  const closed = await cdp.send('Target.closeTarget', { targetId: worker.id })
  assert(closed.success === true, 'Chrome refused to terminate the extension service worker')
}

async function verifyWorkerRestartContinuation(context) {
  const { cdp, pageSessionId, chrome, extensionId, fakeTts } = context
  await setSettings(cdp, pageSessionId, { rate: 1 })
  const marker = fakeTts.requests.length
  const start = await sendExtensionMessage(cdp, pageSessionId, {
    kind: START_PLAYBACK,
    source: 'selection',
    text: 'Restart paragraph one.\n\nRestart paragraph two.\n\nRestart paragraph three.',
  })
  assert(start?.ok === true, 'Restart continuation session failed to start')
  await waitForState(cdp, pageSessionId, start.sessionId, 'playing')
  await terminateWorker(cdp, chrome.port, extensionId)

  const reopened = await createExtensionPage(cdp, extensionId)
  const restored = await waitForState(cdp, reopened.sessionId, start.sessionId, ['playing', 'waiting', 'synthesizing', 'completed'])
  assert(restored.sessionId === start.sessionId, 'Reopened popup did not recover the active session')
  await waitForState(cdp, reopened.sessionId, start.sessionId, 'completed', 30_000)
  assert(fakeTts.requests.slice(marker).length === 3, 'Offscreen queue did not finish after worker termination')
  return reopened
}

async function verifyWorkerRestartControls(context, reopenedPage) {
  const { cdp, chrome, extensionId } = context
  await setSettings(cdp, reopenedPage.sessionId, { rate: 1 })
  const start = await sendExtensionMessage(cdp, reopenedPage.sessionId, {
    kind: START_PLAYBACK,
    source: 'selection',
    text: 'RESTART_CONTROL_FIXTURE paragraph one.\n\nRESTART_CONTROL_FIXTURE paragraph two.',
  })
  assert(start?.ok === true, 'Restart control session failed to start')
  await waitForState(cdp, reopenedPage.sessionId, start.sessionId, 'playing')
  await terminateWorker(cdp, chrome.port, extensionId)

  const controlPage = await createExtensionPage(cdp, extensionId)
  await waitForState(cdp, controlPage.sessionId, start.sessionId, 'playing')
  const pause = await sendExtensionMessage(cdp, controlPage.sessionId, {
    kind: PLAYBACK_CONTROL,
    action: 'pause',
    expectedSessionId: start.sessionId,
  })
  assert(pause?.ok === true && pause.state === 'paused', 'Pause failed after worker restart')
  const paused = await waitForState(cdp, controlPage.sessionId, start.sessionId, 'paused')
  await delay(200)
  const stillPaused = await queryStatus(cdp, controlPage.sessionId)
  assert(stillPaused.state === 'paused' && stillPaused.currentChunk === paused.currentChunk, 'Paused restart session advanced')

  const resume = await sendExtensionMessage(cdp, controlPage.sessionId, {
    kind: PLAYBACK_CONTROL,
    action: 'resume',
    expectedSessionId: start.sessionId,
  })
  assert(resume?.ok === true, 'Resume failed after worker restart')
  await waitForState(cdp, controlPage.sessionId, start.sessionId, 'playing')

  const cancel = await sendExtensionMessage(cdp, controlPage.sessionId, {
    kind: PLAYBACK_CONTROL,
    action: 'cancel',
    expectedSessionId: start.sessionId,
  })
  assert(cancel?.ok === true && cancel.state === 'cancelled', 'Cancel failed after worker restart')
  await waitForState(cdp, controlPage.sessionId, start.sessionId, 'cancelled')
  const diagnostics = await queryDiagnostics(cdp, controlPage.sessionId)
  assert(diagnostics.player.activePlayerCount === 0, 'Restart cancel left a player active')
  assert(diagnostics.player.maxActivePlayerCount <= 1, 'Restart controls exceeded one active player')
}

async function main() {
  const fixture = (await readFile(FIXTURE_PATH, 'utf8')).trim()
  const fakeTts = await startFakeTtsServer()
  const chrome = await launchChrome()
  const cdp = new CdpConnection(`ws://127.0.0.1:${chrome.port}${chrome.browserPath}`)

  try {
    await cdp.connect()
    const workerTarget = await waitFor(
      'Read It extension service worker',
      () => findReadItWorkerTarget(cdp, chrome.port),
    )
    const extensionId = new URL(workerTarget.url).host
    const page = await createExtensionPage(cdp, extensionId)
    const ttsUrl = `http://127.0.0.1:${fakeTts.port}/api/tts`
    await setSettings(cdp, page.sessionId, { ttsUrl, voice: 'p225', rate: 1 })

    const context = {
      cdp,
      pageSessionId: page.sessionId,
      fakeTts,
      chrome,
      extensionId,
    }
    await verifyCanonicalFixture(context, fixture)
    await verifyPacingMatrix(context)
    await verifyMixedSourceReplacement(context)
    await verifyInvalidAudioFailure(context)
    const reopened = await verifyWorkerRestartContinuation(context)
    await verifyWorkerRestartControls(context, reopened)

    const finalDiagnostics = await queryDiagnostics(cdp, reopened.sessionId)
    assert(finalDiagnostics.player.activePlayerCount === 0, 'Final active-player count was not zero')
    assert(finalDiagnostics.player.maxActivePlayerCount <= 1, 'Final max active-player count exceeded one')
    assert(finalDiagnostics.player.invariantViolationCount === 0, 'Final player diagnostics contained violations')

    console.log(JSON.stringify({
      ok: true,
      extensionId,
      synthesizedRequests: fakeTts.requests.length,
      player: finalDiagnostics.player,
      verified: [
        'canonical-collision-fixture',
        'semantic-text-integrity',
        'rate-matrix-0.5-1-2-4-10',
        'continuation-sentence-paragraph-gaps',
        'direct-active-player-instrumentation',
        'mixed-source-rapid-replacement',
        'invalid-audio-terminal-failure',
        'service-worker-restart-continuation',
        'reopened-popup-status',
        'post-restart-pause-resume-cancel',
      ],
    }, null, 2))
  } catch (error) {
    const chromeErrors = chrome.stderr.join('').trim()
    if (chromeErrors) console.error(chromeErrors)
    throw error
  } finally {
    cdp.close()
    await chrome.close()
    await fakeTts.close()
  }
}

await main()
