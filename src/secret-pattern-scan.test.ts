import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}

describe('secret-pattern evidence contract', () => {
  it('scans full history without printing matched values', () => {
    const script = read('scripts/check-secret-patterns.sh')

    expect(script).toContain('git log --all --format=fuller --patch --no-ext-diff --binary')
    expect(script).toContain('grep -Eaq')
    expect(script).not.toContain('grep -Ean')
    expect(script).toContain('Secret scan failure: %s-like material exists in Git history.')
    expect(script).toContain('git ls-files')
    expect(script).toContain('PRIVATE KEY')
  })

  it('runs in a pinned full-history workflow', () => {
    const workflow = read('.github/workflows/secret-pattern-scan.yml')

    expect(workflow).toContain('actions/checkout@11d5960a326750d5838078e36cf38b85af677262')
    expect(workflow).toContain('fetch-depth: 0')
    expect(workflow).toContain('bash scripts/check-secret-patterns.sh')
    expect(workflow).not.toMatch(/uses:\s+[^\s@]+@(main|master|v\d+)/)
  })
})
