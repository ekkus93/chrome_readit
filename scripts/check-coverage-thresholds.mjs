#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  criticalFileCoverageThresholds,
  globalCoverageThresholds,
} from './coverage-policy.mjs'

function normalizePath(path) {
  return path.split(sep).join('/')
}

function percentage(covered, total) {
  return total === 0 ? 100 : (covered / total) * 100
}

function summarizeFile(fileCoverage) {
  const statementCounts = Object.values(fileCoverage.s ?? {})
  const functionCounts = Object.values(fileCoverage.f ?? {})
  const branchCounts = Object.values(fileCoverage.b ?? {}).flat()
  const lineHits = new Map()
  for (const [id, count] of Object.entries(fileCoverage.s ?? {})) {
    const line = fileCoverage.statementMap?.[id]?.start?.line
    if (Number.isInteger(line)) lineHits.set(line, Math.max(lineHits.get(line) ?? 0, count))
  }
  const lineCounts = [...lineHits.values()]
  const metric = (counts) => ({
    covered: counts.filter((count) => count > 0).length,
    total: counts.length,
    pct: percentage(counts.filter((count) => count > 0).length, counts.length),
  })
  return {
    statements: metric(statementCounts),
    branches: metric(branchCounts),
    functions: metric(functionCounts),
    lines: metric(lineCounts),
  }
}

function combineSummaries(summaries) {
  const output = {}
  for (const metric of ['statements', 'branches', 'functions', 'lines']) {
    const covered = summaries.reduce((sum, summary) => sum + summary[metric].covered, 0)
    const total = summaries.reduce((sum, summary) => sum + summary[metric].total, 0)
    output[metric] = { covered, total, pct: percentage(covered, total) }
  }
  return output
}

export function checkCoverage({
  coveragePath,
  root,
  globalThresholds = globalCoverageThresholds,
  criticalThresholds = criticalFileCoverageThresholds,
}) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(coveragePath, 'utf8'))
  } catch (error) {
    return { ok: false, errors: [`Coverage report is missing or malformed: ${error instanceof Error ? error.message : String(error)}`] }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errors: ['Coverage report root must be an object.'] }
  }

  const byPath = new Map()
  for (const [absolute, value] of Object.entries(parsed)) {
    if (!value || typeof value !== 'object') continue
    byPath.set(normalizePath(relative(root, absolute)), summarizeFile(value))
  }
  const global = combineSummaries([...byPath.values()])
  const errors = []
  for (const [metric, floor] of Object.entries(globalThresholds)) {
    if (global[metric].pct + Number.EPSILON < floor) {
      errors.push(`Global ${metric} coverage ${global[metric].pct.toFixed(2)}% is below ${floor}%.`)
    }
  }

  const critical = {}
  for (const [path, thresholds] of Object.entries(criticalThresholds)) {
    const summary = byPath.get(normalizePath(path))
    if (!summary) {
      errors.push(`Critical coverage file is missing: ${path}`)
      continue
    }
    critical[path] = summary
    for (const [metric, floor] of Object.entries(thresholds)) {
      if (summary[metric].pct + Number.EPSILON < floor) {
        errors.push(`${path} ${metric} coverage ${summary[metric].pct.toFixed(2)}% is below ${floor}%.`)
      }
    }
  }
  return { ok: errors.length === 0, errors, global, critical }
}

function main() {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const coveragePath = resolve(root, process.argv[2] ?? 'coverage/coverage-final.json')
  const outputPath = resolve(root, process.argv[3] ?? 'reports/typescript-coverage-summary.json')
  const result = checkCoverage({ coveragePath, root })
  mkdirSync(resolve(outputPath, '..'), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`)
  if (result.global) {
    console.log('TypeScript global coverage:')
    for (const metric of ['statements', 'branches', 'functions', 'lines']) {
      console.log(`- ${metric}: ${result.global[metric].pct.toFixed(2)}%`)
    }
  }
  if (result.errors.length) {
    console.error(result.errors.join('\n'))
    process.exitCode = 1
  } else {
    console.log('Global and critical-file coverage thresholds passed.')
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
