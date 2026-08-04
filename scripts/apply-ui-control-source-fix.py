from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one {label}; found {count}")
    return text.replace(old, new, 1)


harness_path = ROOT / "scripts" / "chromium-ui-e2e.mjs"
harness = harness_path.read_text(encoding="utf-8")

old_wait = """async function waitForActiveSource(cdp, sessionId, source, previousSessionId = null) {
  return await waitFor(`active ${source} session`, async () => {
    const status = await queryStatus(cdp, sessionId)
    if (status?.source !== source || status.sessionId === previousSessionId) return null
    return ['starting', 'synthesizing', 'playing', 'waiting', 'paused'].includes(status.state) ? status : null
  })
}

async function waitForState(cdp, sessionId, playbackSessionId, state) {
  return await waitFor(`session ${playbackSessionId} state ${state}`, async () => {
    const status = await queryStatus(cdp, sessionId)
    return status?.sessionId === playbackSessionId && status.state === state ? status : null
  })
}
"""
new_wait = """async function waitForActiveSource(cdp, sessionId, source, previousSessionId = null) {
  let lastStatus = null
  try {
    return await waitFor(`active ${source} session`, async () => {
      const status = await queryStatus(cdp, sessionId)
      lastStatus = status
      if (status?.source !== source || status.sessionId === previousSessionId) return null
      return ['starting', 'synthesizing', 'playing', 'waiting', 'paused'].includes(status.state) ? status : null
    })
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}; last status: ${JSON.stringify(lastStatus)}`)
  }
}

async function waitForState(cdp, sessionId, playbackSessionId, state) {
  let lastStatus = null
  try {
    return await waitFor(`session ${playbackSessionId} state ${state}`, async () => {
      const status = await queryStatus(cdp, sessionId)
      lastStatus = status
      return status?.sessionId === playbackSessionId && status.state === state ? status : null
    })
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}; last status: ${JSON.stringify(lastStatus)}`)
  }
}
"""
harness = replace_once(harness, old_wait, new_wait, "status wait helpers")

old_controls = """    await setSelection(cdp, selectionSessionId, `${UI_CONTROL_AUDIO_MARKER} selection three.`)
    await cdp.send('Target.activateTarget', { targetId: selectionTarget.id })
    await clickSelector(cdp, popup.sessionId, 'button[aria-label="Read selected text"]', false)
    const selectionThree = await waitForActiveSource(cdp, popup.sessionId, 'selection', selectionTwo.sessionId)
    sessions.push(selectionThree.sessionId)

    await clickButton(cdp, popup.sessionId, 'Pause')
    await waitForState(cdp, popup.sessionId, selectionThree.sessionId, 'paused')
    await clickButton(cdp, popup.sessionId, 'Resume')
    await waitForState(cdp, popup.sessionId, selectionThree.sessionId, 'playing')
    await clickButton(cdp, popup.sessionId, 'Cancel')
    await waitForState(cdp, popup.sessionId, selectionThree.sessionId, 'cancelled')

    await setReactValue(cdp, options.sessionId, '#test', `${UI_CONTROL_AUDIO_MARKER} Options control surface.`)
    await clickButton(cdp, options.sessionId, 'Test speech')
    const optionsControls = await waitForActiveSource(cdp, options.sessionId, 'options-test', selectionThree.sessionId)
"""
new_controls = """    await setReactValue(cdp, popup.sessionId, '#tryText', `${UI_CONTROL_AUDIO_MARKER} Popup control surface.`)
    await clickButton(cdp, popup.sessionId, 'Try speech')
    const popupControls = await waitForActiveSource(cdp, popup.sessionId, 'popup-test', selectionTwo.sessionId)
    sessions.push(popupControls.sessionId)

    await clickButton(cdp, popup.sessionId, 'Pause')
    await waitForState(cdp, popup.sessionId, popupControls.sessionId, 'paused')
    await clickButton(cdp, popup.sessionId, 'Resume')
    await waitForState(cdp, popup.sessionId, popupControls.sessionId, 'playing')
    await clickButton(cdp, popup.sessionId, 'Cancel')
    await waitForState(cdp, popup.sessionId, popupControls.sessionId, 'cancelled')

    await setReactValue(cdp, options.sessionId, '#test', `${UI_CONTROL_AUDIO_MARKER} Options control surface.`)
    await clickButton(cdp, options.sessionId, 'Test speech')
    const optionsControls = await waitForActiveSource(cdp, options.sessionId, 'options-test', popupControls.sessionId)
"""
harness = replace_once(harness, old_controls, new_controls, "foreground control block")
harness = replace_once(
    harness,
    "        'selection-popup-options-selection-selection-replacement',",
    "        'selection-popup-options-selection-popup-replacement',",
    "verified replacement label",
)
harness_path.write_text(harness, encoding="utf-8")

contract_path = ROOT / "src" / "chromium-ui-contract.test.ts"
contract = contract_path.read_text(encoding="utf-8")
contract = replace_once(
    contract,
    "    expect(harness).toContain('`${UI_CONTROL_AUDIO_MARKER} selection three.`')",
    "    expect(harness).toContain('`${UI_CONTROL_AUDIO_MARKER} Popup control surface.`')",
    "Popup control marker contract",
)
contract = replace_once(
    contract,
    "    expect(harness).toContain(\"await waitForState(cdp, popup.sessionId, selectionThree.sessionId, 'paused')\")",
    "    expect(harness).toContain(\"await waitForState(cdp, popup.sessionId, popupControls.sessionId, 'paused')\")",
    "Popup paused contract",
)
contract = replace_once(
    contract,
    "    expect(harness).toContain(\"await waitForState(cdp, options.sessionId, optionsControls.sessionId, 'paused')\")",
    "    expect(harness).toContain(\"await waitForState(cdp, options.sessionId, optionsControls.sessionId, 'paused')\")\n    expect(harness).toContain(\"'selection-popup-options-selection-popup-replacement'\")\n    expect(harness).toContain('last status:')",
    "diagnostic and replacement contracts",
)
contract_path.write_text(contract, encoding="utf-8")

report_path = ROOT / "docs" / "CHROME_READIT_TEST_COVERAGE_HARDENING_IMPLEMENTATION_REPORT_2026-08-03.md"
report = report_path.read_text(encoding="utf-8")
needle = "- CI `30874522986` exposed the same lifetime class in the foreground UI Pause scenario. Popup and Options control sessions now use a dedicated ten-second UI fixture, protected by `src/chromium-ui-contract.test.ts`."
addition = needle + "\n- CI `30875225926` showed that the control phase still repeated active-tab selection capture after that workflow had already been validated. The control phase now uses a long-lived Popup test session, while selection capture remains covered by the earlier selection scenarios; timeout errors now include the last observed status."
report = replace_once(report, needle, addition, "implementation failed-attempt record")
report_path.write_text(report, encoding="utf-8")

todo_path = ROOT / "docs" / "CHROME_READIT_TEST_COVERAGE_HARDENING_TODO_2026-08-03.md"
todo = todo_path.read_text(encoding="utf-8")
needle = "3. CI `30874522986` exposed a two-second foreground UI control fixture that could finish before paused state was observable. Popup and Options control scenarios now use a dedicated ten-second fixture with a deterministic contract test."
addition = needle + "\n4. CI `30875225926` showed that the control phase still depended on a second active-tab selection capture. That phase now uses Popup test speech because the selection button and selection replacement path are already validated earlier; browser timeout diagnostics include the last observed status."
todo = replace_once(todo, needle, addition, "TODO failed-attempt record")
todo_path.write_text(todo, encoding="utf-8")

Path(__file__).unlink()
