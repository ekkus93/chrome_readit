import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}

describe('Chromium Block 13 matrix contract', () => {
  it('keeps the complete matrix in the permanent Chromium entry point', () => {
    const wrapper = read('scripts/run-chromium-e2e.mjs')
    const matrix = read('scripts/chromium-block13-e2e.mjs')
    const tail = read('scripts/chromium-block13-tail-e2e.mjs')

    expect(wrapper).toContain("resolve(ROOT, 'scripts/chromium-e2e.mjs')")
    expect(wrapper).toContain("resolve(ROOT, 'scripts/chromium-block13-e2e.mjs')")
    expect(wrapper).toContain("resolve(ROOT, 'scripts/chromium-block13-tail-e2e.mjs')")
    expect(wrapper).toContain('await requireSuccessfulHarness(CORE_SCRIPT)')
    expect(wrapper).toContain('await requireSuccessfulHarness(BLOCK13_SCRIPT')
    expect(wrapper).toContain('await requireSuccessfulHarness(BLOCK13_TAIL_SCRIPT)')

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
    ]) {
      expect(matrix).toContain(`'${scenario}'`)
    }
    for (const scenario of [
      'registered-command-names',
      'manifest-suggested-shortcuts',
      'runtime-shortcut-assignment-recorded',
      'session-global-pause-resume-cancel',
      'offscreen-destruction-interruption-classification',
      'unique-session-offscreen-recovery',
    ]) {
      expect(tail).toContain(`'${scenario}'`)
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

  it('classifies inactive shortcut assignment without hiding command failures', () => {
    const wrapper = read('scripts/run-chromium-e2e.mjs')
    const tail = read('scripts/chromium-block13-tail-e2e.mjs')
    const manifest = read('src/manifest.ts')
    const worker = read('src/background/service-worker.ts')

    expect(wrapper).toContain('INACTIVE_SHORTCUT_BOUNDARY')
    expect(wrapper).toContain('allowInactiveShortcutBoundary')
    expect(wrapper).toContain('INACTIVE_SHORTCUT_BOUNDARY.test(result.stderr)')
    expect(wrapper).toContain('!result.signal')
    expect(tail).toContain('chrome.commands.getAll()')
    expect(tail).toContain('if (command.shortcut)')
    expect(tail).toContain("['pause-speech', 'Alt+Shift+P']")
    expect(tail).toContain("['resume-speech', 'Alt+Shift+U']")
    expect(tail).toContain("['cancel-speech', 'Alt+Shift+C']")
    expect(tail).toContain("kind: PLAYBACK_CONTROL, action")
    expect(tail).not.toContain('expectedSessionId')
    expect(tail).toContain('async function waitForActivePlayer')
    expect(tail).toContain("await waitForActivePlayer(cdp, page.sessionId, 'global command audible player')")
    expect(tail).toContain("await waitForActivePlayer(cdp, page.sessionId, 'offscreen destruction audible player')")
    expect(manifest).toContain("default: 'Alt+Shift+P'")
    expect(manifest).toContain("default: 'Alt+Shift+U'")
    expect(manifest).toContain("default: 'Alt+Shift+C'")
    expect(worker).toContain("if (command === 'pause-speech') await routeControl('pause')")
    expect(worker).toContain("if (command === 'resume-speech') await routeControl('resume')")
    expect(worker).toContain("if (command === 'cancel-speech') await routeControl('cancel')")
  })

  it('retains fail-closed player and offscreen recovery assertions', () => {
    const matrix = read('scripts/chromium-block13-e2e.mjs')
    const tail = read('scripts/chromium-block13-tail-e2e.mjs')

    expect(matrix).toContain("replacement.error?.code === 'AUDIO_CLEANUP_FAILED'")
    expect(matrix).toContain("replacement.error?.stage === 'pause'")
    expect(matrix).toContain('afterFailure.player.playAttemptCount === before.player.playAttemptCount')
    expect(matrix).toContain('afterFailure.player.maxActivePlayerCount <= 1')
    expect(matrix).toContain('afterFailure.player.invariantViolationCount === 0')
    expect(tail).toContain("interrupted.error?.code === 'OFFSCREEN_INTERRUPTED'")
    expect(tail).toContain('recovery.sessionId !== start.sessionId')
    expect(tail).toContain('diagnostics.player.activePlayerCount === 0')
    expect(tail).toContain('diagnostics.player.maxActivePlayerCount <= 1')
    expect(tail).toContain('diagnostics.player.invariantViolationCount === 0')
  })
})
