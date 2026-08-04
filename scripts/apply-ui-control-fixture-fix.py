from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if text.count(old) != 1:
        raise RuntimeError(f"Expected exactly one {label}; found {text.count(old)}")
    return text.replace(old, new, 1)


harness_path = ROOT / "scripts" / "chromium-ui-e2e.mjs"
harness = harness_path.read_text(encoding="utf-8")
harness = replace_once(
    harness,
    "const LONG_AUDIO_MARKER = 'UI_REPLACEMENT_FIXTURE'",
    "const LONG_AUDIO_MARKER = 'UI_REPLACEMENT_FIXTURE'\nconst UI_CONTROL_AUDIO_MARKER = 'UI_CONTROL_FIXTURE'\nconst UI_CONTROL_AUDIO_DURATION_MS = 10_000\nconst REPLACEMENT_AUDIO_DURATION_MS = 2_000",
    "UI marker declaration",
)
harness = replace_once(
    harness,
    "      const audio = makeSilentWav(text.includes(LONG_AUDIO_MARKER) ? 2_000 : 250)",
    "      const durationMs = text.includes(UI_CONTROL_AUDIO_MARKER)\n        ? UI_CONTROL_AUDIO_DURATION_MS\n        : text.includes(LONG_AUDIO_MARKER)\n          ? REPLACEMENT_AUDIO_DURATION_MS\n          : 250\n      const audio = makeSilentWav(durationMs)",
    "fixture duration selection",
)
harness = replace_once(
    harness,
    "    await setSelection(cdp, selectionSessionId, `${LONG_AUDIO_MARKER} selection three.`)",
    "    await setSelection(cdp, selectionSessionId, `${UI_CONTROL_AUDIO_MARKER} selection three.`)",
    "Popup control fixture",
)
harness = replace_once(
    harness,
    "    await setReactValue(cdp, options.sessionId, '#test', `${LONG_AUDIO_MARKER} Options control surface.`)",
    "    await setReactValue(cdp, options.sessionId, '#test', `${UI_CONTROL_AUDIO_MARKER} Options control surface.`)",
    "Options control fixture",
)
harness_path.write_text(harness, encoding="utf-8")

contract_path = ROOT / "src" / "chromium-ui-contract.test.ts"
contract_path.write_text(
    """import { readFileSync } from 'node:fs'
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
    expect(harness).toContain('`${UI_CONTROL_AUDIO_MARKER} selection three.`')
    expect(harness).toContain('`${UI_CONTROL_AUDIO_MARKER} Options control surface.`')
    expect(harness).toContain("await waitForState(cdp, popup.sessionId, selectionThree.sessionId, 'paused')")
    expect(harness).toContain("await waitForState(cdp, options.sessionId, optionsControls.sessionId, 'paused')")
  })
})
""",
    encoding="utf-8",
)

doc_paths = [
    ROOT / "README.md",
    ROOT / "docs" / "CHROME_READIT_TEST_COVERAGE_HARDENING_TODO_2026-08-03.md",
    ROOT / "docs" / "CHROME_READIT_TEST_COVERAGE_HARDENING_IMPLEMENTATION_REPORT_2026-08-03.md",
    ROOT / "docs" / "CHROME_READIT_FIX2_EVIDENCE_INDEX_2026-08-02.md",
    ROOT / "docs" / "CHROME_READIT_FIX2_REAL_COQUI_VALIDATION_REQUEST.md",
]
for path in doc_paths:
    text = path.read_text(encoding="utf-8")
    text = re.sub(r"\b291\b", "292", text)
    if path.name == "CHROME_READIT_TEST_COVERAGE_HARDENING_IMPLEMENTATION_REPORT_2026-08-03.md":
        text = text.replace("33 TypeScript test files and 292 tests", "34 TypeScript test files and 292 tests")
        prior = "- CI `30863813740` reproduced the paused-worker-restart timeout. The deterministic scenario now uses a dedicated ten-second fixture while retaining the persisted-paused assertion."
        addition = prior + "\n- CI `30874522986` exposed the same lifetime class in the foreground UI Pause scenario. Popup and Options control sessions now use a dedicated ten-second UI fixture, protected by `src/chromium-ui-contract.test.ts`."
        text = replace_once(text, prior, addition, "implementation failed-attempt entry")
    if path.name == "CHROME_READIT_TEST_COVERAGE_HARDENING_TODO_2026-08-03.md":
        prior = "2. CI `30863813740` reproduced the paused-worker-restart timeout. The scenario now uses a dedicated ten-second fixture while preserving the persisted-paused assertion."
        addition = prior + "\n3. CI `30874522986` exposed a two-second foreground UI control fixture that could finish before paused state was observable. Popup and Options control scenarios now use a dedicated ten-second fixture with a deterministic contract test."
        text = replace_once(text, prior, addition, "TODO failed-attempt entry")
    path.write_text(text, encoding="utf-8")

Path(__file__).unlink()
