#!/usr/bin/env node
import { readdirSync, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  approvedCoverageExclusions,
  productionCoverageInclude,
} from './coverage-policy.mjs'

function normalizePath(path) {
  return path.split(sep).join('/')
}

function walk(directory) {
  const output = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name)
    if (entry.isDirectory()) output.push(...walk(absolute))
    else output.push(absolute)
  }
  return output
}

function isProductionTypeScript(path) {
  return (path.endsWith('.ts') || path.endsWith('.tsx'))
    && !path.endsWith('.d.ts')
    && !path.endsWith('.test.ts')
    && !path.endsWith('.test.tsx')
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

export function globToRegExp(pattern) {
  let expression = escapeRegex(normalizePath(pattern))
  expression = expression.replace(/\\\{([^}]+)\\\}/g, (_match, values) => `(${values.split(',').map(escapeRegex).join('|')})`)
  expression = expression.replace(/\*\*\//g, '(?:.*/)?')
  expression = expression.replace(/\*\*/g, '.*')
  expression = expression.replace(/\*/g, '[^/]*')
  return new RegExp(`^${expression}$`)
}

export function auditCoverageSurface({
  root,
  includePatterns = productionCoverageInclude,
  approvedExclusions = approvedCoverageExclusions,
}) {
  const srcRoot = resolve(root, 'src')
  const productionFiles = walk(srcRoot)
    .map((absolute) => normalizePath(relative(root, absolute)))
    .filter(isProductionTypeScript)
    .sort()

  const inclusionMatchers = includePatterns.map(globToRegExp)
  const exclusionPaths = new Set()
  const invalidExclusions = []
  for (const exclusion of approvedExclusions) {
    const normalized = normalizePath(exclusion.path)
    if (exclusionPaths.has(normalized)) invalidExclusions.push(`${normalized}: duplicate approved exclusion`)
    exclusionPaths.add(normalized)
    const absolute = resolve(root, normalized)
    try {
      if (!statSync(absolute).isFile()) invalidExclusions.push(`${normalized}: approved exclusion is not a file`)
    } catch {
      invalidExclusions.push(`${normalized}: approved exclusion does not exist`)
    }
    if (!isProductionTypeScript(normalized)) invalidExclusions.push(`${normalized}: approved exclusion is not production TypeScript`)
    if (!exclusion.reason?.trim()) invalidExclusions.push(`${normalized}: approved exclusion has no reason`)
  }

  const missing = productionFiles.filter((path) => (
    !exclusionPaths.has(path) && !inclusionMatchers.some((matcher) => matcher.test(path))
  ))
  const measured = productionFiles.filter((path) => !exclusionPaths.has(path) && !missing.includes(path))
  const excluded = productionFiles.filter((path) => exclusionPaths.has(path))

  return { productionFiles, measured, excluded, missing, invalidExclusions }
}

export function formatCoverageSurfaceAudit(result) {
  const lines = [
    `Production TypeScript files: ${result.productionFiles.length}`,
    `Measured files: ${result.measured.length}`,
    `Approved exclusions: ${result.excluded.length}`,
  ]
  if (result.missing.length) lines.push(`Unmeasured production files:\n- ${result.missing.join('\n- ')}`)
  if (result.invalidExclusions.length) lines.push(`Invalid approved exclusions:\n- ${result.invalidExclusions.join('\n- ')}`)
  return lines.join('\n')
}

function main() {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const result = auditCoverageSurface({ root })
  console.log(formatCoverageSurfaceAudit(result))
  if (result.missing.length || result.invalidExclusions.length) process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
