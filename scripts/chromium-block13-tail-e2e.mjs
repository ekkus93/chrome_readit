import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const EXTENSION_DIR = resolve(ROOT, 'dist')
const CHROME_PATH = process.env.CHROME_PATH || process.env.CHROMIUM_PATH || 'google-chrome'
const EXTENSION_NAME = 'Read It – Reader'
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

function makeSilentWav(durationMs = 150, sampleRate = 8_000) {
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
    if (request.method !== 'POST' || request.url !== '/api/tts') {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'not found' }))
      return
    }

    let body
    try {
      body = await readJsonBody(request)
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: false, error: { code: 'INVALID_REQUEST', message: 'Invalid request.' } }))
      return
    }

    const text = String(body.text ?? '')
    const durationMs = text.includes('BLOCK13_TAIL_LONG') ? 2_000 : 150
    const audio = makeSilentWav(durationMs)
    response.writeHead(200, {
      'content-type': 'audio/wav',
      'content-length': String(audio.length),
    })
    response.end(audio)
  })

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  assert(address && typeof address === 'object', 'Fake TTS server did not expose an address')
  return {
    port: address.port,
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
  const profileDirectory = await mkdtemp(resolve(tmpdir(), 'chrome-readit-e2e-block13-tail-'))
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

async function attachTarget(cdp, targetId) {
  const attached = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  await cdp.send('Runtime.enable', {}, attached.sessionId)
  return attached.sessionId
}

async function findReadItWorkerTarget(cdp, port) {
  const targets = await listTargets(port)
  for (const target of targets.filter((candidate) => candidate.type === 'service_worker')) {
    let sessionId
    try {
      sessionId = await attachTarget(cdp, target.id)
      const name = await evaluate(cdp, sessionId, 'chrome.runtime?.getManifest?.().name')
      if (name === EXTENSION_NAME) return target
    } catch {
      // Ignore unrelated or disappearing workers during bounded discovery.
    } finally {
      if (sessionId) await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => undefined)
    }
  }
  return null
}

async function createExtensionPage(cdp, extensionId) {
  const created = await cdp.send('Target.createTarget', { url: `chrome-extension://${extensionId}/src/popup.html` })
  const sessionId = await attachTarget(cdp, created.targetId)
  await waitFor('popup page readiness', async () => (
    await evaluate(cdp, sessionId, 'document.readyState') === 'complete'
  ))
  return { targetId: created.targetId, sessionId }
}

async function sendExtensionMessage(cdp, sessionId, message) {
  return await evaluate(cdp, sessionId, `(async () => await chrome.runtime.sendMessage(${JSON.stringify(message)}))()`)
}

async function queryStatus(cdp, sessionId) {
  return await sendExtensionMessage(cdp, sessionId, { kind: PLAYBACK_STATUS })
}

async function waitForState(cdp, sessionId, playbackSessionId, states, timeoutMs = 30_000) {
  const allowed = new Set(Array.isArray(states) ? states : [states])
  return await waitFor(`session ${playbackSessionId} state ${[...allowed].join('/')}`, async () => {
    const status = await queryStatus(cdp, sessionId)
    return status?.sessionId === playbackSessionId && allowed.has(status.state) ? status : null
  }, timeoutMs)
}

async function startPlayback(cdp, sessionId, text) {
  return await sendExtensionMessage(cdp, sessionId, {
    kind: 'READ_TEXT',
    source: 'debug-fixture',
    text,
  })
}

async function findOffscreenTarget(port, extensionId) {
  return (await listTargets(port)).find((target) => (
    String(target.url) === `chrome-extension://${extensionId}/src/offscreen.html`
  )) ?? null
}

async function waitForActivePlayer(cdp, sessionId, label) {
  return await waitFor(label, async () => {
    const diagnostics = await sendExtensionMessage(cdp, sessionId, { kind: DIAGNOSTICS })
    return diagnostics?.ok === true && diagnostics.player?.activePlayerCount === 1
      ? diagnostics
      : null
  })
}

async function verifyCommandRegistrationAndGlobalRouting(cdp, page) {
  const commands = await evaluate(cdp, page.sessionId, '(async () => await chrome.commands.getAll())()')
  const manifestCommands = await evaluate(cdp, page.sessionId, 'chrome.runtime.getManifest().commands')
  const expected = new Map([
    ['pause-speech', 'Alt+Shift+P'],
    ['resume-speech', 'Alt+Shift+U'],
    ['cancel-speech', 'Alt+Shift+C'],
  ])
  const runtimeShortcuts = {}
  for (const [name, shortcut] of expected) {
    const command = commands.find((candidate) => candidate.name === name)
    assert(command, `Chrome did not register ${name}`)
    assert(
      manifestCommands?.[name]?.suggested_key?.default === shortcut,
      `${name} manifest suggestion did not equal ${shortcut}`,
    )
    if (command.shortcut) {
      assert(command.shortcut === shortcut, `${name} active shortcut was ${command.shortcut}, expected ${shortcut}`)
    }
    runtimeShortcuts[name] = command.shortcut || null
  }

  const start = await startPlayback(cdp, page.sessionId, 'BLOCK13_TAIL_LONG global command routing.')
  assert(start?.ok === true, `global command session was rejected: ${JSON.stringify(start)}`)
  await waitForState(cdp, page.sessionId, start.sessionId, 'playing')
  await waitForActivePlayer(cdp, page.sessionId, 'global command audible player')

  for (const [action, state] of [['pause', 'paused'], ['resume', 'playing'], ['cancel', 'cancelled']]) {
    const response = await sendExtensionMessage(cdp, page.sessionId, { kind: PLAYBACK_CONTROL, action })
    assert(response?.ok === true, `session-global ${action} failed: ${JSON.stringify(response)}`)
    await waitForState(cdp, page.sessionId, start.sessionId, state, 8_000)
  }
  return runtimeShortcuts
}

async function verifyOffscreenDestruction(cdp, chrome, extensionId, page) {
  const start = await startPlayback(cdp, page.sessionId, 'BLOCK13_TAIL_LONG offscreen destruction.')
  assert(start?.ok === true, `offscreen destruction session was rejected: ${JSON.stringify(start)}`)
  await waitForState(cdp, page.sessionId, start.sessionId, 'playing')
  await waitForActivePlayer(cdp, page.sessionId, 'offscreen destruction audible player')

  const offscreen = await waitFor('offscreen document target', () => findOffscreenTarget(chrome.port, extensionId))
  const closed = await cdp.send('Target.closeTarget', { targetId: offscreen.id })
  assert(closed.success === true, 'Chrome refused to close the offscreen document')
  await waitFor('offscreen document closure', async () => (
    (await findOffscreenTarget(chrome.port, extensionId)) ? null : true
  ))

  const interrupted = await waitFor('offscreen interruption classification', async () => {
    const status = await queryStatus(cdp, page.sessionId)
    return status?.sessionId === start.sessionId && status.state === 'failed' ? status : null
  })
  assert(interrupted.error?.code === 'OFFSCREEN_INTERRUPTED', `offscreen destruction returned ${interrupted.error?.code}`)

  const recovery = await startPlayback(cdp, page.sessionId, 'Offscreen recovery session.')
  assert(recovery?.ok === true, `offscreen recovery was rejected: ${JSON.stringify(recovery)}`)
  assert(recovery.sessionId !== start.sessionId, 'offscreen recovery reused the interrupted session ID')
  await waitForState(cdp, page.sessionId, recovery.sessionId, 'completed')

  const diagnostics = await sendExtensionMessage(cdp, page.sessionId, { kind: DIAGNOSTICS })
  assert(diagnostics?.ok === true, `final diagnostics unavailable: ${JSON.stringify(diagnostics)}`)
  assert(diagnostics.player.activePlayerCount === 0, 'offscreen recovery left an active player')
  assert(diagnostics.player.maxActivePlayerCount <= 1, 'offscreen recovery exceeded one active player')
  assert(diagnostics.player.invariantViolationCount === 0, 'offscreen recovery recorded an invariant violation')
  return diagnostics.player
}

async function main() {
  const fakeTts = await startFakeTtsServer()
  const chrome = await launchChrome()
  const cdp = new CdpConnection(`ws://127.0.0.1:${chrome.port}${chrome.browserPath}`)
  try {
    await cdp.connect()
    const worker = await waitFor('Read It extension service worker', () => findReadItWorkerTarget(cdp, chrome.port))
    const extensionId = new URL(worker.url).host
    const page = await createExtensionPage(cdp, extensionId)
    await evaluate(cdp, page.sessionId, `chrome.storage.sync.set(${JSON.stringify({
      ttsUrl: `http://127.0.0.1:${fakeTts.port}/api/tts`,
      voice: 'p225',
      rate: 1,
    })})`)

    const runtimeShortcuts = await verifyCommandRegistrationAndGlobalRouting(cdp, page)
    const player = await verifyOffscreenDestruction(cdp, chrome, extensionId, page)
    console.log(JSON.stringify({
      ok: true,
      extensionId,
      runtimeShortcuts,
      player,
      verified: [
        'registered-command-names',
        'manifest-suggested-shortcuts',
        'runtime-shortcut-assignment-recorded',
        'session-global-pause-resume-cancel',
        'offscreen-destruction-interruption-classification',
        'unique-session-offscreen-recovery',
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
