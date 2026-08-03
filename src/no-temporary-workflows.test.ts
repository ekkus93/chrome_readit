import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowDirectory = resolve(import.meta.dirname, '..', '.github', 'workflows')

describe('repository workflow hygiene', () => {
  it('contains no temporary FIX2 patch workflows', () => {
    const temporary = readdirSync(workflowDirectory)
      .filter((name) => name.startsWith('fix2-one-shot-'))
      .sort()

    expect(temporary).toEqual([])
  })
})
