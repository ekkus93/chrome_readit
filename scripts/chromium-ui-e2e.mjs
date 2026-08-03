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
const PLAYBACK_DIAGNOSTICS = 'PLAYBACK_DIAGNOSTICS'
const LONG_AUDIO_MARKER = 'UI_REPLACEMENT_FIXTURE'
const extensionTargetBySession = new Map()

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

function makeSilentWav(durationMs = 250, sampleRate = 8_000) {
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

async function startFixtureServer() {
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
    if (request.method === 'GET' && request.url === '/selection') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><html><body><p id="selection">Initial selection.</p></body></html>')
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
      const body = await readJsonBody(request)
      const text = String(body.text ?? '')
      requests.push({ text, voice: String(body.voice ?? '') })
      const audio = makeSilentWav(text.includes(LONG_AUDIO_MARKER) ? 2_000 : 250)
      response.writeHead(200, {
        'content-type': 'audio/wav',
        'content-length': String(audio.length),
      })
      response.end(audio)
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
  assert(address && typeof address === 'object', 'Fixture server did not expose an address')
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
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
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

async function launchChrome(initialUrl) {
  const profileDirectory = await mkdtemp(resolve(tmpdir(), 'chrome-readit-ui-e2e-'))
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
    initialUrl,
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
      await rm(profileDirectory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      })
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

async function findWorker(cdp, port) {
  const workers = (await listTargets(port)).filter((target) => (
    target.type === 'service_worker' && String(target.url).startsWith('chrome-extension://')
  ))
  for (const worker of workers) {
    const sessionId = await attachTarget(cdp, worker.id)
    try {
      const name = await evaluate(cdp, sessionId, 'chrome.runtime?.getManifest?.().name')
      if (name === EXTENSION_NAME) return worker
    } finally {
      await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => undefined)
    }
  }
  return null
}

async function createExtensionPage(cdp, extensionId, path) {
  const created = await cdp.send('Target.createTarget', { url: `chrome-extension://${extensionId}/${path}` })
  const sessionId = await attachTarget(cdp, created.targetId)
  extensionTargetBySession.set(sessionId, created.targetId)
  await cdp.send('Target.activateTarget', { targetId: created.targetId })
  await waitFor(`${path} ready`, async () => (
    await evaluate(cdp, sessionId, 'document.readyState') === 'complete'
  ))
  return { targetId: created.targetId, sessionId }
}

async function activateExtensionSession(cdp, sessionId) {
  const targetId = extensionTargetBySession.get(sessionId)
  if (targetId) await cdp.send('Target.activateTarget', { targetId })
}

async function sendExtensionMessage(cdp, sessionId, message) {
  return await evaluate(cdp, sessionId, `(async () => await chrome.runtime.sendMessage(${JSON.stringify(message)}))()`)
}

async function queryStatus(cdp, sessionId) {
  return await sendExtensionMessage(cdp, sessionId, { kind: PLAYBACK_STATUS })
}

async function queryDiagnostics(cdp, sessionId) {
  const response = await sendExtensionMessage(cdp, sessionId, { kind: PLAYBACK_DIAGNOSTICS })
  assert(response?.ok === true, `Playback diagnostics unavailable: ${JSON.stringify(response)}`)
  return response
}

async function waitForActiveSource(cdp, sessionId, source, previousSessionId = null) {
  return await waitFor(`active ${source} session`, async () => {
    const status = await queryStatus(cdp, sessionId)
    if (status?.source !== source || status.sessionId === previousSessionId) return null
    return ['starting', 'synthesizing', 'playing', 'waiting', 'paused'].includes(status.state) ? status : null
  })
}

async function waitForState(cdp, sessionId, playbackSessionId, state) {
  return await waitFor(`session ${playbackSessionId} state ${state}`, async () => {
    const status = await queryStatus(cdp, sessionId)
    return status?.sessionId === playbackSessionId && status.state === state ? status : null
  })
}

async function setReactValue(cdp, sessionId, selector, value) {
  await activateExtensionSession(cdp, sessionId)
  const changed = await evaluate(cdp, sessionId, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return false
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    setter?.call(element, ${JSON.stringify(value)})
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  assert(changed === true, `Unable to set ${selector}`)
}

async function clickButton(cdp, sessionId, label) {
  await activateExtensionSession(cdp, sessionId)
  const result = await evaluate(cdp, sessionId, `(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)})
    if (!(button instanceof HTMLButtonElement)) return { found: false, disabled: false }
    const disabled = button.disabled
    if (!disabled) button.click()
    return { found: true, disabled }
  })()`)
  assert(result?.found === true, `Button ${label} was not found`)
  assert(result.disabled === false, `Button ${label} was disabled`)
}

async function clickSelector(cdp, sessionId, selector, activate = true) {
  if (activate) await activateExtensionSession(cdp, sessionId)
  const clicked = await evaluate(cdp, sessionId, `(() => {
    const button = document.querySelector(${JSON.stringify(selector)})
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false
    button.click()
    return true
  })()`)
  assert(clicked === true, `Unable to click ${selector}`)
}

async function setSelection(cdp, sessionId, text) {
  const selected = await evaluate(cdp, sessionId, `(() => {
    const node = document.getElementById('selection')
    if (!node) return false
    node.textContent = ${JSON.stringify(text)}
    const range = document.createRange()
    range.selectNodeContents(node)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    return selection?.toString() === ${JSON.stringify(text)}
  })()`)
  assert(selected === true, 'Unable to create the page selection')
}

async function waitForBodyText(cdp, sessionId, text) {
  await activateExtensionSession(cdp, sessionId)
  await waitFor(`UI text ${text}`, async () => (
    await evaluate(cdp, sessionId, `document.body.innerText.includes(${JSON.stringify(text)})`)
  ))
}

async function buttonEnabled(cdp, sessionId, label) {
  await activateExtensionSession(cdp, sessionId)
  return await evaluate(cdp, sessionId, `(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)})
    return button instanceof HTMLButtonElement && !button.disabled
  })()`)
}

async function main() {
  const fixtureServer = await startFixtureServer()
  const selectionUrl = `http://127.0.0.1:${fixtureServer.port}/selection`
  const chrome = await launchChrome(selectionUrl)
  const cdp = new CdpConnection(`ws://127.0.0.1:${chrome.port}${chrome.browserPath}`)

  try {
    await cdp.connect()
    const worker = await waitFor('Read It worker', () => findWorker(cdp, chrome.port))
    const extensionId = new URL(worker.url).host
    const workerSessionId = await attachTarget(cdp, worker.id)
    await evaluate(cdp, workerSessionId, `chrome.storage.sync.set(${JSON.stringify({
      ttsUrl: `http://127.0.0.1:${fixtureServer.port}/api/tts`,
      voice: 'p225',
      rate: 1,
    })})`)
    await cdp.send('Target.detachFromTarget', { sessionId: workerSessionId })

    const selectionTarget = await waitFor('selection page target', async () => (
      (await listTargets(chrome.port)).find((target) => target.type === 'page' && target.url === selectionUrl)
    ))
    const selectionSessionId = await attachTarget(cdp, selectionTarget.id)
    const popup = await createExtensionPage(cdp, extensionId, 'src/popup.html')
    const options = await createExtensionPage(cdp, extensionId, 'src/options.html')
    await activateExtensionSession(cdp, popup.sessionId)
    await waitFor('popup controls', async () => await evaluate(cdp, popup.sessionId, 'Boolean(document.querySelector("#tryText"))'))
    await activateExtensionSession(cdp, options.sessionId)
    await waitFor('Options controls', async () => await evaluate(cdp, options.sessionId, 'Boolean(document.querySelector("#test"))'))

    const diagnosticsBefore = await queryDiagnostics(cdp, popup.sessionId)
    const sessions = []

    await setSelection(cdp, selectionSessionId, `${LONG_AUDIO_MARKER} selection one.`)
    await cdp.send('Target.activateTarget', { targetId: selectionTarget.id })
    await clickSelector(cdp, popup.sessionId, 'button[aria-label="Read selected text"]', false)
    const selectionOne = await waitForActiveSource(cdp, popup.sessionId, 'selection')
    sessions.push(selectionOne.sessionId)

    await setReactValue(cdp, popup.sessionId, '#tryText', `${LONG_AUDIO_MARKER} popup test.`)
    await clickButton(cdp, popup.sessionId, 'Try speech')
    const popupTest = await waitForActiveSource(cdp, popup.sessionId, 'popup-test', selectionOne.sessionId)
    sessions.push(popupTest.sessionId)

    await setReactValue(cdp, options.sessionId, '#test', `${LONG_AUDIO_MARKER} Options test.`)
    await clickButton(cdp, options.sessionId, 'Test speech')
    await activateExtensionSession(cdp, popup.sessionId)
    const optionsTest = await waitForActiveSource(cdp, popup.sessionId, 'options-test', popupTest.sessionId)
    sessions.push(optionsTest.sessionId)
    await waitForBodyText(cdp, popup.sessionId, 'Test speech was superseded by another playback request.')
    await waitFor('popup test button recovery', () => buttonEnabled(cdp, popup.sessionId, 'Try speech'))

    await setSelection(cdp, selectionSessionId, `${LONG_AUDIO_MARKER} selection two.`)
    await cdp.send('Target.activateTarget', { targetId: selectionTarget.id })
    await clickSelector(cdp, popup.sessionId, 'button[aria-label="Read selected text"]', false)
    await activateExtensionSession(cdp, options.sessionId)
    const selectionTwo = await waitForActiveSource(cdp, options.sessionId, 'selection', optionsTest.sessionId)
    sessions.push(selectionTwo.sessionId)
    await waitForBodyText(cdp, options.sessionId, 'Test speech was superseded by another playback request.')
    await waitFor('Options test button recovery', () => buttonEnabled(cdp, options.sessionId, 'Test speech'))

    await setSelection(cdp, selectionSessionId, `${LONG_AUDIO_MARKER} selection three.`)
    await cdp.send('Target.activateTarget', { targetId: selectionTarget.id })
    await clickSelector(cdp, popup.sessionId, 'button[aria-label="Read selected text"]', false)
    const selectionThree = await waitForActiveSource(cdp, popup.sessionId, 'selection', selectionTwo.sessionId)
    sessions.push(selectionThree.sessionId)

    await clickButton(cdp, popup.sessionId, 'Pause')
    await waitForState(cdp, popup.sessionId, selectionThree.sessionId, 'paused')
    await clickButton(cdp, popup.sessionId, 'Resume')
    await waitForState(cdp, popup.sessionId, selectionThree.sessionId, 'playing')
    await clickButton(cdp, popup.sessionId, 'Cancel')
    await waitForState(cdp, popup.sessionId, selectionThree.sessionId, 'cancelled')

    await setReactValue(cdp, options.sessionId, '#test', `${LONG_AUDIO_MARKER} Options control surface.`)
    await clickButton(cdp, options.sessionId, 'Test speech')
    const optionsControls = await waitForActiveSource(cdp, options.sessionId, 'options-test', selectionThree.sessionId)
    await clickButton(cdp, options.sessionId, 'Pause')
    await waitForState(cdp, options.sessionId, optionsControls.sessionId, 'paused')
    await clickButton(cdp, options.sessionId, 'Resume')
    await waitForState(cdp, options.sessionId, optionsControls.sessionId, 'playing')
    await clickButton(cdp, options.sessionId, 'Stop')
    await waitForState(cdp, options.sessionId, optionsControls.sessionId, 'cancelled')

    await clickButton(cdp, options.sessionId, 'Test server')
    await waitForBodyText(cdp, options.sessionId, 'Server accepting requests')

    const diagnosticsAfter = await queryDiagnostics(cdp, options.sessionId)
    const newEvents = diagnosticsAfter.events.slice(diagnosticsBefore.events.length)
    for (const sessionId of sessions.slice(0, -1)) {
      assert(newEvents.some((event) => event.event === 'superseded' && event.status.sessionId === sessionId), `Session ${sessionId} lacked a superseded event`)
      assert(!newEvents.some((event) => event.event === 'completed' && event.status.sessionId === sessionId), `Superseded session ${sessionId} completed`)
    }
    assert(diagnosticsAfter.player.activePlayerCount === 0, 'UI controls left a player active')
    assert(diagnosticsAfter.player.maxActivePlayerCount <= 1, 'UI workflows exceeded one active player')
    assert(diagnosticsAfter.player.invariantViolationCount === 0, 'UI workflows recorded a player invariant violation')

    console.log(JSON.stringify({
      ok: true,
      extensionId,
      synthesizedRequests: fixtureServer.requests.length,
      player: diagnosticsAfter.player,
      verified: [
        'popup-read-selection-button',
        'popup-test-speech-button',
        'options-test-speech-button',
        'selection-popup-options-selection-selection-replacement',
        'popup-supersession-ui-recovery',
        'options-supersession-ui-recovery',
        'popup-pause-resume-cancel-buttons',
        'options-pause-resume-stop-buttons',
        'options-server-probe-button',
      ],
    }, null, 2))
  } catch (error) {
    const chromeErrors = chrome.stderr.join('').trim()
    if (chromeErrors) console.error(chromeErrors)
    throw error
  } finally {
    cdp.close()
    await chrome.close()
    await fixtureServer.close()
  }
}

await main()
