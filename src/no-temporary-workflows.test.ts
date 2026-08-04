import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowDirectory = resolve(import.meta.dirname, '..', '.github', 'workflows')

const exactTemporaryWorkflows = new Set([
  'export-source.yml',
  'reconcile-coverage-docs.yml',
  'run-coverage-reconcile.yml',
  'apply-paused-restart-fixture.yml',
  'apply-playback-control-race.yml',
])

describe('repository workflow hygiene', () => {
  it('contains no temporary patch, export, or reconciliation workflows', () => {
    const temporary = readdirSync(workflowDirectory)
      .filter(
        (name) =>
          name.startsWith('fix2-one-shot-') ||
          name.startsWith('apply-coverage-') ||
          exactTemporaryWorkflows.has(name),
      )
      .sort()

    expect(temporary).toEqual([])
  })
})
