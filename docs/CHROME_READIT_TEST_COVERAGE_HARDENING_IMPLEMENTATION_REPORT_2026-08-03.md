# Chrome Read It Test Coverage Hardening Implementation Report

**Status:** Candidate implementation complete; hosted exact-SHA validation pending  
**Date:** 2026-08-03  
**Repository:** `ekkus93/chrome_readit`  
**Governing specification:** `docs/CHROME_READIT_TEST_COVERAGE_HARDENING_SPEC_2026-08-03.md`  
**Execution TODO:** `docs/CHROME_READIT_TEST_COVERAGE_HARDENING_TODO_2026-08-03.md`  
**Implementation base SHA:** `b1ce1cdcaa438a238378534dafd99b11d24cf9ad`  
**Candidate exact SHA:** _assigned when this report and implementation are committed_

---

## 1. Disposition

The coverage-hardening implementation is complete in the candidate tree and all deterministic local unit, static-analysis, build, coverage, and repetition gates pass. The permanent hosted Chrome job remains the authoritative browser gate because the local Debian Chromium binary could start headless DevTools but could not create `DevToolsActivePort` in the non-headless extension configuration required by the E2E harness.

This is not a browser pass. The candidate remains `PARTIAL` until permanent hosted CI and real-Coqui validation pass on one exact SHA.

This work does not complete FIX2 human listening Block 16. Human listening remains a separate release gate.

---

## 2. Baseline inventory

### 2.1 Production TypeScript surface

The inventory contains 21 non-test TypeScript/TSX files under `src/` when declaration files are included. This matches the existing FIX2 hygiene scan count.

| Classification | Files |
|---|---|
| Background runtime | `src/background/service-worker.ts` |
| Offscreen runtime | `src/offscreen.ts`, `src/offscreen/playback-coordinator.ts` |
| UI logic | `src/popup/Popup.tsx`, `src/options/Options.tsx` |
| Runtime and protocol libraries | `src/lib/chunk-packing.ts`, `src/lib/debug-fixtures.ts`, `src/lib/messaging.ts`, `src/lib/playback-pacing.ts`, `src/lib/playback-protocol.ts`, `src/lib/playback-runtime-client.ts`, `src/lib/storage.ts`, `src/lib/text-normalization.ts`, `src/lib/text-segmentation.ts`, `src/lib/tts-client.ts`, `src/lib/tts-endpoints.ts`, `src/lib/voices.ts` |
| Declarative manifest/configuration | `src/manifest.ts` |
| Trivial bootstrap | `src/options/main.tsx` |
| Type-only declarations | `src/raw-assets.d.ts`, `src/vite-env.d.ts` |

The coverage policy therefore sees:

- 19 production `.ts`/`.tsx` implementation files after declaration files are removed;
- 17 measured production files;
- 2 narrowly approved exclusions;
- no broad directory exclusions.

Approved exclusions:

1. `src/manifest.ts` — declarative manifest object validated by build and manifest-contract tests;
2. `src/options/main.tsx` — trivial React mounting bootstrap with no business branch.

### 2.2 Original measured surface

Before this work, `vitest.config.ts` measured only six files:

- `src/lib/playback-protocol.ts`
- `src/lib/text-normalization.ts`
- `src/lib/text-segmentation.ts`
- `src/lib/chunk-packing.ts`
- `src/lib/playback-pacing.ts`
- `src/offscreen/playback-coordinator.ts`

All-files behavior was not enabled, so unimported production files could not appear as zero coverage.

### 2.3 Original baseline

The reproduced original six-file baseline was:

| Metric | Baseline |
|---|---:|
| Test files | 32 |
| Tests | 214 |
| Statements | 95.85% |
| Branches | 86.95% |
| Functions | 93.18% |
| Lines | 95.85% |

The first widened report, before adding tests, was:

| Metric | Widened baseline |
|---|---:|
| Statements | 86.79% |
| Branches | 81.89% |
| Functions | 87.37% |
| Lines | 86.79% |

Critical widened-baseline gaps included:

| File | Lines | Branches |
|---|---:|---:|
| `src/background/service-worker.ts` | 57.19% | 51.76% |
| `src/offscreen.ts` | 44.85% | 42.85% |
| `src/offscreen/playback-coordinator.ts` | 92.03% | 79.45% |

The Python baseline had 30 passing tests. `pytest-cov` and branch thresholds were not part of the committed test requirements or CI contract before this work.

---

## 3. Implemented coverage architecture

### 3.1 Shared TypeScript coverage policy

Added `scripts/coverage-policy.mjs` as the single authoritative coverage policy used by Vitest and enforcement scripts. It defines:

- complete `src/**/*.{ts,tsx}` measurement;
- test and declaration exclusions;
- exact approved production exclusions with reasons;
- global floors;
- critical-file floors.

Added `scripts/check-coverage-surface.mjs` to fail when a production file is neither measured nor explicitly approved. The guard also rejects broad or stale exclusions.

Added `scripts/check-coverage-thresholds.mjs` to parse Istanbul JSON, enforce global and critical-file floors, and write a machine-readable summary.

Added `scripts/coverage-policy.test.mjs` with positive and negative contract tests for missing production files, broad exclusions, missing/malformed reports, missing critical files, and exact threshold failures.

### 3.2 TypeScript thresholds

Global floors:

```text
Statements: 85%
Lines:      85%
Functions:  85%
Branches:   75%
```

Critical-file floors:

```text
playback-coordinator.ts       lines >= 90%, branches >= 85%
service-worker.ts             lines >= 85%, branches >= 80%
offscreen.ts                  lines >= 85%, branches >= 80%
tts-client.ts                 lines >= 95%, branches >= 90%
storage.ts                    lines >= 95%, branches >= 90%
voices.ts                     lines >= 95%, branches >= 90%
playback-runtime-client.ts    lines >= 90%, branches >= 85%
Popup.tsx                     lines >= 85%, branches >= 75%
Options.tsx                   lines >= 85%, branches >= 75%
```

### 3.3 Python coverage policy

Added:

- `.coveragerc` with branch measurement over `docker/coqui-local`;
- pinned `pytest-cov==7.0.0` and `coverage==7.13.3`;
- `scripts/check_python_coverage.py`;
- negative checker tests in `docker/coqui-local/tests/test_coverage_policy.py`.

Python floors:

```text
Statements: 85%
Branches:   75%
```

The authoritative command runs from repository root and emits terminal, XML, JSON, and JUnit evidence.

---

## 4. Test expansion

The candidate has 33 TypeScript test files and 288 tests, up from 32 files and 214 tests.

Coverage was added for:

- playback-coordinator source setup, synchronous and asynchronous media failures, stale callbacks, cleanup recovery, transition wake races, active-fetch replacement, and diagnostics bounds;
- service-worker selection, settings, offscreen lifecycle, protocol validation, persistence degradation, commands, menus, probes, and diagnostics;
- offscreen start/control/status/diagnostics validation and event forwarding;
- TTS URL and numeric validation, abort timing, malformed headers, stream-reader failures, cancellation failures, and lock cleanup;
- runtime transport success, malformed responses, controls, status, and session correlation;
- Popup and Options loading, repair warnings, save failure/retry, invalid drafts, discovery failure, and configured-voice preservation;
- Python startup, readiness, voice discovery shapes, backend output failures, request validation, queue/future accounting, cancellation, cleanup, and shutdown.

The candidate has 57 Python tests, up from 30.

---

## 5. Final local coverage

### 5.1 TypeScript

| Metric | Final |
|---|---:|
| Statements | 95.62% |
| Branches | 88.21% |
| Functions | 96.14% |
| Lines | 95.62% |

Critical files:

| File | Lines | Branches |
|---|---:|---:|
| `src/background/service-worker.ts` | 89.46% | 80.58% |
| `src/offscreen.ts` | 98.52% | 96.15% |
| `src/offscreen/playback-coordinator.ts` | 96.36% | 86.12% |
| `src/lib/tts-client.ts` | 99.16% | 98.98% |
| `src/lib/storage.ts` | 100.00% | 96.00% |
| `src/lib/voices.ts` | 100.00% | 92.59% |
| `src/lib/playback-runtime-client.ts` | 93.93% | 95.65% |
| `src/popup/Popup.tsx` | 91.13% | 77.96% |
| `src/options/Options.tsx` | 93.52% | 82.70% |

### 5.2 Python

| Metric | Final |
|---|---:|
| Statements | 97.44% |
| Branches | 89.19% |

`app.py` and `healthcheck.py` both appear in the coverage report and satisfy policy.

---

## 6. CI and evidence hardening

The permanent CI workflow now:

- verifies the TypeScript coverage surface before tests;
- enforces global Vitest floors and critical-file floors;
- uploads attempt-specific TypeScript JSON, HTML, summary, and JUnit artifacts;
- runs Python branch coverage and uploads XML, JSON, and JUnit artifacts;
- distinguishes run attempts in artifact names;
- publishes exact SHA, run ID, attempt, and TypeScript/Python percentages in the step summary;
- uploads TypeScript and Python reports under separate Codecov flags;
- retains the existing real Chromium, build, hygiene, secret-scan, and Compose gates.

The temporary `.github/workflows/export-source.yml` used to obtain a sandbox development snapshot is deleted from the candidate tree. `src/no-temporary-workflows.test.ts` now rejects its reintroduction.

---

## 7. Validation performed

Passed locally:

- `npm run lint`
- `npm run typecheck`
- `node scripts/check-coverage-surface.mjs`
- authoritative Vitest coverage command
- `node scripts/check-coverage-thresholds.mjs coverage/coverage-final.json`
- `bash scripts/check-fix2-hygiene.sh`
- `bash scripts/check-secret-patterns.sh`
- `npm run build`
- `npm run build:e2e`
- authoritative Python branch-coverage command
- `python scripts/check_python_coverage.py reports/coqui-coverage.json`
- CI YAML parse
- `git diff --check`
- 20 complete Vitest repetitions without retries
- 20 complete Python repetitions without retries

Local environment details:

```text
Node:       v22.16.0
npm:        10.9.2
Vitest:     1.6.1
Python:     3.11
Chromium:   144.0.7559.96 (Debian)
```

### Browser limitation

The local Chromium binary could start headless DevTools, but the required non-headless extension launch under Xvfb did not create `DevToolsActivePort`. Consequently:

- local Chromium runtime and UI suites are not claimed as passing;
- no harness failure was converted into a pass;
- permanent hosted Chrome CI is the authoritative Block 14/15 browser evidence.

---

## 8. Remaining exact-SHA gates

Before this TODO can become `COMPLETE`:

1. commit the candidate and record its exact SHA;
2. require the permanent CI workflow to pass on that SHA;
3. inspect attempt-specific TypeScript, Python, Chromium, and JUnit artifacts;
4. trigger and pass real-Coqui validation on the same final SHA;
5. reconcile this report and the TODO with exact run, attempt, artifact, digest, and image evidence;
6. rerun both permanent workflows after any evidence-document commit that changes the SHA.

The broader FIX2 disposition remains `PARTIAL` until the separate human listening evidence is executed.
