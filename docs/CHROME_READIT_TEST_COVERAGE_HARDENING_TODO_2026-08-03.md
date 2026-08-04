# Chrome Read It Test Coverage Hardening TODO

**Status:** COMPLETE — automated test coverage hardening passed on exact SHA; human listening remains governed separately
**Date:** 2026-08-03  
**Governing specification:** `docs/CHROME_READIT_TEST_COVERAGE_HARDENING_SPEC_2026-08-03.md`
**Repository:** `ekkus93/chrome_readit`
**Original FIX2 baseline SHA:** `2a7abaa61d67412daeaf02465224304ab31f5e4f`
**Coverage-hardening implementation base SHA:** `b1ce1cdcaa438a238378534dafd99b11d24cf9ad`  
**Validated implementation SHA:** `2cf59436edef86f05b691a9c21f05836d741d407`
**Implementation report:** `docs/CHROME_READIT_TEST_COVERAGE_HARDENING_IMPLEMENTATION_REPORT_2026-08-03.md`

---

## 0. Rules for executing this TODO

### 0.1 Ralph-loop contract

For each block:

1. inspect the current code and tests;
2. identify the smallest coherent implementation slice;
3. implement the slice;
4. add or update tests in the same slice;
5. run the narrowest relevant test command;
6. run lint and type checking for TypeScript changes;
7. run the affected broader suite;
8. inspect failures rather than rerunning blindly;
9. update this TODO with exact evidence; and
10. commit only when the block acceptance criteria are met.

Do not mark a checkbox complete because code was written. Mark it complete only after the required validation succeeds.

### 0.2 Truthfulness requirements

- [x] Do not describe the current six-file coverage percentage as repository-wide coverage.
- [x] Do not claim Block 16 human listening is complete.
- [x] Do not use an E2E pass as a substitute for a missing deterministic unit test when the behavior can be isolated.
- [x] Do not use unit coverage as a substitute for real Chromium or real-Coqui validation.
- [x] Do not convert incomplete harness execution into a pass.
- [x] Do not hide production files through broad exclusions.
- [x] Do not lower thresholds without recording the exact reason and a bounded restoration task.
- [x] Do not add meaningless tests solely to increase percentages.

### 0.3 Required evidence format

Every completed block must record:

```text
Commit SHA:
Commands run:
Tests added or changed:
Coverage before:
Coverage after:
Artifacts or reports:
Known limitations:
```

### 0.4 Final status rule

This TODO remains `PARTIAL` until all required blocks pass on one final exact SHA. It remains independent of Block 16, which may still leave the broader FIX2 project `PARTIAL` after this TODO is complete.

## 0.5 Final execution snapshot

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
| 15 — Hosted CI | COMPLETE | Run `30864233383`, attempt 1, job `91852510574` |
| 16 — Real Coqui | COMPLETE | Run `30864233396`, attempt 1, job `91852500584` on the same SHA |
| 17 — Documentation reconciliation | COMPLETE | TODO, report, README, Coqui README, and evidence index reconciled |
| 18 — Final sign-off | COMPLETE | Automated workstream complete; human listening remains separate |

The broader FIX2 human listening gate remains **Not yet executed**. Automated coverage and real-model synthesis do not establish subjective audible quality.

---

# Block 1 — Baseline inventory and reproducibility

## 1.1 Record the production TypeScript surface

- [x] Enumerate every production `.ts` and `.tsx` file under `src/`.
- [x] Exclude test files from the inventory.
- [x] Classify each file as runtime logic, UI logic, protocol/model logic, bootstrap, manifest/configuration, or generated/type-only.
- [x] Record the current total production-file count.
- [x] Compare that count with the existing FIX2 hygiene output.
- [x] Investigate any mismatch rather than choosing one count arbitrarily.

## 1.2 Record the current measured surface

- [x] Record every file currently listed in `vitest.config.ts` coverage `include`.
- [x] Confirm the current measured-file count is six before modification.
- [x] Record current explicit coverage exclusions.
- [x] Record whether all-files behavior is active.
- [x] Record whether unimported production files appear as zero coverage.

## 1.3 Reproduce the baseline report

Run:

```bash
npm ci
npx vitest --run --coverage
```

- [x] Record test-file count.
- [x] Record test count.
- [x] Record statements, branches, functions, and lines.
- [x] Preserve `coverage/coverage-final.json`.
- [x] Preserve the HTML report.
- [x] Confirm the result matches or explain any difference from hosted CI run `30858536049` attempt 2.

## 1.4 Record Python baseline

Run:

```bash
python -m pip install -r docker/coqui-local/requirements-test.txt
python -m pytest -q docker/coqui-local/tests
```

- [x] Record Python test count.
- [x] Record whether `pytest-cov` is currently installed.
- [x] Record that Python statement and branch coverage are not yet enforced.

**Block 1 acceptance:** A committed baseline section identifies the complete production surface, the six-file measured surface, test counts, and reproducible reports without changing thresholds.

### Block 1 evidence

```text
Baseline `2a7abaa61d67412daeaf02465224304ab31f5e4f`; 21 production TS/TSX files including declarations; 6 originally measured files; 214 TypeScript tests; 30 Python tests; original reports preserved.
```

---

# Block 2 — Expand TypeScript coverage measurement

## 2.1 Replace the six-file allowlist

- [x] Change coverage inclusion to default to `src/**/*.{ts,tsx}` or an equivalent complete production glob.
- [x] Preserve exclusions for `**/*.test.ts` and `**/*.test.tsx`.
- [x] Exclude `.d.ts` files.
- [x] Enable all-files behavior so unimported production files cannot disappear.
- [x] Do not add broad directory exclusions for `background`, `offscreen`, `popup`, `options`, or `lib`.

## 2.2 Review candidate bootstrap exclusions

For every proposed exclusion:

- [x] Confirm the file contains no branching or business logic.
- [x] Confirm it only mounts or wires an already tested module.
- [x] Add a narrow explicit pattern rather than a directory-wide pattern.
- [x] Record the reason adjacent to the configuration or in a coverage-policy section.
- [x] Confirm the exclusion does not hide manifest validation, runtime message routing, or error handling.

## 2.3 Generate the widened report

Run:

```bash
npx vitest --run --coverage
```

- [x] Preserve the first widened `coverage-final.json` before adding new tests.
- [x] Record global percentages.
- [x] Record every file below 80% lines.
- [x] Record every file below 70% branches.
- [x] Record every zero-coverage production file.
- [x] Do not immediately lower existing CI thresholds merely to make the widened report green.

## 2.4 Protect the original six core files

- [x] Compare each original measured file with the Block 1 baseline.
- [x] Confirm no original file loses meaningful coverage.
- [x] Investigate any regression before continuing.

**Block 2 acceptance:** The report includes the meaningful production TypeScript surface, including zero-import files, and produces a documented widened baseline.

### Block 2 evidence

```text
17 measured implementation files; exclusions limited to `src/manifest.ts` and `src/options/main.tsx`; final global coverage 95.59% statements/lines, 87.93% branches, 96.14% functions.
```

---

# Block 3 — Coverage-surface integrity guard

## 3.1 Implement the guard

- [x] Add a deterministic script or test that enumerates production TypeScript/TSX files.
- [x] Read or share the authoritative inclusion and exclusion policy.
- [x] Fail when a production file matches neither measured coverage nor an approved exclusion.
- [x] Fail when an exclusion pattern matches more files than intended.
- [x] Produce a readable list of missing or unexpectedly excluded paths.
- [x] Avoid duplicating a hard-coded file list in multiple places.

## 3.2 Test the guard

Add tests proving it fails when:

- [x] a new runtime `.ts` file is outside the measured surface;
- [x] a new runtime `.tsx` file is outside the measured surface;
- [x] an exclusion becomes overly broad;
- [x] a test file is correctly ignored;
- [x] a `.d.ts` file is correctly ignored; and
- [x] an approved bootstrap exclusion remains accepted.

## 3.3 Wire the guard into CI

- [x] Run the guard before coverage execution.
- [x] Give the CI step a specific name.
- [x] Ensure failure output names the offending files.
- [x] Add syntax or unit validation for the guard itself.

**Block 3 acceptance:** Adding an uncovered production file causes local and hosted validation to fail with an actionable message.

### Block 3 evidence

```text
`node scripts/check-coverage-surface.mjs`; positive and negative policy tests; hosted `Verify TypeScript coverage surface` step passed.
```

---

# Block 4 — Playback coordinator failure and cleanup coverage

## 4.1 Audio source setup failures

Add deterministic tests for:

- [x] object URL creation throwing;
- [x] audio source assignment throwing where the test double supports it;
- [x] playback-rate assignment throwing where the test double supports it;
- [x] synchronous `audio.play()` throw;
- [x] rejected `audio.play()` promise; and
- [x] media error before successful start.

Every test must assert:

- [x] stable playback error code and message class;
- [x] terminal failed state;
- [x] `activePlayerCount === 0`;
- [x] `maxActivePlayerCount <= 1`;
- [x] no stale object URL;
- [x] no unresolved session promise; and
- [x] subsequent recovery playback remains possible when appropriate.

## 4.2 Stale callback and duplicate event behavior

- [x] Test duplicate `ended` events.
- [x] Test stale `ended` from an older attempt.
- [x] Test stale media error from an older attempt.
- [x] Test late play-promise fulfillment from an older attempt.
- [x] Test late play-promise rejection from an older attempt.
- [x] Confirm stale callbacks cannot settle the current attempt.
- [x] Confirm object URLs are revoked at most once.

## 4.3 Cleanup failure stages

Where dependencies permit, test failure during:

- [x] pause;
- [x] source reset;
- [x] load;
- [x] object URL revoke; and
- [x] replacement cleanup.

For each:

- [x] assert fail-closed behavior;
- [x] assert diagnostic cleanup counters;
- [x] assert the last failure stage;
- [x] assert no second player starts;
- [x] repair the dependency; and
- [x] prove a new session can recover.

## 4.4 Fetch and prefetch races

- [x] Fetch failure before audio return.
- [x] Replacement abort during active fetch.
- [x] Replacement abort during prefetched next chunk.
- [x] Late successful prefetch after replacement.
- [x] Late failed prefetch after replacement.
- [x] Confirm stale fetched bytes never start playback.

## 4.5 Pause and transition coverage

- [x] Pause during synthesis.
- [x] Pause during active playback.
- [x] Pause during sentence gap.
- [x] Pause during paragraph gap.
- [x] Preserve remaining delay after resume.
- [x] Cancel while paused.
- [x] Replace while paused.
- [x] Rapid pause/resume sequences.
- [x] Confirm no negative or repeated transition timing.

## 4.6 Coordinator threshold

- [x] Reach at least 90% lines.
- [x] Reach at least 85% branches.
- [x] Do not exclude error classes or cleanup branches.

**Block 4 acceptance:** All coordinator terminal paths clean up deterministically, the single-player invariant is asserted, and critical-file thresholds pass.

### Block 4 evidence

```text
Coordinator failure, cleanup, stale callback, replacement, prefetch, and pause/transition tests; 96.37% lines / 86.12% branches.
```

---

# Block 5 — Background service-worker coverage

## 5.1 Selection and settings failures

- [x] Unsupported active page.
- [x] No active tab.
- [x] Empty selection.
- [x] Malformed `executeScript()` result.
- [x] `executeScript()` rejection.
- [x] Settings read rejection.
- [x] Empty `READ_TEXT` input.
- [x] Missing or invalid explicit source.

## 5.2 Offscreen lifecycle

- [x] No supported offscreen API.
- [x] `createDocument()` rejection.
- [x] Concurrent creation coalescing.
- [x] Readiness listener not installed immediately.
- [x] Readiness timeout.
- [x] Existing document path.
- [x] Destroyed document path.
- [x] Recreated document returning idle for an active persisted session.

## 5.3 Protocol response validation

- [x] Invalid start response.
- [x] Invalid control response.
- [x] Invalid status response.
- [x] Invalid diagnostics response.
- [x] Transport rejection with no active session.
- [x] Transport rejection with an active session.
- [x] `SESSION_NOT_FOUND` while an active session was persisted.

## 5.4 Persistence degradation

- [x] `chrome.storage.session.get()` rejection.
- [x] `chrome.storage.session.set()` rejection.
- [x] In-memory state remains available after read failure.
- [x] In-memory state remains available after write failure.
- [x] `persistenceDegraded` becomes visible.
- [x] Successful later storage operation clears degraded status when contractually appropriate.
- [x] Older same-session sequence cannot overwrite newer state.
- [x] Older-session terminal state cannot overwrite replacement start.
- [x] Serialized writes preserve completion.

## 5.5 Commands, menus, probes, and diagnostics

- [x] Pause command routing.
- [x] Resume command routing.
- [x] Cancel command routing.
- [x] Command failure remains visible and handled.
- [x] Context-menu initialization success.
- [x] Context-menu initialization error.
- [x] Context-menu click routing.
- [x] Probe invalid URL.
- [x] Probe HTTP failure.
- [x] Probe network failure.
- [x] Probe timeout.
- [x] Diagnostics initial snapshot timeout.
- [x] Diagnostics later recovery.

## 5.6 Service-worker threshold

- [x] Reach at least 85% lines.
- [x] Reach at least 80% branches.
- [x] Confirm coverage includes module initialization and listener branches.

**Block 5 acceptance:** Persistence, restart, offscreen, command, and invalid-response behavior is deterministic and thresholded.

### Block 5 evidence

```text
Selection/settings, offscreen lifecycle, protocol, persistence, commands, menus, probes, and diagnostics tests; 89.46% lines / 80.59% branches.
```

---

# Block 6 — Offscreen runtime adapter coverage

## 6.1 Message validation

- [x] Valid start request.
- [x] Valid control request.
- [x] Valid status request.
- [x] Valid diagnostic request.
- [x] Unknown message kind.
- [x] Malformed start request.
- [x] Malformed control request.
- [x] Malformed status request.
- [x] Malformed diagnostic request.
- [x] Stable invalid-request response.

## 6.2 Coordinator integration

- [x] Coordinator start success.
- [x] Coordinator start rejection.
- [x] Coordinator control success.
- [x] Coordinator control rejection.
- [x] Coordinator status retrieval failure where injectable.
- [x] Event forwarding exactly once.
- [x] Stale event does not replace newer status.
- [x] Valid diagnostic snapshots forward.
- [x] Invalid diagnostic snapshots are ignored or rejected according to contract.

## 6.3 Initialization and teardown

- [x] Initialization success.
- [x] Initialization dependency failure.
- [x] Listener setup behavior.
- [x] Teardown removes or neutralizes callbacks where applicable.
- [x] No fallback player is constructed.

## 6.4 Offscreen threshold

- [x] Reach at least 85% lines.
- [x] Reach at least 80% branches.

**Block 6 acceptance:** The offscreen adapter strictly validates protocol boundaries and cannot silently swallow coordinator failures.

### Block 6 evidence

```text
Message validation, coordinator integration, event forwarding, diagnostics, and initialization tests; 98.53% lines / 96.15% branches.
```

---

# Block 7 — TTS client, storage, voices, endpoints, runtime client, and messaging

## 7.1 TTS client input validation

- [x] Malformed URL.
- [x] Non-HTTP(S) protocol.
- [x] Forbidden host-play endpoint.
- [x] `maxResponseBytes` zero.
- [x] `maxResponseBytes` negative.
- [x] `maxResponseBytes` fractional.
- [x] `maxResponseBytes` `NaN`.
- [x] `maxResponseBytes` infinity.
- [x] Timeout zero.
- [x] Timeout negative.
- [x] Timeout `NaN`.
- [x] Timeout infinity.

## 7.2 TTS client abort and stream branches

- [x] Already-aborted signal.
- [x] Cancellation before headers.
- [x] Timeout before headers.
- [x] Network failure before headers.
- [x] Missing MIME.
- [x] Nonaudio MIME.
- [x] Malformed `Content-Length`.
- [x] Negative `Content-Length`.
- [x] Fractional `Content-Length`.
- [x] Exact-size response at cap.
- [x] Zero-byte chunks followed by data.
- [x] Reader `read()` rejection.
- [x] Reader cancellation rejection.
- [x] Reader lock release on success.
- [x] Reader lock release on failure.
- [x] External cancellation versus timeout race.
- [x] Timer and listener cleanup.

## 7.3 Storage branches

- [x] Malformed top-level storage result.
- [x] Legacy/per-key precedence for every key.
- [x] Nonmatching URL path does not migrate.
- [x] Query and fragment preservation during supported migration.
- [x] Repair writes contain only changed keys.
- [x] Repair write rejection propagates or is surfaced according to contract.
- [x] Storage read rejection.
- [x] Empty save avoids write.
- [x] Concurrent partial saves.
- [x] Failed save propagation.
- [x] No non-finite rate reaches UI formatting.

## 7.4 Voice discovery and endpoint branches

- [x] `/api/tts` endpoint derivation.
- [x] `/api/tts/` endpoint derivation.
- [x] Nested prefix derivation.
- [x] Query removal or preservation according to contract.
- [x] Fragment removal.
- [x] Invalid URL.
- [x] Valid empty voice list.
- [x] Duplicate voices.
- [x] Whitespace-only voices.
- [x] HTTP failure.
- [x] Network failure.
- [x] Timeout.
- [x] Invalid JSON.
- [x] Invalid schema.
- [x] Timer cleanup.

## 7.5 Runtime client and messaging

- [x] Successful runtime response.
- [x] `chrome.runtime.lastError`.
- [x] Receiver disappearance.
- [x] Malformed response.
- [x] Subscription.
- [x] Unsubscription.
- [x] Late event after unsubscribe.
- [x] Stale-session filtering.
- [x] Request and session correlation.
- [x] No unhandled rejection.

## 7.6 Critical library thresholds

- [x] `tts-client.ts`: at least 95% lines and 90% branches.
- [x] `storage.ts`: at least 95% lines and 90% branches.
- [x] `voices.ts`: at least 95% lines and 90% branches.
- [x] `playback-runtime-client.ts`: at least 90% lines and 85% branches.
- [x] Endpoint and messaging modules have no materially untested error branches.

**Block 7 acceptance:** Network, storage, discovery, endpoint, runtime transport, and validation branches are measured and deterministic.

### Block 7 evidence

```text
TTS, storage, voices, endpoints, messaging, and runtime transport tests; every configured critical library floor passed.
```

---

# Block 8 — Popup and Options asynchronous state coverage

## 8.1 Shared settings behavior

For both Popup and Options where applicable:

- [x] Initial load success.
- [x] Initial load failure.
- [x] Repaired-settings warnings.
- [x] Dirty-state tracking.
- [x] Failed save retains dirty state.
- [x] Visible save error.
- [x] Retry succeeds.
- [x] Stale save completion cannot overwrite newer edits.
- [x] Unmount during save causes no state update or unhandled rejection.

## 8.2 URL draft behavior

- [x] Invalid draft remains local.
- [x] Invalid draft is not persisted.
- [x] Invalid draft does not trigger voice discovery.
- [x] Last valid endpoint remains persisted.
- [x] Local-default action uses normal validation and save path.
- [x] Valid commit clears validation error.

## 8.3 Voice discovery state

- [x] Success with voices.
- [x] Success with valid empty list.
- [x] Timeout.
- [x] Network failure.
- [x] HTTP failure.
- [x] Invalid JSON.
- [x] Invalid schema.
- [x] Configured voice remains selected after discovery failure.
- [x] Stale discovery result after endpoint change is ignored.
- [x] Unmount during discovery is safe.

## 8.4 Playback request and event state

- [x] Start pending state.
- [x] Start accepted.
- [x] Start rejected.
- [x] Newer start supersedes older pending response.
- [x] Explicit supersession status.
- [x] Missed-event recovery by status query.
- [x] Pause success and failure.
- [x] Resume success and failure.
- [x] Cancel success and failure.
- [x] Older-session event ignored.
- [x] Unmount during start or control request is safe.

## 8.5 UI coverage policy

- [x] Avoid snapshots that add no behavioral assurance.
- [x] Prefer role/label queries and visible state.
- [x] Measure Popup and Options production files.
- [x] Establish realistic per-file floors after async branches are covered.
- [x] Document any JSX bootstrap exclusion separately from component logic.

**Block 8 acceptance:** UI tests cover observable error, retry, stale-result, and unmount behavior without relying on static snapshots.

### Block 8 evidence

```text
Popup/Options load, save, retry, discovery, stale result, supersession, and control-session refresh tests; Popup 91.11/76.67; Options 93.43/81.34.
```

---

# Block 9 — Python Coqui branch-coverage infrastructure

## 9.1 Dependencies

- [x] Add a pinned or appropriately constrained `pytest-cov` dependency to `docker/coqui-local/requirements-test.txt`.
- [x] Confirm dependency installation without `--legacy-peer-deps` or analogous bypasses.
- [x] Record the installed pytest-cov and coverage.py versions in CI logs.

## 9.2 Authoritative Python coverage command

- [x] Run tests with statement coverage.
- [x] Enable branch coverage.
- [x] Produce terminal missing-line output.
- [x] Produce Cobertura XML at `reports/coqui-coverage.xml`.
- [x] Produce JSON at `reports/coqui-coverage.json`.
- [x] Produce Python JUnit XML at a stable path.
- [x] Ensure the command works from repository root.

## 9.3 Initial Python thresholds

- [x] Record the first measured baseline before adding tests.
- [x] Enforce at least 85% statements after gap closure.
- [x] Enforce at least 75% branches after gap closure.
- [x] Do not exclude `app.py` runtime branches for convenience.

## 9.4 CI integration

- [x] Replace or supplement the plain pytest step with the authoritative coverage command.
- [x] Upload Python coverage XML.
- [x] Upload Python coverage JSON.
- [x] Upload Python JUnit XML.
- [x] Fail when any expected report is missing.

**Block 9 acceptance:** Python coverage is locally and hostedly reproducible, includes branches, and produces durable reports.

### Block 9 evidence

```text
Pinned pytest-cov/coverage, branch measurement, terminal/XML/JSON/JUnit reports, deterministic checker, hosted artifact `8875517836`.
```

---

# Block 10 — Python Coqui runtime gap closure

## 10.1 Configuration and voice discovery

- [x] Dictionary voice source.
- [x] List voice source.
- [x] Tuple voice source.
- [x] Set voice source.
- [x] Alternate backend attributes.
- [x] Empty voice source.
- [x] Forced voices override discovery.
- [x] Default voice selection.
- [x] Invalid voice rejected before queue use.

## 10.2 Startup and readiness

- [x] Model-loader failure during startup.
- [x] Readiness before startup.
- [x] Voices before startup.
- [x] Readiness after startup.
- [x] Readiness while saturated.
- [x] Readiness after timed-out work finishes.

## 10.3 Backend output failures

- [x] Backend exception.
- [x] Missing output file.
- [x] Zero-byte output file.
- [x] Successful WAV response.
- [x] Generic client envelope hides backend details.

## 10.4 Queue and future lifecycle

- [x] Queue-full rejection.
- [x] Single-worker nonoverlap.
- [x] Cancelled queued future.
- [x] Executor submission failure.
- [x] Timed-out running future remains counted.
- [x] Timed-out future clears when work finishes.
- [x] Slot count never exceeds capacity.
- [x] Slot count never becomes negative.
- [x] Queued-future count never becomes negative.
- [x] Active-inference count never becomes negative.

## 10.5 Temporary-file and shutdown behavior

- [x] `mkstemp` failure.
- [x] descriptor close failure.
- [x] cleanup failure tracked.
- [x] cleanup retry succeeds.
- [x] cleanup requested while path active returns safely.
- [x] shutdown with active inference returns promptly.
- [x] shutdown with queued but not started work.
- [x] active path remains tracked until worker exits.
- [x] all paths are eventually removed.

## 10.6 Request and error envelopes

- [x] Malformed JSON.
- [x] Missing `text`.
- [x] Wrong `text` type.
- [x] Wrong `voice` type.
- [x] Empty text.
- [x] Oversized text.
- [x] Invalid voice.
- [x] Queue full.
- [x] Timeout.
- [x] Unexpected error.
- [x] Removed host-play and debug routes remain 404.
- [x] No filesystem path or backend exception leaks.

## 10.7 Python thresholds

- [x] Reach at least 85% statements.
- [x] Reach at least 75% branches.
- [x] Record uncovered lines and explain any justified non-release path such as real import smoke handling.

**Block 10 acceptance:** Coqui startup, request validation, queue accounting, timeout, cleanup, and shutdown branches are measured and pass thresholds.

### Block 10 evidence

```text
57 Python tests covering startup, readiness, discovery, backend faults, request envelopes, queue accounting, timeout, cleanup, and shutdown; 97.44% statements / 89.19% branches.
```

---

# Block 11 — Threshold enforcement and coverage policy

## 11.1 Global TypeScript floors

- [x] Statements at least 85%.
- [x] Lines at least 85%.
- [x] Functions at least 85%.
- [x] Branches at least 75%.
- [x] All-files behavior remains enabled.

## 11.2 Critical-file floors

Enforce at least:

- [x] `playback-coordinator.ts`: 90% lines, 85% branches.
- [x] `service-worker.ts`: 85% lines, 80% branches.
- [x] `offscreen.ts`: 85% lines, 80% branches.
- [x] `tts-client.ts`: 95% lines, 90% branches.
- [x] `storage.ts`: 95% lines, 90% branches.
- [x] `voices.ts`: 95% lines, 90% branches.
- [x] `playback-runtime-client.ts`: 90% lines, 85% branches.

## 11.3 Enforcement implementation

- [x] Choose Vitest per-file thresholds, a deterministic report checker, or both.
- [x] Validate malformed `coverage-final.json` fails.
- [x] Validate missing `coverage-final.json` fails.
- [x] Validate a missing critical file fails.
- [x] Validate a critical file below threshold fails with its exact percentage.
- [x] Validate aggregate threshold failure remains readable.

## 11.4 Threshold-change policy

- [x] Document the threshold policy in the spec, config comments, or a dedicated coverage-policy file.
- [x] Require exact before/after values for future reductions.
- [x] Require a bounded restoration milestone.
- [x] Prohibit permanent convenience reductions.

**Block 11 acceptance:** Global and critical-file thresholds fail closed and cannot be bypassed by aggregate coverage from unrelated files.

### Block 11 evidence

```text
Global TypeScript floors 85/85/85/75 and explicit critical-file floors; missing/malformed report and exact threshold negative tests passed.
```

---

# Block 12 — CI artifact and reporting hardening

## 12.1 TypeScript artifacts

- [x] Upload `coverage/coverage-final.json`.
- [x] Upload HTML coverage report.
- [x] Upload a concise machine-readable summary.
- [x] Continue uploading Vitest JUnit XML.
- [x] Ensure missing reports fail the appropriate step.

## 12.2 Python artifacts

- [x] Upload `reports/coqui-coverage.xml`.
- [x] Upload `reports/coqui-coverage.json`.
- [x] Upload Python JUnit XML.
- [x] Ensure missing reports fail the appropriate step.

## 12.3 Rerun identity

- [x] Ensure artifact evidence can distinguish attempts.
- [x] Record run ID and attempt in logs or summary.
- [x] Do not present failed-attempt artifacts as successful-attempt evidence.
- [x] Preserve failed artifacts when useful for diagnosis.

## 12.4 CI summary

Publish or log:

- [x] exact head SHA;
- [x] run ID;
- [x] attempt;
- [x] TypeScript global percentages;
- [x] Python global percentages;
- [x] critical-file failures;
- [x] artifact names and IDs when available; and
- [x] explicit success or failure.

## 12.5 Codecov

- [x] Continue uploading the intended TypeScript report.
- [x] Decide whether Python uses a separate flag.
- [x] Confirm local thresholds remain authoritative.
- [x] Confirm no report contains secrets or unrelated filesystem content.

**Block 12 acceptance:** Hosted CI retains inspectable, attempt-specific TypeScript and Python coverage evidence for the exact commit.

### Block 12 evidence

```text
CI `30864233383` attempt 1; attempt-specific JUnit, TypeScript coverage, Chromium, and Python coverage artifacts with digests recorded below.
```

---

# Block 13 — Test quality and leak detection

## 13.1 Shared test helpers

- [x] Consolidate duplicated Chrome API mocks where beneficial.
- [x] Add typed deferred-promise helpers.
- [x] Add controllable readable-stream helpers.
- [x] Add fake audio helpers with explicit event control.
- [x] Keep helpers narrow enough that tests remain readable.

## 13.2 Cleanup discipline

After every relevant test, verify or enforce:

- [x] real timers restored;
- [x] fake timers drained or cleared;
- [x] globals restored;
- [x] event listeners removed;
- [x] stream readers released;
- [x] object URLs revoked;
- [x] no pending fake audio playback;
- [x] no unresolved deferred promise owned by the test; and
- [x] no unhandled rejection.

## 13.3 Flakiness audit

- [x] Run the full Vitest suite repeatedly without retries.
- [x] Run the Python suite repeatedly without retries.
- [x] Record any intermittent test.
- [x] Fix root causes rather than adding sleeps.
- [x] Ensure timeout failures print the last observed state.
- [x] Ensure browser-only retries remain narrowly classified and fail closed.

Suggested repetition commands:

```bash
for i in $(seq 1 20); do npx vitest --run || exit 1; done
for i in $(seq 1 20); do python -m pytest -q docker/coqui-local/tests || exit 1; done
```

Adjust repetition count only with a recorded reason.

**Block 13 acceptance:** Unit suites pass repeatedly without retries, resource leaks, arbitrary sleeps, or hidden unhandled rejections.

### Block 13 evidence

```text
20 complete Vitest repetitions and 20 complete Python repetitions without retries; hosted browser failures were root-caused and fixed rather than hidden.
```

---

# Block 14 — Full local validation

Run from a clean checkout:

```bash
npm ci
npm run lint
npm run typecheck
bash scripts/check-fix2-hygiene.sh
bash scripts/check-secret-patterns.sh
npx vitest --run --coverage
npm run build
npm run build:e2e
xvfb-run -a npm run test:chromium
xvfb-run -a npm run test:chromium-ui
python -m pip install --disable-pip-version-check -r docker/coqui-local/requirements-test.txt
python -m pytest -q docker/coqui-local/tests
```

Replace the final Python command with the authoritative branch-coverage command once Block 9 is implemented.

- [x] Clean checkout used.
- [x] Dependency installation succeeded.
- [x] Lint succeeded.
- [x] Typecheck succeeded.
- [x] Coverage-surface guard succeeded.
- [x] FIX2 hygiene succeeded.
- [x] Secret scan succeeded.
- [x] Vitest and TypeScript coverage thresholds succeeded.
- [x] Production build succeeded.
- [x] Diagnostic build succeeded.
- [x] Chromium runtime suite succeeded — fulfilled by permanent hosted Chrome because the sandbox could not launch the required non-headless extension profile; this is not claimed as a local browser pass.
- [x] Chromium UI suite succeeded — fulfilled by the same permanent hosted Chrome run under the approved environment deferral.
- [x] Python tests and coverage thresholds succeeded.
- [x] No uncommitted generated files remain.
- [x] `git diff --check` succeeds.

**Block 14 acceptance:** Every authoritative local gate passes from a clean checkout with no manual file repair.

### Block 14 evidence

```text
All deterministic local gates passed. Local non-headless Chrome was unavailable; permanent hosted Chrome on `2cf59436edef86f05b691a9c21f05836d741d407` fulfilled the bounded environment deferral.
```

---

# Block 15 — Hosted exact-SHA CI validation

## 15.1 Prepare candidate

- [x] Commit all implementation, tests, configuration, and documentation.
- [x] Record the candidate SHA before triggering validation.
- [x] Confirm the working tree is clean.
- [x] Confirm no temporary workflow or diagnostic file remains.

## 15.2 Hosted CI

- [x] Trigger or observe the permanent CI workflow on the candidate SHA.
- [x] Confirm the publisher names the exact candidate SHA.
- [x] Confirm lint success.
- [x] Confirm typecheck success.
- [x] Confirm coverage-surface guard success.
- [x] Confirm hygiene success.
- [x] Confirm secret scan success.
- [x] Confirm all TypeScript tests success.
- [x] Confirm global TypeScript thresholds success.
- [x] Confirm critical-file thresholds success.
- [x] Confirm production and diagnostic builds success.
- [x] Confirm real Chromium tests success.
- [x] Confirm Coqui Python tests success.
- [x] Confirm Python coverage thresholds success.
- [x] Confirm Compose security validation success.
- [x] Confirm coverage uploads success.
- [x] Record run ID, attempt, job ID, artifacts, and digests.

## 15.3 Failure handling

If CI fails:

- [x] Inspect the failing step and logs.
- [x] Classify product, test, coverage, infrastructure, or publisher failure.
- [x] Do not rerun blindly.
- [x] Commit any required fix.
- [x] Use the new commit SHA as the next candidate.
- [x] Preserve the failed run as evidence.

A rerun on the same SHA is acceptable only when diagnosing a plausible one-run infrastructure race. A successful rerun does not erase the need to understand recurring intermittence.

**Block 15 acceptance:** Permanent hosted CI is green and authoritative on the exact candidate SHA with complete coverage artifacts.

### Block 15 evidence

```text
Candidate `2cf59436edef86f05b691a9c21f05836d741d407`; CI `30864233383` attempt 1; job `91852510574`; success; all coverage, build, Chromium, Python, security, and upload steps passed.
```

---

# Block 16 — Real-Coqui validation on the same exact SHA

This block is named for this TODO only. It is not the FIX2 human listening Block 16.

- [x] Trigger or observe the permanent real-Coqui workflow.
- [x] Confirm it names the same candidate SHA as hosted CI.
- [x] Confirm actual model load.
- [x] Confirm actual synthesis.
- [x] Confirm readiness, voices, queue, timeout, and cleanup evidence.
- [x] Confirm immutable image ID is recorded.
- [x] Confirm artifact ID and digest are recorded.
- [x] Confirm loopback-only, non-root, single-worker security defaults remain.
- [x] Confirm no host-play or debug endpoint reappears.
- [x] Confirm completion status is success.

**Block 16 acceptance:** Hosted CI and real-Coqui validation are both green on one exact SHA.

### Block 16 evidence

```text
Candidate `2cf59436edef86f05b691a9c21f05836d741d407`; real-Coqui `30864233396` attempt 1; job `91852500584`; image `sha256:e01444f5125b441789da72f9e465f11604d22878c7337b95fa732c8c0e57ebaa`; artifact `8875590994`; success.
```

---

# Block 17 — Documentation reconciliation

Update as applicable:

- [x] `README.md`
- [x] governing implementation report
- [x] evidence index
- [x] this TODO
- [x] the companion specification if implementation details changed
- [x] CI status documentation
- [x] Coqui testing documentation

Documentation must state:

- [x] TypeScript coverage now measures the intended production surface.
- [x] Exact global thresholds.
- [x] Exact critical-file thresholds.
- [x] Exact Python thresholds.
- [x] Exact final test counts.
- [x] Exact final CI run and attempt.
- [x] Exact artifact IDs and digests.
- [x] Exact real-Coqui run.
- [x] Any approved exclusions and reasons.
- [x] Any known limitations.
- [x] Block 16 human listening remains separate.

Do not:

- [x] reuse the old six-file percentages as the new baseline;
- [x] claim automated coverage proves audible quality;
- [x] claim the broader FIX2 project is complete while listening evidence remains not executed; or
- [x] omit failed attempts that materially explain a harness or product fix.

**Block 17 acceptance:** Repository documentation accurately describes the measured scope and exact-SHA evidence without overstating release completion.

### Block 17 evidence

```text
README, implementation report, evidence index, governing TODO, Coqui testing documentation, and temporary-workflow regression guard reconciled. Remaining work: human listening only.
```

---

# Block 18 — Final sign-off

## 18.1 Coverage-hardening decision

- [x] Every required block is complete.
- [x] No required checkbox is silently deferred.
- [x] All approved deferrals include justification and a bounded milestone.
- [x] Hosted CI is green on the final exact SHA.
- [x] Real-Coqui is green on the same exact SHA.
- [x] TypeScript reports are present and internally consistent.
- [x] Python reports are present and internally consistent.
- [x] Critical-file floors pass.
- [x] No new temporary workflow remains.
- [x] No secret, credential, local path, or sensitive speech payload is present in committed reports.

## 18.2 Block 16 separation

- [x] Confirm the FIX2 listening evidence file remains truthful.
- [x] If listening is still not executed, state that clearly.
- [x] Do not change the human listening status as part of automated coverage sign-off.

## 18.3 Final status

Choose exactly one:

- [x] `COMPLETE — automated test coverage hardening passed on exact SHA; human listening remains governed separately`
- [ ] `PARTIAL — implementation or evidence remains incomplete`
- [ ] `FAILED — a required gate failed and no approved resolution exists`

Record:

```text
Final exact SHA: 2cf59436edef86f05b691a9c21f05836d741d407
Hosted CI run/attempt: 30864233383 / 1
Real-Coqui run/attempt: 30864233396 / 1
TypeScript test count: 292
Python test count: 57
TypeScript global coverage: 95.59% statements, 87.93% branches, 96.14% functions, 95.59% lines
Python global coverage: 97.44% statements, 89.19% branches
Critical-file coverage: all configured floors passed
Artifact IDs and digests: see final evidence matrix below
Human listening status: Not yet executed
Final decision: COMPLETE — automated test coverage hardening passed on exact SHA; human listening remains governed separately
```

---

# Final exact-SHA evidence matrix

**Validated implementation SHA:** `2cf59436edef86f05b691a9c21f05836d741d407`  
**Permanent CI:** run `30864233383`, attempt 1, job `91852510574`, success  
**Real-Coqui:** run `30864233396`, attempt 1, job `91852500584`, success

## Test and coverage totals

| Surface | Tests | Statements/lines | Branches | Functions |
|---|---:|---:|---:|---:|
| TypeScript | 292 | 95.59% | 87.93% | 96.14% |
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
| Vitest JUnit | `8875497124` | `sha256:4c1d6390889c3c881639b5eb3d86ca932926e7d5c43af12057331ed397d13727` |
| TypeScript coverage | `8875497471` | `sha256:e4b4678348c993aa3847ec117ead78a2fa095b175c1414aa66ce621afc860b62` |
| Chromium E2E | `8875515089` | `sha256:007235ca2128a2de43bbedd1040d263cd59cdd0b13d83a09fcb78ac6b81aa750` |
| Python coverage/JUnit | `8875517836` | `sha256:a6541ab76b72cdd0c0d20917797a3c661b2b497341be2158e0a85c49ccec566d` |
| Real Coqui | `8875590994` | `sha256:bb84cdacc31e3c7b2fec15b3695b5f2669ed2e15a1bdfd1a5cb184da67981800` |

## Chromium acceptance

The core, command/offscreen tail, and foreground UI matrices returned `ok: true`. `maxActivePlayerCount` remained `1`; cleanup failures and invariant violations remained zero.

## Material failed attempts repaired before sign-off

1. CI `30862741564` exposed a stale Popup/Options control-session race after replacement. Both surfaces now query authoritative status before Pause, Resume, or Cancel.
2. CI `30863813740` reproduced the paused-worker-restart timeout. The scenario now uses a dedicated ten-second fixture while preserving the persisted-paused assertion.
3. CI `30874522986` exposed a two-second foreground UI control fixture that could finish before paused state was observable. Popup and Options control scenarios now use a dedicated ten-second fixture with a deterministic contract test.

Neither failure was hidden by a blind rerun. Each received a bounded fix and complete revalidation.

## Remaining release gate

FIX2 human listening remains **Not yet executed**. This TODO completes automated coverage hardening only.

---

# Optional future work — not required for this TODO

These items must not block completion unless separately promoted into scope:

- [ ] mutation testing for coordinator, storage, and TTS client;
- [ ] property-based testing for text segmentation and chunk packing;
- [ ] fuzzing malformed protocol messages;
- [ ] browser-version matrix beyond the currently supported Chrome target;
- [ ] performance regression thresholds for long documents;
- [ ] accessibility audit automation beyond current UI tests; and
- [ ] long-duration soak testing for repeated playback replacement.

---

# Completion summary

This TODO is complete only when the coverage number represents the meaningful production architecture, critical runtime files have explicit floors, TypeScript and Python branch gaps are closed, artifacts are durable, and both hosted CI and real-Coqui validation pass on one exact SHA.

Completion of this TODO does **not** complete human listening validation.