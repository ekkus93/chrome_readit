import { spawnSync } from 'node:child_process'
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

describe('tagged release contracts', () => {
  it('publishes retained release assets only for version tags after validation', () => {
    const workflow = read('.github/workflows/tagged-release.yml')
    const references = actionReferences(workflow)

    expect(references.length).toBeGreaterThan(0)
    for (const reference of references) {
      expect(reference).toMatch(/^[^@\s]+@[0-9a-f]{40}$/)
    }

    expect(workflow).toContain("tags:\n      - 'v*'")
    expect(workflow).toContain('contents: write')
    expect(workflow).toContain('cancel-in-progress: false')
    expect(workflow).toContain('run: npm ci')
    expect(workflow).toContain('run: npm run lint')
    expect(workflow).toContain('run: npm run typecheck')
    expect(workflow).toContain('npx vitest --run --coverage')
    expect(workflow).toContain('npm run test:chromium')
    expect(workflow).toContain('npm run test:chromium-ui')
    expect(workflow).toContain('--cov-branch')
    expect(workflow).toContain('python scripts/check_python_coverage.py')
    expect(workflow).toContain("grep -q 'host_ip: 127.0.0.1'")
    expect(workflow).toContain('process.env.GITHUB_REF_NAME !== expectedTag')
    expect(workflow).toContain('bash scripts/package-tagged-release.sh "${GITHUB_REF_NAME}" release')
    expect(workflow).toContain('tagged-release-assets-${{ github.ref_name }}')
    expect(workflow).toContain('retention-days: 90')
    expect(workflow).toContain('if-no-files-found: error')
    expect(workflow).toContain('gh release view "${tag}"')
    expect(workflow).toContain('gh release upload "${tag}" release/*')
    expect(workflow).toContain('--clobber')
    expect(workflow).toContain('gh release create "${tag}" release/*')
    expect(workflow).toContain('--verify-tag')
    expect(workflow).toContain('--generate-notes')
  })

  it('packages version-matched extension and Docker assets with checksums', () => {
    const scriptPath = resolve(root, 'scripts/package-tagged-release.sh')
    const script = read('scripts/package-tagged-release.sh')
    const syntax = spawnSync('bash', ['-n', scriptPath], { encoding: 'utf8' })

    expect(syntax.status, syntax.stderr).toBe(0)
    expect(script).toContain("^v[0-9]+(\\.[0-9]+){2,3}$")
    expect(script).toContain('expected_tag="v${manifest_version}"')
    expect(script).toContain('dist/manifest.json')
    expect(script).toContain('zip -q -r')
    expect(script).toContain('tar -czf')
    expect(script).toContain('docker/docker-compose.yml')
    expect(script).toContain('docker/coqui-local')
    expect(script).toContain('sha256sum')
    expect(script).toContain('> SHA256SUMS')
  })
})
