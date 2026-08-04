from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one {label}; found {count}")
    return text.replace(old, new, 1)


report_path = ROOT / "docs" / "CHROME_READIT_TEST_COVERAGE_HARDENING_IMPLEMENTATION_REPORT_2026-08-03.md"
report = report_path.read_text(encoding="utf-8")
needle = "- CI `30875225926` showed that the control phase still repeated active-tab selection capture after that workflow had already been validated. The control phase now uses a long-lived Popup test session, while selection capture remains covered by the earlier selection scenarios; timeout errors now include the last observed status."
replacement = needle + "\n- CI `30875551199` caught a stale consolidated source-state assertion that still required the old selection-selection replacement label. The assertion now matches the decoupled selection-popup replacement contract; permanent CI `30875639074` then passed the complete 292-test, Chromium, Python, build, security, and upload matrix."
report = replace_once(report, needle, replacement, "implementation evidence entry")
report_path.write_text(report, encoding="utf-8")

todo_path = ROOT / "docs" / "CHROME_READIT_TEST_COVERAGE_HARDENING_TODO_2026-08-03.md"
todo = todo_path.read_text(encoding="utf-8")
needle = "4. CI `30875225926` showed that the control phase still depended on a second active-tab selection capture. That phase now uses Popup test speech because the selection button and selection replacement path are already validated earlier; browser timeout diagnostics include the last observed status."
replacement = needle + "\n5. CI `30875551199` caught the remaining stale consolidated contract string for the old replacement sequence. That assertion was updated, and permanent CI `30875639074` passed the entire matrix before the final exact-SHA runtime request."
todo = replace_once(todo, needle, replacement, "TODO evidence entry")
todo_path.write_text(todo, encoding="utf-8")

Path(__file__).unlink()
