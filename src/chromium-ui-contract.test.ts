import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}

describe('Chromium foreground UI matrix contract', () => {
  it('keeps pause and resume control sessions alive long enough to observe state', () => {
    const harness = read('scripts/chromium-ui-e2e.mjs')

    expect(harness).toContain("const UI_CONTROL_AUDIO_MARKER = 'UI_CONTROL_FIXTURE'")
    expect(harness).toContain('const UI_CONTROL_AUDIO_DURATION_MS = 10_000')
    expect(harness).toContain('text.includes(UI_CONTROL_AUDIO_MARKER)')
    expect(harness).toContain('`${UI_CONTROL_AUDIO_MARKER} Popup control surface.`')
    expect(harness).toContain('`${UI_CONTROL_AUDIO_MARKER} Options control surface.`')
    expect(harness).toContain("await waitForState(cdp, popup.sessionId, popupControls.sessionId, 'paused')")
    expect(harness).toContain("await waitForState(cdp, options.sessionId, optionsControls.sessionId, 'paused')")
    expect(harness).toContain("'selection-popup-options-selection-popup-replacement'")
    expect(harness).toContain('last status:')
  })
})
