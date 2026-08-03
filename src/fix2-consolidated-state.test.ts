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

  it('uses structured loopback data, the exact image, and configured VCTK voice for real-model evidence', () => {
    const script = read('scripts/validate-real-coqui.sh')
    const workflow = read('.github/workflows/real-coqui-validation.yml')

    expect(script).toContain('cd "${ROOT_DIR}"')
    expect(script).toContain('PREFERRED_VOICE="${REAL_COQUI_VOICE:-p225}"')
    expect(script).toContain('if preferred in voices:')
    expect(script).toContain('selected-voice.txt')
    expect(script).toContain('records = [json.loads(line) for line in out.splitlines() if line.strip()]')
    expect(script).toContain('publisher.get("URL") == "127.0.0.1"')
    expect(script).toContain('publisher.get("PublishedPort") == port')
    expect(script).toContain('capture_runtime_evidence')
    expect(script).toContain('final-container.log')
    expect(workflow).toContain('if [[ ! -s reports/real-coqui/final-container.log ]]')
    expect(workflow).toContain('workflow-final-container.log')
    expect(script).toContain('images -q coqui-local')
    expect(script).toContain('docker run --rm -v "${model_volume}:/models:ro" "${image_id}"')
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
