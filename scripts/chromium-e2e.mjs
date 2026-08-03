import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const EXTENSION_DIR = resolve(ROOT, 'dist')
const CHROME_PATH = process.env.CHROME_PATH || process.env.CHROMIUM_PATH || 'google-chrome'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

async function waitFor(label, operation, timeoutMs = 30_000, intervalMs = 50) {
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

function makeSilentWav(durationMs = 300, sampleRate = 8_000) {
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
  const audio = makeSilentWav()
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
      response.end(JSON.stringify({ ok: true, ready: true }))
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
        requests.push({ text: String(body.text ?? ''), voice: String(body.voice ?? '') })
        response.writeHead(200, {
          'content-type': 'audio/wav',
          'content-length': String(audio.length),
        })
        response.end(audio)
      } catch (error) {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: String(error) }))
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
  const process = spawn(CHROME_PATH, [
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
  process.stderr.setEncoding('utf8')
  process.stderr.on('data', (chunk) => {
    stderr.push(chunk)
    if (stderr.join('').length > 20_000) stderr.shift()
  })

  const activePort = await waitFor('Chrome DevTools port', async () => {
    const text = await readFile(resolve(profileDirectory, 'DevToolsActivePort'), 'utf8')
    const [portLine, browserPath] = text.trim().split('\n')
    const port = Number(portLine)
    return Number.isInteger(port) && browserPath ? { port, browserPath } : null
  })

  return {
    ...activePort,
    process,
    profileDirectory,
    stderr,
    async close() {
      process.kill('SIGTERM')
      await Promise.race([
        new Promise((resolveExit) => process.once('exit', resolveExit)),
        delay(3_000).then(() => process.kill('SIGKILL')),
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

function assertNoOverlappingChunks(events) {
  let activeChunk = null
  for (const event of events) {
    if (event.event === 'accepted') activeChunk = null
    if (event.event === 'chunk-started') {
      assert(activeChunk === null, `Chunk ${event.chunkId} started while ${activeChunk} was active`)
      activeChunk = event.chunkId
    }
    if (event.event === 'chunk-ended') {
      assert(activeChunk === event.chunkId, `Chunk ${event.chunkId} ended while ${activeChunk} was active`)
      activeChunk = null
    }
    if (event.event === 'completed' || event.event === 'cancelled' || event.event === 'failed') activeChunk = null
  }
}

async function main() {
  const fakeTts = await startFakeTtsServer()
  const chrome = await launchChrome()
  const cdp = new CdpConnection(`ws://127.0.0.1:${chrome.port}${chrome.browserPath}`)

  try {
    await cdp.connect()
    const workerTarget = await waitFor('extension service worker', async () => {
      const targets = await listTargets(chrome.port)
      return targets.find((target) => target.type === 'service_worker' && String(target.url).startsWith('chrome-extension://'))
    })
    const extensionId = new URL(workerTarget.url).host

    const created = await cdp.send('Target.createTarget', {
      url: `chrome-extension://${extensionId}/src/popup.html`,
    })
    const attached = await cdp.send('Target.attachToTarget', {
      targetId: created.targetId,
      flatten: true,
    })
    const sessionId = attached.sessionId
    await cdp.send('Runtime.enable', {}, sessionId)
    await waitFor('extension test page', async () => (
      await evaluate(cdp, sessionId, 'document.readyState') === 'complete'
    ))

    const ttsUrl = `http://127.0.0.1:${fakeTts.port}/api/tts`
    await evaluate(cdp, sessionId, `chrome.storage.sync.set(${JSON.stringify({
      ttsUrl,
      voice: 'p225',
      rate: 10,
    })})`)

    const initialRequestCount = fakeTts.requests.length
    const packedStart = await sendExtensionMessage(cdp, sessionId, {
      kind: 'READ_TEXT',
      source: 'debug-fixture',
      text: 'Short one. Short two. A semicolon joins this clause; it stays together.\n\nSecond paragraph.',
    })
    assert(packedStart?.ok === true, `Packed playback was rejected: ${JSON.stringify(packedStart)}`)

    await waitFor('packed playback completion', async () => {
      const status = await sendExtensionMessage(cdp, sessionId, { kind: 'SPEECH_STATUS' })
      return status?.sessionId === packedStart.sessionId && status.state === 'completed'
    }, 15_000)

    const packedRequests = fakeTts.requests.slice(initialRequestCount)
    assert(packedRequests.length === 2, `Expected two packed paragraph requests, received ${packedRequests.length}`)
    assert(packedRequests[0].text.includes('Short one. Short two.'), 'Short sentences were not packed together')
    assert(packedRequests[0].text.includes('clause; it stays together.'), 'Semicolon text was split incorrectly')

    const packedDiagnostics = await sendExtensionMessage(cdp, sessionId, { kind: 'PLAYBACK_DIAGNOSTICS' })
    assert(packedDiagnostics?.ok === true, 'Playback diagnostics were unavailable in the test build')
    const packedEvents = packedDiagnostics.events.filter((event) => event.status.sessionId === packedStart.sessionId)
    assertNoOverlappingChunks(packedEvents)
    const firstEnd = packedEvents.find((event) => event.event === 'chunk-ended')
    const secondStart = packedEvents.filter((event) => event.event === 'chunk-started')[1]
    assert(firstEnd && secondStart, 'Expected two chunk intervals in diagnostics')
    assert(secondStart.atMs - firstEnd.atMs >= 300, 'Paragraph pacing collapsed below the bounded minimum')

    const replacementMarker = packedDiagnostics.events.length
    const oldStart = await sendExtensionMessage(cdp, sessionId, {
      kind: 'READ_TEXT',
      source: 'selection',
      text: 'Old paragraph one.\n\nOld paragraph two.\n\nOld paragraph three.',
    })
    assert(oldStart?.ok === true, 'Old replacement session failed to start')
    await waitFor('old replacement session playback', async () => {
      const status = await sendExtensionMessage(cdp, sessionId, { kind: 'SPEECH_STATUS' })
      return status?.sessionId === oldStart.sessionId && status.state === 'playing'
    })

    const replacementStart = await sendExtensionMessage(cdp, sessionId, {
      kind: 'READ_TEXT',
      source: 'popup-test',
      text: 'Replacement wins.',
    })
    assert(replacementStart?.ok === true, 'Replacement session failed to start')
    assert(replacementStart.sessionId !== oldStart.sessionId, 'Replacement reused a session ID')
    await waitFor('replacement completion', async () => {
      const status = await sendExtensionMessage(cdp, sessionId, { kind: 'SPEECH_STATUS' })
      return status?.sessionId === replacementStart.sessionId && status.state === 'completed'
    })

    const replacementDiagnostics = await sendExtensionMessage(cdp, sessionId, { kind: 'PLAYBACK_DIAGNOSTICS' })
    const replacementEvents = replacementDiagnostics.events.slice(replacementMarker)
    assertNoOverlappingChunks(replacementEvents)
    assert(
      replacementEvents.some((event) => event.event === 'completed' && event.status.sessionId === replacementStart.sessionId),
      'Replacement session did not complete',
    )
    assert(
      !replacementEvents.some((event) => event.event === 'completed' && event.status.sessionId === oldStart.sessionId),
      'Superseded session completed after replacement',
    )

    const restartRequestMarker = fakeTts.requests.length
    const restartStart = await sendExtensionMessage(cdp, sessionId, {
      kind: 'READ_TEXT',
      source: 'selection',
      text: 'Restart paragraph one.\n\nRestart paragraph two.\n\nRestart paragraph three.',
    })
    assert(restartStart?.ok === true, 'Restart session failed to start')
    await waitFor('restart session playback', async () => {
      const status = await sendExtensionMessage(cdp, sessionId, { kind: 'SPEECH_STATUS' })
      return status?.sessionId === restartStart.sessionId && status.state === 'playing'
    })

    const currentWorker = (await listTargets(chrome.port)).find((target) => (
      target.type === 'service_worker' && String(target.url).startsWith(`chrome-extension://${extensionId}/`)
    ))
    assert(currentWorker, 'Unable to find the active service worker target')
    const closed = await cdp.send('Target.closeTarget', { targetId: currentWorker.id })
    assert(closed.success === true, 'Chrome refused to terminate the extension service worker')

    await waitFor('playback completion after worker restart', async () => {
      const status = await sendExtensionMessage(cdp, sessionId, { kind: 'SPEECH_STATUS' })
      return status?.sessionId === restartStart.sessionId && status.state === 'completed'
    }, 15_000)
    assert(
      fakeTts.requests.slice(restartRequestMarker).length === 3,
      'Offscreen queue did not finish all chunks after service-worker termination',
    )

    const afterRestart = await sendExtensionMessage(cdp, sessionId, {
      kind: 'READ_TEXT',
      source: 'options-test',
      text: 'After restart.',
    })
    assert(afterRestart?.ok === true, 'New playback failed after service-worker restart')
    assert(afterRestart.sessionId !== restartStart.sessionId, 'Session ID collided across service-worker restart')
    await waitFor('post-restart playback completion', async () => {
      const status = await sendExtensionMessage(cdp, sessionId, { kind: 'SPEECH_STATUS' })
      return status?.sessionId === afterRestart.sessionId && status.state === 'completed'
    })

    console.log(JSON.stringify({
      ok: true,
      extensionId,
      synthesizedRequests: fakeTts.requests.length,
      verified: [
        'sentence-packing',
        'semicolon-preservation',
        'bounded-paragraph-pacing',
        'single-chunk-interval',
        'stop-before-replace',
        'service-worker-restart',
        'restart-safe-session-ids',
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
