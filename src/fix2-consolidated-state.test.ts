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
    const tests = read('docker/coqui-local/tests/test_app.py')

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

  it('uses the exact built image for root-independent real-model evidence', () => {
    const script = read('scripts/validate-real-coqui.sh')

    expect(script).toContain('cd "${ROOT_DIR}"')
    expect(script).toContain('images -q coqui-local')
    expect(script).toContain('docker run --rm -v "${model_volume}:/models:ro" "${image_id}"')
    expect(script).not.toContain('alpine:')
  })

  it('prevents stale workflow rerun attempts from publishing status', () => {
    const publisher = read('.github/workflows/publish-ci-status.yml')

    expect(publisher).toContain('current_attempt = int(current_run.get(\'run_attempt\') or 1)')
    expect(publisher).toContain('if current_attempt != run_attempt:')
  })
})
