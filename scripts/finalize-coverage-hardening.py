from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VALIDATED_SHA = "2cf59436edef86f05b691a9c21f05836d741d407"
CI_RUN = "30864233383"
CI_ATTEMPT = "1"
CI_JOB = "91852510574"
COQUI_RUN = "30864233396"
COQUI_ATTEMPT = "1"
COQUI_JOB = "91852500584"
IMAGE_ID = "sha256:e01444f5125b441789da72f9e465f11604d22878c7337b95fa732c8c0e57ebaa"

ARTIFACTS = [
    ("Vitest JUnit", "8875497124", "sha256:4c1d6390889c3c881639b5eb3d86ca932926e7d5c43af12057331ed397d13727"),
    ("TypeScript coverage", "8875497471", "sha256:e4b4678348c993aa3847ec117ead78a2fa095b175c1414aa66ce621afc860b62"),
    ("Chromium E2E", "8875515089", "sha256:007235ca2128a2de43bbedd1040d263cd59cdd0b13d83a09fcb78ac6b81aa750"),
    ("Python coverage/JUnit", "8875517836", "sha256:a6541ab76b72cdd0c0d20917797a3c661b2b497341be2158e0a85c49ccec566d"),
    ("Real Coqui", "8875590994", "sha256:bb84cdacc31e3c7b2fec15b3695b5f2669ed2e15a1bdfd1a5cb184da67981800"),
]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8")


def artifact_rows() -> str:
    return "\n".join(
        f"| {name} | `{artifact_id}` | `{digest}` |"
        for name, artifact_id, digest in ARTIFACTS
    )


def finalize_todo() -> None:
    path = "docs/CHROME_READIT_TEST_COVERAGE_HARDENING_TODO_2026-08-03.md"
    text = read(path)
    text = re.sub(
        r"\*\*Status:\*\* .*",
        "**Status:** COMPLETE — automated test coverage hardening passed on exact SHA; human listening remains governed separately",
        text,
        count=1,
    )
    if "**Validated implementation SHA:**" not in text:
        marker = "**Coverage-hardening implementation base SHA:** `b1ce1cdcaa438a238378534dafd99b11d24cf9ad`"
        text = text.replace(
            marker,
            marker + f"  \n**Validated implementation SHA:** `{VALIDATED_SHA}`",
            1,
        )

    optional_marker = "# Optional future work — not required for this TODO"
    required, optional = text.split(optional_marker, 1)
    required = required.replace("- [ ]", "- [x]")
    required = required.replace(
        "- [x] `PARTIAL — implementation or evidence remains incomplete`",
        "- [ ] `PARTIAL — implementation or evidence remains incomplete`",
    )
    required = required.replace(
        "- [x] `FAILED — a required gate failed and no approved resolution exists`",
        "- [ ] `FAILED — a required gate failed and no approved resolution exists`",
    )
    text = required + optional_marker + optional

    snapshot = f"""## 0.5 Final execution snapshot

| Block | Status | Evidence |
|---|---|---|
| 1 — Baseline inventory | COMPLETE | 21 non-test TS/TSX files including declarations; original six-file baseline preserved |
| 2 — Widen measurement | COMPLETE | 17 measured implementation files; 2 narrow approved exclusions |
| 3 — Surface guard | COMPLETE | Positive and negative policy tests; hosted guard step passed |
| 4 — Coordinator | COMPLETE | 96.37% lines / 86.12% branches |
| 5 — Service worker | COMPLETE | 89.46% lines / 80.59% branches |
| 6 — Offscreen adapter | COMPLETE | 98.53% lines / 96.15% branches |
| 7 — Libraries/runtime client | COMPLETE | Every configured critical-file floor passed |
| 8 — Popup and Options | COMPLETE | Popup 91.11/76.67; Options 93.43/81.34 |
| 9 — Python infrastructure | COMPLETE | Branch coverage, XML/JSON/JUnit, hosted artifact retained |
| 10 — Python gap closure | COMPLETE | 57 tests; 97.44% statements / 89.19% branches |
| 11 — Threshold enforcement | COMPLETE | Global and per-file fail-closed checkers passed |
| 12 — CI artifacts/reporting | COMPLETE | Attempt-specific TypeScript, Python, JUnit, and Chromium artifacts retained |
| 13 — Flakiness/leak audit | COMPLETE | 20/20 Vitest and 20/20 Python repetitions passed locally |
| 14 — Full validation | COMPLETE | Deterministic local gates passed; hosted Chrome fulfilled the documented local environment deferral |
| 15 — Hosted CI | COMPLETE | Run `{CI_RUN}`, attempt {CI_ATTEMPT}, job `{CI_JOB}` |
| 16 — Real Coqui | COMPLETE | Run `{COQUI_RUN}`, attempt {COQUI_ATTEMPT}, job `{COQUI_JOB}` on the same SHA |
| 17 — Documentation reconciliation | COMPLETE | TODO, report, README, Coqui README, and evidence index reconciled |
| 18 — Final sign-off | COMPLETE | Automated workstream complete; human listening remains separate |

The broader FIX2 human listening gate remains **Not yet executed**. Automated coverage and real-model synthesis do not establish subjective audible quality.
"""
    text = re.sub(
        r"## 0\.5 (?:Current|Final) execution snapshot\n.*?\n---\n\n# Block 1",
        snapshot + "\n---\n\n# Block 1",
        text,
        count=1,
        flags=re.S,
    )

    text = text.replace(
        "- [x] Chromium runtime suite succeeded.",
        "- [x] Chromium runtime suite succeeded — fulfilled by permanent hosted Chrome because the sandbox could not launch the required non-headless extension profile; this is not claimed as a local browser pass.",
    )
    text = text.replace(
        "- [x] Chromium UI suite succeeded.",
        "- [x] Chromium UI suite succeeded — fulfilled by the same permanent hosted Chrome run under the approved environment deferral.",
    )

    evidence = {
        1: "Baseline `2a7abaa61d67412daeaf02465224304ab31f5e4f`; 21 production TS/TSX files including declarations; 6 originally measured files; 214 TypeScript tests; 30 Python tests; original reports preserved.",
        2: "17 measured implementation files; exclusions limited to `src/manifest.ts` and `src/options/main.tsx`; final global coverage 95.59% statements/lines, 87.93% branches, 96.14% functions.",
        3: "`node scripts/check-coverage-surface.mjs`; positive and negative policy tests; hosted `Verify TypeScript coverage surface` step passed.",
        4: "Coordinator failure, cleanup, stale callback, replacement, prefetch, and pause/transition tests; 96.37% lines / 86.12% branches.",
        5: "Selection/settings, offscreen lifecycle, protocol, persistence, commands, menus, probes, and diagnostics tests; 89.46% lines / 80.59% branches.",
        6: "Message validation, coordinator integration, event forwarding, diagnostics, and initialization tests; 98.53% lines / 96.15% branches.",
        7: "TTS, storage, voices, endpoints, messaging, and runtime transport tests; every configured critical library floor passed.",
        8: "Popup/Options load, save, retry, discovery, stale result, supersession, and control-session refresh tests; Popup 91.11/76.67; Options 93.43/81.34.",
        9: "Pinned pytest-cov/coverage, branch measurement, terminal/XML/JSON/JUnit reports, deterministic checker, hosted artifact `8875517836`.",
        10: "57 Python tests covering startup, readiness, discovery, backend faults, request envelopes, queue accounting, timeout, cleanup, and shutdown; 97.44% statements / 89.19% branches.",
        11: "Global TypeScript floors 85/85/85/75 and explicit critical-file floors; missing/malformed report and exact threshold negative tests passed.",
        12: f"CI `{CI_RUN}` attempt {CI_ATTEMPT}; attempt-specific JUnit, TypeScript coverage, Chromium, and Python coverage artifacts with digests recorded below.",
        13: "20 complete Vitest repetitions and 20 complete Python repetitions without retries; hosted browser failures were root-caused and fixed rather than hidden.",
        14: f"All deterministic local gates passed. Local non-headless Chrome was unavailable; permanent hosted Chrome on `{VALIDATED_SHA}` fulfilled the bounded environment deferral.",
        15: f"Candidate `{VALIDATED_SHA}`; CI `{CI_RUN}` attempt {CI_ATTEMPT}; job `{CI_JOB}`; success; all coverage, build, Chromium, Python, security, and upload steps passed.",
        16: f"Candidate `{VALIDATED_SHA}`; real-Coqui `{COQUI_RUN}` attempt {COQUI_ATTEMPT}; job `{COQUI_JOB}`; image `{IMAGE_ID}`; artifact `8875590994`; success.",
        17: "README, implementation report, evidence index, governing TODO, Coqui testing documentation, and temporary-workflow regression guard reconciled. Remaining work: human listening only.",
    }
    for block, body in evidence.items():
        pattern = rf"(### Block {block} evidence\n\n)```text\n.*?\n```"
        replacement = rf"\1```text\n{body}\n```"
        text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
        if count != 1:
            raise RuntimeError(f"Could not replace Block {block} evidence")

    final_record = f"""Final exact SHA: {VALIDATED_SHA}
Hosted CI run/attempt: {CI_RUN} / {CI_ATTEMPT}
Real-Coqui run/attempt: {COQUI_RUN} / {COQUI_ATTEMPT}
TypeScript test count: 291
Python test count: 57
TypeScript global coverage: 95.59% statements, 87.93% branches, 96.14% functions, 95.59% lines
Python global coverage: 97.44% statements, 89.19% branches
Critical-file coverage: all configured floors passed
Artifact IDs and digests: see final evidence matrix below
Human listening status: Not yet executed
Final decision: COMPLETE — automated test coverage hardening passed on exact SHA; human listening remains governed separately"""
    text = re.sub(
        r"Final exact SHA:\nHosted CI run/attempt:\nReal-Coqui run/attempt:\nTypeScript test count:\nPython test count:\nTypeScript global coverage:\nPython global coverage:\nCritical-file coverage:\nArtifact IDs and digests:\nHuman listening status:\nFinal decision:",
        final_record,
        text,
        count=1,
    )

    rows = artifact_rows()
    matrix = f"""# Final exact-SHA evidence matrix

**Validated implementation SHA:** `{VALIDATED_SHA}`  
**Permanent CI:** run `{CI_RUN}`, attempt {CI_ATTEMPT}, job `{CI_JOB}`, success  
**Real-Coqui:** run `{COQUI_RUN}`, attempt {COQUI_ATTEMPT}, job `{COQUI_JOB}`, success

## Test and coverage totals

| Surface | Tests | Statements/lines | Branches | Functions |
|---|---:|---:|---:|---:|
| TypeScript | 291 | 95.59% | 87.93% | 96.14% |
| Python | 57 | 97.44% statements | 89.19% | n/a |

## Critical TypeScript files

| File | Lines | Branches |
|---|---:|---:|
| `src/offscreen/playback-coordinator.ts` | 96.37% | 86.12% |
| `src/background/service-worker.ts` | 89.46% | 80.59% |
| `src/offscreen.ts` | 98.53% | 96.15% |
| `src/lib/tts-client.ts` | 99.17% | 98.99% |
| `src/lib/storage.ts` | 100.00% | 96.00% |
| `src/lib/voices.ts` | 100.00% | 92.59% |
| `src/lib/playback-runtime-client.ts` | 93.94% | 95.65% |
| `src/popup/Popup.tsx` | 91.11% | 76.67% |
| `src/options/Options.tsx` | 93.43% | 81.34% |

## Retained artifacts

| Evidence | Artifact ID | Digest |
|---|---:|---|
{rows}

## Chromium acceptance

The core, command/offscreen tail, and foreground UI matrices returned `ok: true`. `maxActivePlayerCount` remained `1`; cleanup failures and invariant violations remained zero.

## Material failed attempts repaired before sign-off

1. CI `30862741564` exposed a stale Popup/Options control-session race after replacement. Both surfaces now query authoritative status before Pause, Resume, or Cancel.
2. CI `30863813740` reproduced the paused-worker-restart timeout. The scenario now uses a dedicated ten-second fixture while preserving the persisted-paused assertion.

Neither failure was hidden by a blind rerun. Each received a bounded fix and complete revalidation.

## Remaining release gate

FIX2 human listening remains **Not yet executed**. This TODO completes automated coverage hardening only.

---

"""
    if "# Final exact-SHA evidence matrix" not in text:
        text = text.replace(optional_marker, matrix + optional_marker, 1)
    write(path, text)


def finalize_report() -> None:
    path = "docs/CHROME_READIT_TEST_COVERAGE_HARDENING_IMPLEMENTATION_REPORT_2026-08-03.md"
    text = read(path)
    text = text.replace(
        "**Status:** Candidate implementation complete; hosted exact-SHA validation pending",
        "**Status:** COMPLETE — automated coverage hardening passed on exact SHA; human listening remains separate",
        1,
    )
    text = text.replace(
        "**Candidate exact SHA:** _assigned when this report and implementation are committed_",
        f"**Validated implementation SHA:** `{VALIDATED_SHA}`",
        1,
    )
    text = text.replace("33 TypeScript test files and 288 tests", "33 TypeScript test files and 291 tests")
    text = text.replace("| Statements | 95.62% |", "| Statements | 95.59% |")
    text = text.replace("| Branches | 88.21% |", "| Branches | 87.93% |")
    text = text.replace("| Functions | 96.14% |", "| Functions | 96.14% |")
    text = text.replace("| Lines | 95.62% |", "| Lines | 95.59% |")
    text = text.replace("| `src/popup/Popup.tsx` | 91.13% | 77.96% |", "| `src/popup/Popup.tsx` | 91.11% | 76.67% |")
    text = text.replace("| `src/options/Options.tsx` | 93.52% | 82.70% |", "| `src/options/Options.tsx` | 93.43% | 81.34% |")
    text = re.sub(
        r"## 8\. Remaining exact-SHA gates\n.*\Z",
        "",
        text,
        count=1,
        flags=re.S,
    ).rstrip()

    rows = artifact_rows()
    text += f"""

---

## 8. Exact-SHA hosted validation

| Gate | Run | Attempt | Job | Conclusion |
|---|---:|---:|---:|---|
| Permanent CI | `{CI_RUN}` | {CI_ATTEMPT} | `{CI_JOB}` | success |
| Real-Coqui | `{COQUI_RUN}` | {COQUI_ATTEMPT} | `{COQUI_JOB}` | success |

The validated implementation SHA is `{VALIDATED_SHA}`. Permanent CI passed lint, typecheck, coverage-surface integrity, FIX2 hygiene, full-history secret scanning, release-script syntax, all 291 TypeScript tests and thresholds, production and diagnostic builds, manifest/assets validation, all hosted Chromium matrices, all 57 Python tests and thresholds, Compose security validation, and both Codecov uploads.

TypeScript coverage was 95.59% statements/lines, 87.93% branches, and 96.14% functions. Python coverage was 97.44% statements and 89.19% branches. Every configured critical-file floor passed.

The core, command/offscreen tail, and foreground UI Chromium matrices each returned `ok: true`; `maxActivePlayerCount` remained `1`, with zero cleanup failures and zero invariant violations.

Real-Coqui loaded the actual VCTK model, selected voice `p225`, returned a structurally valid mono 16-bit 22050 Hz WAV, exercised the required error envelopes, proved loopback-only/non-root/single-worker defaults, retained model-cache reuse, and recorded bounded temporary-file, queue, recreation, timeout, and shutdown evidence.

Immutable image ID: `{IMAGE_ID}`.

## 9. Retained artifacts

| Evidence | Artifact ID | Digest |
|---|---:|---|
{rows}

## 10. Material failed attempts and repairs

- CI `30862741564` exposed a stale-session race in Popup/Options controls after replacement. Both surfaces now refresh authoritative playback status before Pause, Resume, or Cancel, with focused regression tests.
- CI `30863813740` reproduced the paused-worker-restart timeout. The deterministic scenario now uses a dedicated ten-second fixture while retaining the persisted-paused assertion.

Neither failure was converted into success through a blind rerun. Each received a root-cause fix and complete revalidation.

## 11. Repository hygiene and final disposition

All one-time export, patch, fixture, control-race, and documentation-reconciliation workflows were removed. The workflow-hygiene unit test rejects the known temporary names and prefixes.

```text
COMPLETE — automated test coverage hardening passed on exact SHA; human listening remains governed separately
```

FIX2 human listening remains **Not yet executed**. Automated test and synthesis evidence does not establish subjective audible quality.
"""
    write(path, text + "\n")


def append_once(path: str, heading: str, body: str) -> None:
    text = read(path)
    if heading not in text:
        text += "\n\n" + body.strip() + "\n"
        write(path, text)


def finalize_supporting_docs() -> None:
    readme_path = "README.md"
    readme = read(readme_path)
    heading = "## Automated coverage-hardening status"
    section = f"""{heading}

The automated coverage-hardening workstream passed permanent CI and real-Coqui validation on implementation SHA `{VALIDATED_SHA}`. The suite contains **291 TypeScript tests** and **57 Python tests**. TypeScript coverage is **95.59% statements/lines**, **87.93% branches**, and **96.14% functions** across 17 measured production files. Python coverage is **97.44% statements** and **89.19% branches**.

Only `src/manifest.ts` and `src/options/main.tsx` are excluded because they are declarative/trivial bootstrap entrypoints whose behavior is covered by manifest, build, and Chromium validation. Global TypeScript floors are 85% statements/lines/functions and 75% branches, with higher critical-file floors. Python floors are 85% statements and 75% branches.

Automated coverage does not establish audible quality. The separate FIX2 human listening gate remains **Not yet executed**, so the broader FIX2 disposition remains `PARTIAL`.
"""
    if heading not in readme:
        intro = "Read It is a Manifest V3 Chrome extension that reads selected text through a local or user-configured synthesis endpoint. It provides keyboard-accessible controls, configurable voices and rates, sentence-aware chunking, and explicit paragraph pacing.\n"
        readme = readme.replace(intro, intro + "\n" + section + "\n", 1)
        write(readme_path, readme)

    append_once(
        "docker/coqui-local/README.md",
        "## Branch-coverage validation",
        """## Branch-coverage validation

From the repository root:

```bash
python -m pytest -q docker/coqui-local/tests \\
  --cov=docker/coqui-local --cov-config=.coveragerc --cov-branch \\
  --cov-report=term-missing \\
  --cov-report=xml:reports/coqui-coverage.xml \\
  --cov-report=json:reports/coqui-coverage.json \\
  --junitxml=reports/coqui-junit.xml
python scripts/check_python_coverage.py reports/coqui-coverage.json
```

CI requires at least 85% statements and 75% branches. The validated suite contains 57 tests and achieved 97.44% statements and 89.19% branches.
""",
    )

    rows = artifact_rows()
    append_once(
        "docs/CHROME_READIT_FIX2_EVIDENCE_INDEX_2026-08-02.md",
        "## Automated test-coverage hardening",
        f"""## Automated test-coverage hardening

- Specification: `docs/CHROME_READIT_TEST_COVERAGE_HARDENING_SPEC_2026-08-03.md`
- Governing TODO: `docs/CHROME_READIT_TEST_COVERAGE_HARDENING_TODO_2026-08-03.md`
- Implementation report: `docs/CHROME_READIT_TEST_COVERAGE_HARDENING_IMPLEMENTATION_REPORT_2026-08-03.md`
- Validated implementation SHA: `{VALIDATED_SHA}`
- Permanent CI: run `{CI_RUN}`, attempt {CI_ATTEMPT}, job `{CI_JOB}`
- Real-Coqui: run `{COQUI_RUN}`, attempt {COQUI_ATTEMPT}, job `{COQUI_JOB}`

| Evidence | Artifact ID | Digest |
|---|---:|---|
{rows}

The automated workstream is complete. FIX2 human listening remains **Not yet executed** and is not replaced by these artifacts.
""",
    )


def finalize_hygiene_guard() -> None:
    write(
        "src/no-temporary-workflows.test.ts",
        """import { readdirSync } from 'node:fs'
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
""",
    )


def finalize_request() -> None:
    write(
        "docs/CHROME_READIT_FIX2_REAL_COQUI_VALIDATION_REQUEST.md",
        """# Chrome Read It FIX2 Real Coqui Validation Request

**Requested:** 2026-08-03  
**Request sequence:** 21  
**Purpose:** Validate the clean, documentation-reconciled coverage-hardening head after removal of all temporary workflows, including all 291 TypeScript tests, all 57 Python tests, global and critical-file coverage gates, the complete hosted Chromium matrix, and the real-Coqui runtime matrix.  
**Ordinary CI:** The same commit must also pass `.github/workflows/ci.yml`.  
**Runtime status:** GitHub issue `#3` is overwritten at workflow start and completion.

The workflow must retain the established FIX2 evidence contract: actual VCTK model load and WAV synthesis with voice `p225`; readiness, voices, queue-full, timeout, cleanup, recreation, cache reuse, loopback-only publication, non-root identity, one Uvicorn worker, removed host-play/debug routes, immutable image ID, and attempt-specific artifact identity.

The same exact clean head must pass lint, typecheck, coverage-surface integrity, hygiene, full-history secret scanning, all TypeScript and Python tests and thresholds, production and diagnostic builds, manifest validation, the core/Block-13/UI Chromium matrices, Compose security validation, and both Codecov uploads.

This request is a trigger, not proof of success. GitHub issues `#2` and `#3` remain the authoritative current-run records. The implementation report records the completed implementation evidence on `2cf59436edef86f05b691a9c21f05836d741d407`; sequence 21 verifies that the reconciled repository head remains clean and green.
""",
    )


def remove_temporary_files_and_restore_workflow() -> None:
    for relative in (
        ".github/workflows/reconcile-coverage-docs.yml",
        ".github/workflows/run-coverage-reconcile.yml",
    ):
        path = ROOT / relative
        if path.exists():
            path.unlink()

    write(
        ".github/workflows/fix2-hygiene.yml",
        """name: FIX2 Hygiene

on:
  push:
    branches: ["**"]
  pull_request:
    branches: ["**"]

permissions:
  contents: read

jobs:
  hygiene:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262

      - name: Reject dangerous fallbacks and silent failures
        run: bash scripts/check-fix2-hygiene.sh
""",
    )

    Path(__file__).unlink()


def main() -> None:
    finalize_todo()
    finalize_report()
    finalize_supporting_docs()
    finalize_hygiene_guard()
    finalize_request()
    remove_temporary_files_and_restore_workflow()


if __name__ == "__main__":
    main()
