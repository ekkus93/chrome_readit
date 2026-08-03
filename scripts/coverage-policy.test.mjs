import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { auditCoverageSurface, globToRegExp } from './check-coverage-surface.mjs'
import { checkCoverage } from './check-coverage-thresholds.mjs'

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'chrome-readit-coverage-'))
  for (const path of files) {
    const absolute = join(root, path)
    mkdirSync(join(absolute, '..'), { recursive: true })
    writeFileSync(absolute, 'export const value = 1\n')
  }
  return root
}

function coverageFile(root, entries) {
  const path = join(root, 'coverage.json')
  const report = {}
  for (const [relative, counts] of Object.entries(entries)) {
    report[join(root, relative)] = {
      statementMap: { 0: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } } },
      fnMap: { 0: { name: 'f', decl: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } }, loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } } } },
      branchMap: { 0: { type: 'if', locations: [{ start: { line: 1, column: 0 }, end: { line: 1, column: 1 } }, { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } }] } },
      s: { 0: counts.statement },
      f: { 0: counts.function },
      b: { 0: counts.branches },
    }
  }
  writeFileSync(path, JSON.stringify(report))
  return path
}

describe('coverage surface policy', () => {
  it('matches the complete production glob', () => {
    const matcher = globToRegExp('src/**/*.{ts,tsx}')
    expect(matcher.test('src/lib/new-runtime.ts')).toBe(true)
    expect(matcher.test('src/ui/NewRuntime.tsx')).toBe(true)
    expect(matcher.test('scripts/tool.ts')).toBe(false)
  })

  it('reports new runtime TS and TSX files outside a narrowed measured surface', () => {
    const root = fixture(['src/lib/new-runtime.ts', 'src/ui/NewRuntime.tsx'])
    const result = auditCoverageSurface({ root, includePatterns: ['src/lib/existing.ts'], approvedExclusions: [] })
    expect(result.missing).toEqual(['src/lib/new-runtime.ts', 'src/ui/NewRuntime.tsx'])
  })

  it('ignores tests and declarations while accepting an exact bootstrap exclusion', () => {
    const root = fixture(['src/runtime.ts', 'src/runtime.test.ts', 'src/types.d.ts', 'src/bootstrap.tsx'])
    const result = auditCoverageSurface({
      root,
      includePatterns: ['src/**/*.{ts,tsx}'],
      approvedExclusions: [{ path: 'src/bootstrap.tsx', reason: 'bootstrap only' }],
    })
    expect(result.productionFiles).toEqual(['src/bootstrap.tsx', 'src/runtime.ts'])
    expect(result.excluded).toEqual(['src/bootstrap.tsx'])
    expect(result.measured).toEqual(['src/runtime.ts'])
  })

  it('rejects broad or nonexistent approved exclusions', () => {
    const root = fixture(['src/runtime.ts'])
    const result = auditCoverageSurface({
      root,
      approvedExclusions: [{ path: 'src', reason: 'too broad' }],
    })
    expect(result.invalidExclusions).toContain('src: approved exclusion is not a file')
    expect(result.invalidExclusions).toContain('src: approved exclusion is not production TypeScript')
  })
})

describe('critical coverage checker', () => {
  it('fails closed for missing or malformed reports', () => {
    const root = fixture(['src/runtime.ts'])
    expect(checkCoverage({ coveragePath: join(root, 'missing.json'), root, globalThresholds: {}, criticalThresholds: {} }).ok).toBe(false)
    const malformed = join(root, 'malformed.json')
    writeFileSync(malformed, '{')
    expect(checkCoverage({ coveragePath: malformed, root, globalThresholds: {}, criticalThresholds: {} }).ok).toBe(false)
  })

  it('names a missing critical file', () => {
    const root = fixture(['src/runtime.ts'])
    const path = coverageFile(root, { 'src/runtime.ts': { statement: 1, function: 1, branches: [1, 1] } })
    const result = checkCoverage({
      coveragePath: path,
      root,
      globalThresholds: {},
      criticalThresholds: { 'src/missing.ts': { lines: 90 } },
    })
    expect(result.errors).toContain('Critical coverage file is missing: src/missing.ts')
  })

  it('reports the exact critical-file percentage below threshold', () => {
    const root = fixture(['src/runtime.ts'])
    const path = coverageFile(root, { 'src/runtime.ts': { statement: 1, function: 1, branches: [1, 0] } })
    const result = checkCoverage({
      coveragePath: path,
      root,
      globalThresholds: {},
      criticalThresholds: { 'src/runtime.ts': { branches: 75 } },
    })
    expect(result.errors).toContain('src/runtime.ts branches coverage 50.00% is below 75%.')
  })
})
