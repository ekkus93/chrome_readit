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
    expect(workflow).toContain('--coverage.thresholds.lines=80')
    expect(workflow).toContain('--coverage.thresholds.functions=80')
    expect(workflow).toContain('--coverage.thresholds.statements=80')
    expect(workflow).toContain('--coverage.thresholds.branches=70')
    expect(workflow.match(/if-no-files-found:\s*error/g)).toHaveLength(2)
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

  it('keeps the real-model workflow opt-in and retains evidence', () => {
    const workflow = read('.github/workflows/real-coqui-validation.yml')

    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).not.toContain('\n  push:')
    expect(workflow).toContain('scripts/validate-real-coqui.sh')
    expect(workflow).toContain('image-inspect.json')
    expect(workflow).toContain('real-coqui-${{ github.run_id }}-${{ github.run_attempt }}')
    expect(workflow).toContain('if-no-files-found: error')
  })
})
