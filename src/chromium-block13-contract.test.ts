import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}

describe('Chromium Block 13 matrix contract', () => {
  it('keeps the expanded matrix in the permanent Chromium entry point', () => {
    const wrapper = read('scripts/run-chromium-e2e.mjs')
    const matrix = read('scripts/chromium-block13-e2e.mjs')

    expect(wrapper).toContain("resolve(ROOT, 'scripts/chromium-e2e.mjs')")
    expect(wrapper).toContain("resolve(ROOT, 'scripts/chromium-block13-e2e.mjs')")
    expect(wrapper).toContain('for (const childScript of CHILD_SCRIPTS)')

    for (const scenario of [
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
    ]) {
      expect(matrix).toContain(`'${scenario}'`)
    }
  })

  it('injects failures only through the diagnostic browser process', () => {
    const matrix = read('scripts/chromium-block13-e2e.mjs')
    const offscreen = read('src/offscreen.ts')
    const worker = read('src/background/service-worker.ts')

    expect(matrix).toContain('HTMLMediaElement.prototype')
    expect(matrix).toContain("chrome.runtime.onMessage.addListener(listener)")
    expect(matrix).toContain('Target.closeTarget')
    expect(offscreen).not.toContain('__readitBlock13FaultState')
    expect(worker).not.toContain('__readitBlock13FaultState')
    expect(worker).not.toContain('BLOCK13_')
  })

  it('proves registered keyboard shortcuts use session-global control routing', () => {
    const matrix = read('scripts/chromium-block13-e2e.mjs')
    const manifest = read('src/manifest.ts')
    const worker = read('src/background/service-worker.ts')

    expect(matrix).toContain('chrome.commands.getAll()')
    expect(matrix).toContain("['pause-speech', 'Alt+Shift+P']")
    expect(matrix).toContain("['resume-speech', 'Alt+Shift+U']")
    expect(matrix).toContain("['cancel-speech', 'Alt+Shift+C']")
    expect(matrix).toContain("kind: PLAYBACK_CONTROL,\n    action: 'pause',\n  })")
    expect(matrix).toContain("kind: PLAYBACK_CONTROL,\n    action: 'resume',\n  })")
    expect(matrix).toContain("kind: PLAYBACK_CONTROL,\n    action: 'cancel',\n  })")
    expect(manifest).toContain("'pause-speech'")
    expect(manifest).toContain("default: 'Alt+Shift+P'")
    expect(manifest).toContain("'resume-speech'")
    expect(manifest).toContain("default: 'Alt+Shift+U'")
    expect(manifest).toContain("'cancel-speech'")
    expect(manifest).toContain("default: 'Alt+Shift+C'")
    expect(worker).toContain("if (command === 'pause-speech') await routeControl('pause')")
    expect(worker).toContain("if (command === 'resume-speech') await routeControl('resume')")
    expect(worker).toContain("if (command === 'cancel-speech') await routeControl('cancel')")
  })

  it('retains fail-closed player and recovery assertions', () => {
    const matrix = read('scripts/chromium-block13-e2e.mjs')

    expect(matrix).toContain("replacement.error?.code === 'AUDIO_CLEANUP_FAILED'")
    expect(matrix).toContain("replacement.error?.stage === 'pause'")
    expect(matrix).toContain('afterFailure.player.playAttemptCount === before.player.playAttemptCount')
    expect(matrix).toContain('afterFailure.player.maxActivePlayerCount <= 1')
    expect(matrix).toContain('afterFailure.player.invariantViolationCount === 0')
    expect(matrix).toContain('diagnostics.player.activePlayerCount === 0')
    expect(matrix).toContain('diagnostics.player.maxActivePlayerCount <= 1')
    expect(matrix).toContain('diagnostics.player.invariantViolationCount === 0')
    expect(matrix).toContain("response.error?.code === 'OFFSCREEN_INTERRUPTED'")
    expect(matrix).toContain('replacement.sessionId !== start.sessionId')
  })
})
