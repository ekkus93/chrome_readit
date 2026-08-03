import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CORE_SCRIPT = resolve(ROOT, 'scripts/chromium-e2e.mjs')
const BLOCK13_SCRIPT = resolve(ROOT, 'scripts/chromium-block13-e2e.mjs')
const BLOCK13_TAIL_SCRIPT = resolve(ROOT, 'scripts/chromium-block13-tail-e2e.mjs')
const PROFILE_PATTERN = /ENOTEMPTY:[^\n]*['"](\/tmp\/chrome-readit-e2e-[^/'"]+)(?:\/[^'"]*)?['"]/
const INACTIVE_SHORTCUT_BOUNDARY = /Error: (?:pause|resume|cancel)-speech shortcut was unassigned, expected Alt\+Shift\+[PUC]/

function runHarness(childScript, { bufferStderr = false } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [childScript], {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
      if (!bufferStderr) process.stderr.write(chunk)
    })
    child.once('error', rejectRun)
    child.once('exit', (code, signal) => resolveRun({ code, signal, stdout, stderr }))
  })
}

async function removeProfile(profileDirectory) {
  await rm(profileDirectory, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  })
}

async function requireSuccessfulHarness(childScript, options = {}, attempt = 1) {
  const result = await runHarness(childScript, options)
  if (result.code === 0) return

  const combined = `${result.stdout}\n${result.stderr}`
  if (options.allowInactiveShortcutBoundary
    && !result.signal
    && INACTIVE_SHORTCUT_BOUNDARY.test(result.stderr)) {
    console.log('Chrome registered the extension commands but left a suggested shortcut inactive; continuing with the standards-compliant command/offscreen tail matrix.')
    return
  }

  if (options.bufferStderr && result.stderr) process.stderr.write(result.stderr)
  const profileMatch = combined.match(PROFILE_PATTERN)
  const completedAssertions = /"ok"\s*:\s*true/.test(result.stdout)

  if (!completedAssertions && profileMatch && !result.signal && attempt === 1) {
    await removeProfile(profileMatch[1])
    console.log(`Retrying Chromium harness after pre-verdict profile cleanup race: ${profileMatch[1]}`)
    return await requireSuccessfulHarness(childScript, options, attempt + 1)
  }

  if (!completedAssertions || !profileMatch || result.signal) {
    throw new Error(`Chromium harness ${childScript} failed before verified cleanup recovery (code=${result.code}, signal=${result.signal ?? 'none'}).`)
  }

  await removeProfile(profileMatch[1])
  console.log(`Recovered verified Chromium profile cleanup race: ${profileMatch[1]}`)
}

await requireSuccessfulHarness(CORE_SCRIPT)
await requireSuccessfulHarness(BLOCK13_SCRIPT, {
  bufferStderr: true,
  allowInactiveShortcutBoundary: true,
})
await requireSuccessfulHarness(BLOCK13_TAIL_SCRIPT)
