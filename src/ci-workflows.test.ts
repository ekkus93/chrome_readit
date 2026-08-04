import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}

function actionReferences(workflow: string): string[] {
  return [...workflow.matchAll(/^\s*uses:\s*([^\s#]+).*$/gm)].map((match) => match[1])
}

function expectImmutableActions(workflow: string): void {
  const references = actionReferences(workflow)
  expect(references.length).toBeGreaterThan(0)
  for (const reference of references) {
    expect(reference).toMatch(/^[^@\s]+@[0-9a-f]{40}$/)
  }
}

describe('FIX2 workflow contracts', () => {
  it('uses immutable actions and normal npm resolution in CI', () => {
    const workflow = read('.github/workflows/ci.yml')

    expectImmutableActions(workflow)
    expect(workflow).toContain('run: npm ci')
    expect(workflow).not.toContain('--legacy-peer-deps')
    expect(workflow).toContain('--coverage.thresholds.lines=85')
    expect(workflow).toContain('--coverage.thresholds.functions=85')
    expect(workflow).toContain('--coverage.thresholds.statements=85')
    expect(workflow).toContain('--coverage.thresholds.branches=75')
    expect(workflow).toContain('node scripts/check-coverage-surface.mjs')
    expect(workflow).toContain('node scripts/check-coverage-thresholds.mjs')
    expect(workflow).toContain('python scripts/check_python_coverage.py')
    expect(workflow).toContain('--cov-branch')
    expect(workflow).toContain('flags: typescript-unit')
    expect(workflow).toContain('flags: python-coqui')
    expect(workflow).toContain('bash -n scripts/package-tagged-release.sh')
    expect(workflow).not.toContain('actions/upload-artifact@')
    expect(workflow).not.toContain('retention-days:')
    expect(workflow).toContain("minimum_chrome_version is missing")
  })

  it('pins hygiene and real-model workflow actions', () => {
    expectImmutableActions(read('.github/workflows/fix2-hygiene.yml'))
    expectImmutableActions(read('.github/workflows/real-coqui-validation.yml'))
  })

  it('guards CI status publication by both run ID and run attempt', () => {
    const publisher = read('.github/workflows/publish-ci-status.yml')

    expect(publisher).toContain('latest_run_id != run_id')
    expect(publisher).toContain("current_run = gh_json(f'repos/{repo}/actions/runs/{run_id}')")
    expect(publisher).toContain('current_attempt != run_attempt')
    expect(publisher).toContain("Ignoring stale attempt {run_attempt}")
  })

  it('keeps real-model execution explicitly requested without retaining artifacts', () => {
    const workflow = read('.github/workflows/real-coqui-validation.yml')
    const publisher = read('scripts/publish-real-coqui-status.py')

    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('\n  push:')
    expect(workflow).toContain('branches: [master]')
    expect(workflow).toContain('- docs/CHROME_READIT_FIX2_REAL_COQUI_VALIDATION_REQUEST.md')
    expect(workflow.match(/- docs\/CHROME_READIT_FIX2_REAL_COQUI_VALIDATION_REQUEST\.md/g)).toHaveLength(1)
    expect(workflow).toContain('scripts/validate-real-coqui.sh')
    expect(workflow).toContain('scripts/publish-real-coqui-status.py --phase in_progress')
    expect(workflow).toContain('image-inspect.json')
    expect(workflow).not.toContain('actions/upload-artifact@')
    expect(workflow).not.toContain('retention-days:')
    expect(publisher).toContain('"artifact_retention": "tagged-releases-only"')
    expect(publisher).toContain('not retained for non-tag runs')
    expect(publisher).not.toContain('artifact_for_run')
  })
})
