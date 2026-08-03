import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}

describe('consolidated FIX2 source state', () => {
  it('keeps lowercase street continuations without reviving broad uppercase merges', () => {
    const source = read('src/lib/text-segmentation.ts')

    expect(source).toContain('if (isLowercaseLetter(nextCharacter)) return true')
    expect(source).toContain("return /(?:^|\\s)(?:to|in|at|from|near|toward|towards|visit|visited)$/i.test(prefix)")
    expect(source).not.toContain("&& /(?:^|\\s)\\d+")
  })

  it('classifies Coqui readiness separately from internal submission failure', () => {
    const app = read('docker/coqui-local/app.py')
    const tests = [
      read('docker/coqui-local/tests/test_app.py'),
      read('docker/coqui-local/tests/test_submission_classification.py'),
    ].join('\n')

    expect(app).toContain('class BackendNotReadyError(RuntimeError)')
    expect(app).toContain('except BackendNotReadyError:')
    expect(app).toContain('LOGGER.exception("Synthesis submission failed")')
    expect(app).toContain('raise_api_error(500, "INTERNAL_ERROR", "The TTS service failed unexpectedly.")')
    expect(tests).toContain('test_executor_submit_failure_is_internal_not_not_ready')
  })

  it('contains only the shared playback message protocol', () => {
    const messaging = read('src/lib/messaging.ts')
    const worker = read('src/background/service-worker.ts')
    const hygiene = read('scripts/check-fix2-hygiene.sh')

    for (const legacy of (
      ['LegacyPlaybackControlRequest', 'SPEECH_STATUS', 'PAUSE_SPEECH', 'RESUME_SPEECH', 'CANCEL_SPEECH']
    )) {
      expect(messaging).not.toContain(legacy)
      expect(worker).not.toContain(legacy)
    }
    expect(hygiene).toContain('chrome-readit-legacy-protocol.txt')
  })

  it('uses a deterministic exact image and a fail-closed real-model evidence matrix', () => {
    const script = read('scripts/validate-real-coqui.sh')
    const workflow = read('.github/workflows/real-coqui-validation.yml')
    const compose = read('docker/docker-compose.yml')

    expect(compose).toContain('image: chrome-readit-coqui-local:fix2')
    expect(script).toContain('dc down -v --remove-orphans')
    expect(script).toContain('dc images -q coqui-local')
    expect(script).toContain('PREFERRED_VOICE="${REAL_COQUI_VOICE:-p225}"')
    expect(script).toContain('if preferred in voices:')
    expect(script).toContain('selected-voice.txt')
    expect(script).toContain('publisher.get("URL") == "127.0.0.1"')
    expect(script).toContain('publisher.get("PublishedPort") == port')
    expect(script).toContain('uid=10001(readit)')
    expect(script).toContain('PID 1 is not the single-worker Uvicorn command')
    expect(script).toContain('ready-saturated.json')
    expect(script).toContain('queue-rejected.json')
    expect(script).toContain('SYNTHESIS_TIMEOUT')
    expect(script).toContain('temp-files-after-timeout-response.txt')
    expect(script).toContain('model-cache-before-recreate.tsv')
    expect(script).toContain('model-cache-after-recreate.tsv')
    expect(script).toContain('removed-tts-play.json')
    expect(script).toContain('host-listeners.txt')
    expect(script).toContain('capture_runtime_evidence')
    expect(script).toContain('final-container.log')
    expect(workflow).toContain('if [[ ! -s reports/real-coqui/final-container.log ]]')
    expect(workflow).toContain('workflow-final-container.log')
    expect(script).toContain('docker image inspect "${image_id}"')
    expect(script).not.toContain('alpine:')
  })

  it('retains direct E2E player snapshots and initializes them through a bounded offscreen handshake', () => {
    const worker = read('src/background/service-worker.ts')
    const offscreen = read('src/offscreen.ts')

    expect(offscreen).toContain('player: getRuntimeState().coordinator.getPlayerDiagnostics()')
    expect(offscreen).toContain("event: 'state-changed'")
    expect(offscreen).toContain('status: runtimeState.coordinator.getStatus()')
    expect(worker).toContain('const diagnosticEvents: PlaybackEvent[] = []')
    expect(worker).toContain('const diagnosticSnapshotWaiters = new Set<() => void>()')
    expect(worker).toContain('await ensureOffscreenPlaybackDocument()')
    expect(worker).toContain('await waitForInitialDiagnostics()')
    expect(worker).toContain('void queryPlaybackDiagnostics().then(sendResponse)')
    expect(worker).toContain('events: [...diagnosticEvents]')
    expect(worker).toContain('player: { ...latestPlayerDiagnostics }')
  })

  it('runs real popup and Options workflows and keeps UI recovery fail-closed', () => {
    const ci = read('.github/workflows/ci.yml')
    const packageJson = read('package.json')
    const uiHarness = read('scripts/chromium-ui-e2e.mjs')
    const cleanupWrapper = read('scripts/run-chromium-e2e.mjs')
    const popup = read('src/popup/Popup.tsx')
    const options = read('src/options/Options.tsx')
    const popupRace = read('src/popup/Popup.start-response-race.test.tsx')
    const optionsRace = read('src/options/Options.start-response-race.test.tsx')
    const popupMissed = read('src/popup/Popup.missed-event-recovery.test.tsx')
    const optionsMissed = read('src/options/Options.missed-event-recovery.test.tsx')

    expect(ci).toContain('npm run test:chromium 2>&1 | tee reports/chromium-e2e.log')
    expect(ci).toContain('npm run test:chromium-ui 2>&1 | tee -a reports/chromium-e2e.log')
    expect(packageJson).toContain('scripts/run-chromium-e2e.mjs')
    expect(uiHarness).toContain('selection-popup-options-selection-selection-replacement')
    expect(uiHarness).toContain('popup-pause-resume-cancel-buttons')
    expect(uiHarness).toContain('options-pause-resume-stop-buttons')
    expect(uiHarness).toContain('const extensionTargetBySession = new Map()')
    expect(uiHarness).toContain('async function activateExtensionSession')
    expect(uiHarness).toContain("await cdp.send('Target.activateTarget', { targetId })")
    expect(uiHarness).toContain("await activateExtensionSession(cdp, popup.sessionId)\n    const optionsTest = await waitForActiveSource(cdp, popup.sessionId, 'options-test', popupTest.sessionId)")
    expect(uiHarness).toContain("await activateExtensionSession(cdp, options.sessionId)\n    const selectionTwo = await waitForActiveSource(cdp, options.sessionId, 'selection', optionsTest.sessionId)")
    expect(cleanupWrapper).toContain('const completedAssertions = /"ok"\\s*:\\s*true/')
    expect(cleanupWrapper).toContain('/tmp\\/chrome-readit-e2e-')
    expect(cleanupWrapper).toContain('maxRetries: 10')
    expect(popup).toContain('ACTIVE_TEST_STATUS_POLL_MS = 100')
    expect(options).toContain('ACTIVE_TEST_STATUS_POLL_MS = 100')
    expect(popup).toContain('testRequestBaselineSessionIdRef')
    expect(options).toContain('testRequestBaselineSessionIdRef')
    expect(popup).toContain('if (!mounted || pollInFlight) return')
    expect(options).toContain('if (!mounted || pollInFlight) return')
    expect(popupRace).toContain('late accepted response resurrect a superseded test session')
    expect(optionsRace).toContain('late accepted response resurrect a superseded test session')
    expect(popupMissed).toContain('authoritative polling when supersession broadcast is missed')
    expect(optionsMissed).toContain('authoritative polling when supersession broadcast is missed')
  })

  it('prevents stale workflow attempts from publishing either status issue', () => {
    const ciPublisher = read('.github/workflows/publish-ci-status.yml')
    const runtimePublisher = read('scripts/publish-real-coqui-status.py')

    expect(ciPublisher).toContain('current_attempt = int(current_run.get(\'run_attempt\') or 1)')
    expect(ciPublisher).toContain('if current_attempt != run_attempt:')
    expect(runtimePublisher).toContain('latest_run_id != run_id')
    expect(runtimePublisher).toContain('current_attempt != attempt')
    expect(runtimePublisher).toContain('Runtime artifact belongs to a different workflow run.')
  })
})
