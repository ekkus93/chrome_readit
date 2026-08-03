import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CHILD_SCRIPT = resolve(ROOT, 'scripts/chromium-e2e.mjs')
const PROFILE_PATTERN = /ENOTEMPTY:[^\n]*['"](\/tmp\/chrome-readit-e2e-[^/'"]+)(?:\/[^'"]*)?['"]/

function runHarness() {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [CHILD_SCRIPT], {
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
      process.stderr.write(chunk)
    })
    child.once('error', rejectRun)
    child.once('exit', (code, signal) => resolveRun({ code, signal, stdout, stderr }))
  })
}

const result = await runHarness()
if (result.code === 0) process.exit(0)

const combined = `${result.stdout}\n${result.stderr}`
const profileMatch = combined.match(PROFILE_PATTERN)
const completedAssertions = /"ok"\s*:\s*true/.test(result.stdout)
if (!completedAssertions || !profileMatch || result.signal) {
  throw new Error(`Chromium harness failed before verified cleanup recovery (code=${result.code}, signal=${result.signal ?? 'none'}).`)
}

await rm(profileMatch[1], {
  recursive: true,
  force: true,
  maxRetries: 10,
  retryDelay: 100,
})
console.log(`Recovered verified Chromium profile cleanup race: ${profileMatch[1]}`)
