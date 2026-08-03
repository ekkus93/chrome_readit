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
const READ_TEXT = 'READ_TEXT'
const PLAYBACK_STATUS = 'PLAYBACK_STATUS'
const PLAYBACK_CONTROL = 'PLAYBACK_CONTROL'
const DIAGNOSTICS = 'PLAYBACK_DIAGNOSTICS'
const DEFAULT_SETTINGS = { voice: 'p225', rate: 1 }

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

function writeAudio(response, durationMs = 150) {
  const audio = makeSilentWav(durationMs)
  response.writeHead(200, {
    'content-type': 'audio/wav',
    'content-length': String(audio.length),
  })
  response.end(audio)
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
    const voice = String(body.voice ?? '')
    requests.push({ text, voice, receivedAtMs: performance.now() })

    if (text.includes('BLOCK13_HTTP_FAILURE')) {
      response.writeHead(503, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: false, error: { code: 'UNAVAILABLE', message: 'Injected failure.' } }))
      return
    }
    if (text.includes('BLOCK13_TIMEOUT')) {
      request.once('close', () => {
        if (!response.writableEnded) response.destroy()
      })
      return
    }
    if (text.includes('BLOCK13_OVERSIZED_STREAM')) {
      response.writeHead(200, { 'content-type': 'audio/wav' })
      const chunk = Buffer.alloc(1024 * 1024)
      chunk.write('RIFF', 0)
      for (let index = 0; index < 17 && !response.destroyed; index += 1) response.write(chunk)
      if (!response.destroyed) response.end()
      return
    }
    if (text.includes('BLOCK13_SLOW_SYNTHESIS')) {
      await delay(900)
      if (!response.destroyed) writeAudio(response)
      return
    }

    const durationMs = (
      text.includes('BLOCK13_LONG_AUDIO')
      || text.includes('BLOCK13_RESTART_PLAYBACK')
      || text.includes('BLOCK13_KEYBOARD_CONTROL')
    ) ? 2_000 : 150
    writeAudio(response, durationMs)
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
  const profileDirectory = await mkdtemp(resolve(tmpdir(), 'chrome-readit-e2e-block13-'))
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

async function attachTarget(cdp, targetId) {
  const attached = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  await cdp.send('Runtime.enable', {}, attached.sessionId)
  return attached.sessionId
}

async function findReadItWorkerTarget(cdp, port) {
  const targets = await listTargets(port)
  const workers = targets.filter((target) => (
    target.type === 'service_worker' && String(target.url).startsWith('chrome-extension://')
  ))
  for (const target of workers) {
    let sessionId
    try {
      sessionId = await attachTarget(cdp, target.id)
      const name = await evaluate(cdp, sessionId, 'chrome.runtime?.getManifest?.().name')
      if (name === EXTENSION_NAME) return target
    } catch {
      // Disappearing unrelated workers are expected during startup.
    } finally {
      if (sessionId) await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => undefined)
    }
  }
  return null
}

async function findOffscreenTarget(port, extensionId) {
  return (await listTargets(port)).find((target) => (
    String(target.url) === `chrome-extension://${extensionId}/src/offscreen.html`
  )) ?? null
}

async function createExtensionPage(cdp, extensionId, path = 'src/popup.html') {
  const created = await cdp.send('Target.createTarget', { url: `chrome-extension://${extensionId}/${path}` })
  const sessionId = await attachTarget(cdp, created.targetId)
  await waitFor(`extension page ${path}`, async () => (
    await evaluate(cdp, sessionId, 'document.readyState') === 'complete'
  ))
  return { targetId: created.targetId, sessionId }
}

async function sendExtensionMessage(cdp, sessionId, message) {
  return await evaluate(
    cdp,
    sessionId,
    `(async () => await chrome.runtime.sendMessage(${JSON.stringify(message)}))()`,
  )
}

async function setSettings(cdp, sessionId, settings) {
  await evaluate(cdp, sessionId, `chrome.storage.sync.set(${JSON.stringify(settings)})`)
}

async function queryStatus(cdp, sessionId) {
  return await sendExtensionMessage(cdp, sessionId, { kind: PLAYBACK_STATUS })
}

async function queryDiagnostics(cdp, sessionId) {
  const diagnostics = await sendExtensionMessage(cdp, sessionId, { kind: DIAGNOSTICS })
  assert(diagnostics?.ok === true, `Playback diagnostics unavailable: ${JSON.stringify(diagnostics)}`)
  return diagnostics
}

async function waitForStatus(cdp, sessionId, label, predicate, timeoutMs = 30_000) {
  return await waitFor(label, async () => {
    const status = await queryStatus(cdp, sessionId)
    return predicate(status) ? status : null
  }, timeoutMs)
}

async function waitForState(cdp, sessionId, playbackSessionId, states, timeoutMs = 30_000) {
  const allowed = new Set(Array.isArray(states) ? states : [states])
  return await waitForStatus(
    cdp,
    sessionId,
    `session ${playbackSessionId} state ${[...allowed].join('/')}`,
    (status) => status?.sessionId === playbackSessionId && allowed.has(status.state),
    timeoutMs,
  )
}

async function startReadText(context, text, source = 'debug-fixture') {
  return await sendExtensionMessage(context.cdp, context.page.sessionId, { kind: READ_TEXT, source, text })
}

async function attachOffscreen(context) {
  const target = await waitFor('offscreen document target', () => findOffscreenTarget(context.chrome.port, context.extensionId))
  const sessionId = await attachTarget(context.cdp, target.id)
  return { target, sessionId }
}

async function restoreOffscreenFault(context) {
  const target = await findOffscreenTarget(context.chrome.port, context.extensionId)
  if (!target) return
  const sessionId = await attachTarget(context.cdp, target.id)
  try {
    await evaluate(context.cdp, sessionId, `(() => {
      globalThis.__readitBlock13FaultState?.restore?.()
      globalThis.__readitBlock13InvalidResponseCleanup?.()
      return true
    })()`)
  } finally {
    await context.cdp.send('Target.detachFromTarget', { sessionId }).catch(() => undefined)
  }
}

async function installAudioFault(context, mode) {
  const { sessionId } = await attachOffscreen(context)
  try {
    await evaluate(context.cdp, sessionId, `((mode) => {
      globalThis.__readitBlock13FaultState?.restore?.()
      const proto = HTMLMediaElement.prototype
      const playDescriptor = Object.getOwnPropertyDescriptor(proto, 'play')
      const pauseDescriptor = Object.getOwnPropertyDescriptor(proto, 'pause')
      if (!playDescriptor || !pauseDescriptor) throw new Error('Media method descriptors unavailable')
      let used = false
      const restore = () => {
        Object.defineProperty(proto, 'play', playDescriptor)
        Object.defineProperty(proto, 'pause', pauseDescriptor)
        delete globalThis.__readitBlock13FaultState
      }
      globalThis.__readitBlock13FaultState = { restore }

      if (mode === 'play-reject') {
        Object.defineProperty(proto, 'play', {
          ...playDescriptor,
          value: function (...args) {
            if (!used) {
              used = true
              return Promise.reject(new DOMException('Injected play rejection', 'NotAllowedError'))
            }
            return playDescriptor.value.apply(this, args)
          },
        })
      } else if (mode === 'play-throw') {
        Object.defineProperty(proto, 'play', {
          ...playDescriptor,
          value: function (...args) {
            if (!used) {
              used = true
              throw new Error('Injected synchronous play failure')
            }
            return playDescriptor.value.apply(this, args)
          },
        })
      } else if (mode === 'media-error') {
        Object.defineProperty(proto, 'play', {
          ...playDescriptor,
          value: function (...args) {
            if (!used) {
              used = true
              const handler = this.onerror
              setTimeout(() => handler?.call(this, new Event('error')), 0)
              return Promise.resolve()
            }
            return playDescriptor.value.apply(this, args)
          },
        })
      } else if (mode === 'duplicate-ended') {
        Object.defineProperty(proto, 'play', {
          ...playDescriptor,
          value: function (...args) {
            if (!used) {
              used = true
              const handler = this.onended
              setTimeout(() => {
                handler?.call(this, new Event('ended'))
                handler?.call(this, new Event('ended'))
              }, 0)
              return Promise.resolve()
            }
            return playDescriptor.value.apply(this, args)
          },
        })
      } else if (mode === 'pause-throw') {
        Object.defineProperty(proto, 'pause', {
          ...pauseDescriptor,
          value: function (...args) {
            if (!used) {
              used = true
              Object.defineProperty(proto, 'pause', pauseDescriptor)
              throw new Error('Injected pause cleanup failure')
            }
            return pauseDescriptor.value.apply(this, args)
          },
        })
      } else {
        throw new Error('Unknown audio fault: ' + mode)
      }
      return true
    })(${JSON.stringify(mode)})`)
  } finally {
    await context.cdp.send('Target.detachFromTarget', { sessionId }).catch(() => undefined)
  }
}

async function installTimeoutAcceleration(context) {
  const { sessionId } = await attachOffscreen(context)
  try {
    await evaluate(context.cdp, sessionId, `(() => {
      globalThis.__readitBlock13FaultState?.restore?.()
      const originalSetTimeout = globalThis.setTimeout
      const restore = () => {
        globalThis.setTimeout = originalSetTimeout
        delete globalThis.__readitBlock13FaultState
      }
      globalThis.__readitBlock13FaultState = { restore }
      globalThis.setTimeout = function (handler, milliseconds, ...args) {
        const bounded = Number(milliseconds) >= 100000 ? 250 : milliseconds
        return originalSetTimeout(handler, bounded, ...args)
      }
      return true
    })()`)
  } finally {
    await context.cdp.send('Target.detachFromTarget', { sessionId }).catch(() => undefined)
  }
}

async function installInvalidStartResponse(context, marker) {
  const { sessionId } = await attachOffscreen(context)
  try {
    await evaluate(context.cdp, sessionId, `((marker) => {
      globalThis.__readitBlock13InvalidResponseCleanup?.()
      const listener = (message, _sender, sendResponse) => {
        if (message?.kind !== 'START_PLAYBACK' || !String(message.text ?? '').includes(marker)) return false
        chrome.runtime.onMessage.removeListener(listener)
        delete globalThis.__readitBlock13InvalidResponseCleanup
        sendResponse({ invalid: true, injected: 'block13' })
        return true
      }
      chrome.runtime.onMessage.addListener(listener)
      globalThis.__readitBlock13InvalidResponseCleanup = () => {
        chrome.runtime.onMessage.removeListener(listener)
        delete globalThis.__readitBlock13InvalidResponseCleanup
      }
      return true
    })(${JSON.stringify(marker)})`)
  } finally {
    await context.cdp.send('Target.detachFromTarget', { sessionId }).catch(() => undefined)
  }
}

function assertFailed(status, expectedCode, label) {
  assert(status.state === 'failed', `${label}: expected failed, got ${status.state}`)
  assert(status.error?.code === expectedCode, `${label}: expected ${expectedCode}, got ${status.error?.code}`)
}

function assertPlayerHealthy(diagnostics, label) {
  assert(diagnostics.player.activePlayerCount === 0, `${label}: active player count was ${diagnostics.player.activePlayerCount}`)
  assert(diagnostics.player.maxActivePlayerCount <= 1, `${label}: max active players was ${diagnostics.player.maxActivePlayerCount}`)
  assert(diagnostics.player.invariantViolationCount === 0, `${label}: invariant violations were recorded`)
}

async function verifyAudioStartFailure(context, mode) {
  const before = await queryDiagnostics(context.cdp, context.page.sessionId)
  await installAudioFault(context, mode)
  try {
    const start = await startReadText(context, `BLOCK13_${mode.toUpperCase().replaceAll('-', '_')}.`)
    assert(start?.ok === true, `${mode}: start was rejected: ${JSON.stringify(start)}`)
    const failed = await waitForState(context.cdp, context.page.sessionId, start.sessionId, 'failed')
    assertFailed(failed, 'AUDIO_PLAYBACK_FAILED', mode)
    const after = await queryDiagnostics(context.cdp, context.page.sessionId)
    assertPlayerHealthy(after, mode)
    assert(after.player.settlementCount - before.player.settlementCount === 1, `${mode}: playback did not settle exactly once`)
  } finally {
    await restoreOffscreenFault(context)
  }
}

async function verifyDuplicateEnded(context) {
  const before = await queryDiagnostics(context.cdp, context.page.sessionId)
  await installAudioFault(context, 'duplicate-ended')
  try {
    const start = await startReadText(context, 'BLOCK13_DUPLICATE_ENDED.')
    assert(start?.ok === true, `duplicate-ended: start rejected: ${JSON.stringify(start)}`)
    await waitForState(context.cdp, context.page.sessionId, start.sessionId, 'completed')
    const after = await queryDiagnostics(context.cdp, context.page.sessionId)
    assertPlayerHealthy(after, 'duplicate-ended')
    assert(after.player.settlementCount - before.player.settlementCount === 1, 'duplicate-ended: settlement was not idempotent')
  } finally {
    await restoreOffscreenFault(context)
  }
}

async function verifyCleanupFailure(context) {
  const start = await startReadText(context, 'BLOCK13_LONG_AUDIO cleanup source.')
  assert(start?.ok === true, `cleanup source start rejected: ${JSON.stringify(start)}`)
  await waitForState(context.cdp, context.page.sessionId, start.sessionId, 'playing')
  const before = await waitFor('cleanup source audible player', async () => {
    const diagnostics = await queryDiagnostics(context.cdp, context.page.sessionId)
    return diagnostics.player.activePlayerCount === 1 ? diagnostics : null
  })
  await installAudioFault(context, 'pause-throw')
  const replacement = await startReadText(context, 'BLOCK13 cleanup replacement.')
  assert(replacement?.ok === false, 'cleanup failure did not reject replacement')
  assert(replacement.error?.code === 'AUDIO_CLEANUP_FAILED', `cleanup failure returned ${replacement.error?.code}`)
  assert(replacement.error?.stage === 'pause', `cleanup failure stage was ${replacement.error?.stage}`)
  const failed = await waitForState(context.cdp, context.page.sessionId, start.sessionId, 'failed')
  assertFailed(failed, 'AUDIO_CLEANUP_FAILED', 'cleanup failure')
  const afterFailure = await queryDiagnostics(context.cdp, context.page.sessionId)
  assert(afterFailure.player.cleanupFailureCount > before.player.cleanupFailureCount, 'cleanup failure was not recorded')
  assert(afterFailure.player.playAttemptCount === before.player.playAttemptCount, 'cleanup failure started replacement audio')
  assert(afterFailure.player.maxActivePlayerCount <= 1, 'cleanup failure exceeded one active player')
  assert(afterFailure.player.invariantViolationCount === 0, 'cleanup failure recorded an overlap invariant violation')

  await restoreOffscreenFault(context)
  const recovery = await startReadText(context, 'BLOCK13 cleanup recovery.')
  assert(recovery?.ok === true, `cleanup recovery was rejected: ${JSON.stringify(recovery)}`)
  await waitForState(context.cdp, context.page.sessionId, recovery.sessionId, 'completed')
  assertPlayerHealthy(await queryDiagnostics(context.cdp, context.page.sessionId), 'cleanup recovery')
}

async function verifyTtsFailure(context, marker, expectedCode, timeoutMs = 30_000) {
  const start = await startReadText(context, `${marker}.`)
  assert(start?.ok === true, `${marker}: start rejected: ${JSON.stringify(start)}`)
  const failed = await waitForState(context.cdp, context.page.sessionId, start.sessionId, 'failed', timeoutMs)
  assertFailed(failed, expectedCode, marker)
  assertPlayerHealthy(await queryDiagnostics(context.cdp, context.page.sessionId), marker)
}

async function verifyTtsTimeout(context) {
  await installTimeoutAcceleration(context)
  try {
    await verifyTtsFailure(context, 'BLOCK13_TIMEOUT', 'TTS_TIMEOUT', 8_000)
  } finally {
    await restoreOffscreenFault(context)
  }
}

async function terminateWorker(context) {
  const worker = (await listTargets(context.chrome.port)).find((target) => (
    target.type === 'service_worker' && String(target.url).startsWith(`chrome-extension://${context.extensionId}/`)
  ))
  assert(worker, 'Unable to find the active service worker target')
  const closed = await context.cdp.send('Target.closeTarget', { targetId: worker.id })
  assert(closed.success === true, 'Chrome refused to terminate the service worker')
}

async function destroyOffscreen(context) {
  const target = await waitFor('offscreen target for destruction', () => findOffscreenTarget(context.chrome.port, context.extensionId))
  const closed = await context.cdp.send('Target.closeTarget', { targetId: target.id })
  assert(closed.success === true, 'Chrome refused to destroy the offscreen document')
  await waitFor('offscreen target destruction', async () => (
    (await findOffscreenTarget(context.chrome.port, context.extensionId)) ? null : true
  ))
}

async function replacePageAfterWorkerRestart(context) {
  const page = await createExtensionPage(context.cdp, context.extensionId)
  context.page = page
  return page
}

async function verifyRestartDuringSynthesis(context) {
  const start = await startReadText(context, 'BLOCK13_SLOW_SYNTHESIS restart during synthesis.')
  assert(start?.ok === true, 'restart-during-synthesis start rejected')
  await waitForState(context.cdp, context.page.sessionId, start.sessionId, 'synthesizing')
  await terminateWorker(context)
  const page = await replacePageAfterWorkerRestart(context)
  await waitForState(context.cdp, page.sessionId, start.sessionId, ['synthesizing', 'playing', 'completed'])
  await waitForState(context.cdp, page.sessionId, start.sessionId, 'completed')
}

async function verifyRestartWhilePaused(context) {
  const start = await startReadText(context, 'BLOCK13_RESTART_PLAYBACK restart while paused.')
  assert(start?.ok === true, 'restart-while-paused start rejected')
  await waitForState(context.cdp, context.page.sessionId, start.sessionId, 'playing')
  const pause = await sendExtensionMessage(context.cdp, context.page.sessionId, {
    kind: PLAYBACK_CONTROL,
    action: 'pause',
    expectedSessionId: start.sessionId,
  })
  assert(pause?.ok === true && pause.state === 'paused', 'pause before worker restart failed')
  await waitForState(context.cdp, context.page.sessionId, start.sessionId, 'paused')
  await terminateWorker(context)
  const page = await replacePageAfterWorkerRestart(context)
  await waitForState(context.cdp, page.sessionId, start.sessionId, 'paused')
  const resume = await sendExtensionMessage(context.cdp, page.sessionId, {
    kind: PLAYBACK_CONTROL,
    action: 'resume',
    expectedSessionId: start.sessionId,
  })
  assert(resume?.ok === true, 'resume after paused worker restart failed')
  await waitForState(context.cdp, page.sessionId, start.sessionId, 'playing')
  const cancel = await sendExtensionMessage(context.cdp, page.sessionId, {
    kind: PLAYBACK_CONTROL,
    action: 'cancel',
    expectedSessionId: start.sessionId,
  })
  assert(cancel?.ok === true && cancel.state === 'cancelled', 'cancel after paused worker restart failed')
  await waitForState(context.cdp, page.sessionId, start.sessionId, 'cancelled')
}

async function verifyRestartDuringGap(context) {
  await setSettings(context.cdp, context.page.sessionId, { ...context.settings, rate: 0.5 })
  const start = await startReadText(context, 'Gap restart paragraph one.\n\nGap restart paragraph two.')
  assert(start?.ok === true, 'restart-during-gap start rejected')
  await waitForState(context.cdp, context.page.sessionId, start.sessionId, 'waiting')
  await terminateWorker(context)
  const page = await replacePageAfterWorkerRestart(context)
  await waitForState(context.cdp, page.sessionId, start.sessionId, ['waiting', 'synthesizing', 'playing', 'completed'])
  await waitForState(context.cdp, page.sessionId, start.sessionId, 'completed')
  await setSettings(context.cdp, page.sessionId, context.settings)
}

async function verifyPausePreservesGap(context) {
  await setSettings(context.cdp, context.page.sessionId, { ...context.settings, rate: 1 })
  const start = await startReadText(context, 'Pause gap paragraph one.\n\nPause gap paragraph two.')
  assert(start?.ok === true, 'pause-gap start rejected')
  const waiting = await waitForState(context.cdp, context.page.sessionId, start.sessionId, 'waiting')
  await delay(220)
  const pause = await sendExtensionMessage(context.cdp, context.page.sessionId, {
    kind: PLAYBACK_CONTROL,
    action: 'pause',
    expectedSessionId: start.sessionId,
  })
  assert(pause?.ok === true && pause.state === 'paused', 'pause during gap failed')
  const paused = await waitForState(context.cdp, context.page.sessionId, start.sessionId, 'paused')
  assert(paused.currentChunk === waiting.currentChunk, 'pause during gap advanced the chunk')
  await delay(700)
  const held = await queryStatus(context.cdp, context.page.sessionId)
  assert(held.state === 'paused' && held.currentChunk === paused.currentChunk, 'paused gap elapsed while paused')
  const resumeAt = Date.now()
  const resume = await sendExtensionMessage(context.cdp, context.page.sessionId, {
    kind: PLAYBACK_CONTROL,
    action: 'resume',
    expectedSessionId: start.sessionId,
  })
  assert(resume?.ok === true, 'resume during gap failed')
  await waitForStatus(
    context.cdp,
    context.page.sessionId,
    'second chunk after resumed gap',
    (status) => status.sessionId === start.sessionId && status.currentChunk === 2 && ['playing', 'completed'].includes(status.state),
  )
  const resumedDelay = Date.now() - resumeAt
  assert(resumedDelay >= 120, `resumed gap lost remaining delay (${resumedDelay}ms)`)
  assert(resumedDelay < 520, `resumed gap restarted the full delay (${resumedDelay}ms)`)
  await waitForState(context.cdp, context.page.sessionId, start.sessionId, 'completed')
}

async function verifyOffscreenDestruction(context) {
  const start = await startReadText(context, 'BLOCK13_LONG_AUDIO offscreen destruction.')
  assert(start?.ok === true, 'offscreen-destruction start rejected')
  await waitForState(context.cdp, context.page.sessionId, start.sessionId, 'playing')
  await destroyOffscreen(context)
  const interrupted = await waitForStatus(
    context.cdp,
    context.page.sessionId,
    'offscreen interruption status',
    (status) => status.sessionId === start.sessionId && status.state === 'failed',
  )
  assertFailed(interrupted, 'OFFSCREEN_INTERRUPTED', 'offscreen destruction')
  const replacement = await startReadText(context, 'Post-offscreen recovery session.')
  assert(replacement?.ok === true, `post-offscreen recovery rejected: ${JSON.stringify(replacement)}`)
  assert(replacement.sessionId !== start.sessionId, 'post-offscreen session reused the destroyed UUID')
  await waitForState(context.cdp, context.page.sessionId, replacement.sessionId, 'completed')
}

async function verifyInvalidResponsePayload(context) {
  const marker = `BLOCK13_INVALID_RESPONSE_${Date.now()}`
  await installInvalidStartResponse(context, marker)
  try {
    const response = await startReadText(context, `${marker}.`)
    assert(response?.ok === false, `invalid response was accepted: ${JSON.stringify(response)}`)
    assert(response.error?.code === 'OFFSCREEN_INTERRUPTED', `invalid response returned ${response.error?.code}`)
    await delay(100)
    const stray = await queryStatus(context.cdp, context.page.sessionId)
    if (stray.sessionId && !['idle', 'completed', 'cancelled', 'failed'].includes(stray.state)) {
      const cancel = await sendExtensionMessage(context.cdp, context.page.sessionId, {
        kind: PLAYBACK_CONTROL,
        action: 'cancel',
        expectedSessionId: stray.sessionId,
      })
      assert(cancel?.ok === true, 'invalid-response side-effect session could not be cancelled')
      await waitForState(context.cdp, context.page.sessionId, stray.sessionId, 'cancelled')
    }
  } finally {
    await restoreOffscreenFault(context)
  }
}

async function dispatchShortcut(context, key, code, virtualKeyCode) {
  const params = {
    key,
    code,
    modifiers: 9,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
  }
  await context.cdp.send('Input.dispatchKeyEvent', { ...params, type: 'rawKeyDown' }, context.page.sessionId)
  await context.cdp.send('Input.dispatchKeyEvent', { ...params, type: 'keyUp' }, context.page.sessionId)
}

async function verifyKeyboardGlobalControls(context) {
  const start = await startReadText(context, 'BLOCK13_KEYBOARD_CONTROL global keyboard command.')
  assert(start?.ok === true, 'keyboard-control start rejected')
  await waitForState(context.cdp, context.page.sessionId, start.sessionId, 'playing')
  await dispatchShortcut(context, 'P', 'KeyP', 80)
  await waitForState(context.cdp, context.page.sessionId, start.sessionId, 'paused', 8_000)
  await dispatchShortcut(context, 'U', 'KeyU', 85)
  await waitForState(context.cdp, context.page.sessionId, start.sessionId, 'playing', 8_000)
  await dispatchShortcut(context, 'C', 'KeyC', 67)
  await waitForState(context.cdp, context.page.sessionId, start.sessionId, 'cancelled', 8_000)
}

async function warmOffscreen(context) {
  const warmup = await startReadText(context, 'Block 13 warmup.')
  assert(warmup?.ok === true, `warmup rejected: ${JSON.stringify(warmup)}`)
  await waitForState(context.cdp, context.page.sessionId, warmup.sessionId, 'completed')
}

async function main() {
  const fakeTts = await startFakeTtsServer()
  const chrome = await launchChrome()
  const cdp = new CdpConnection(`ws://127.0.0.1:${chrome.port}${chrome.browserPath}`)
  let context
  try {
    await cdp.connect()
    const workerTarget = await waitFor('Read It extension service worker', () => findReadItWorkerTarget(cdp, chrome.port))
    const extensionId = new URL(workerTarget.url).host
    const page = await createExtensionPage(cdp, extensionId)
    const settings = {
      ...DEFAULT_SETTINGS,
      ttsUrl: `http://127.0.0.1:${fakeTts.port}/api/tts`,
    }
    await setSettings(cdp, page.sessionId, settings)
    context = { cdp, chrome, extensionId, page, settings }

    await warmOffscreen(context)
    await verifyAudioStartFailure(context, 'play-reject')
    await verifyAudioStartFailure(context, 'play-throw')
    await verifyAudioStartFailure(context, 'media-error')
    await verifyDuplicateEnded(context)
    await verifyCleanupFailure(context)
    await verifyTtsFailure(context, 'BLOCK13_HTTP_FAILURE', 'TTS_HTTP_ERROR')
    await verifyTtsTimeout(context)
    await verifyTtsFailure(context, 'BLOCK13_OVERSIZED_STREAM', 'TTS_RESPONSE_TOO_LARGE')
    await verifyInvalidResponsePayload(context)
    await verifyRestartDuringSynthesis(context)
    await verifyRestartWhilePaused(context)
    await verifyRestartDuringGap(context)
    await verifyPausePreservesGap(context)
    await verifyKeyboardGlobalControls(context)
    await verifyOffscreenDestruction(context)

    const finalDiagnostics = await queryDiagnostics(cdp, context.page.sessionId)
    assertPlayerHealthy(finalDiagnostics, 'Block 13 final diagnostics')
    console.log(JSON.stringify({
      ok: true,
      extensionId,
      synthesizedRequests: fakeTts.requests.length,
      player: finalDiagnostics.player,
      verified: [
        'rejected-audio-play-promise',
        'synchronous-audio-play-throw',
        'media-error-event',
        'duplicate-ended-idempotence',
        'cleanup-failure-fail-closed-and-recovery',
        'tts-http-failure',
        'tts-timeout',
        'oversized-streamed-response',
        'invalid-offscreen-response-payload',
        'worker-restart-during-synthesis',
        'worker-restart-while-paused',
        'worker-restart-during-transition-gap',
        'pause-halfway-through-gap-preserves-remaining-delay',
        'keyboard-global-pause-resume-cancel',
        'offscreen-destruction-and-unique-recovery-session',
      ],
    }, null, 2))
  } catch (error) {
    const chromeErrors = chrome.stderr.join('').trim()
    if (chromeErrors) console.error(chromeErrors)
    throw error
  } finally {
    if (context) await restoreOffscreenFault(context).catch(() => undefined)
    cdp.close()
    await chrome.close()
    await fakeTts.close()
  }
}

await main()
