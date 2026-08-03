# Chrome Read It Test Coverage Hardening TODO

**Status:** NOT STARTED  
**Date:** 2026-08-03  
**Governing specification:** `docs/CHROME_READIT_TEST_COVERAGE_HARDENING_SPEC_2026-08-03.md`  
**Repository:** `ekkus93/chrome_readit`  
**Baseline exact SHA:** `2a7abaa61d67412daeaf02465224304ab31f5e4f`

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

- [ ] Do not describe the current six-file coverage percentage as repository-wide coverage.
- [ ] Do not claim Block 16 human listening is complete.
- [ ] Do not use an E2E pass as a substitute for a missing deterministic unit test when the behavior can be isolated.
- [ ] Do not use unit coverage as a substitute for real Chromium or real-Coqui validation.
- [ ] Do not convert incomplete harness execution into a pass.
- [ ] Do not hide production files through broad exclusions.
- [ ] Do not lower thresholds without recording the exact reason and a bounded restoration task.
- [ ] Do not add meaningless tests solely to increase percentages.

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

---

# Block 1 — Baseline inventory and reproducibility

## 1.1 Record the production TypeScript surface

- [ ] Enumerate every production `.ts` and `.tsx` file under `src/`.
- [ ] Exclude test files from the inventory.
- [ ] Classify each file as runtime logic, UI logic, protocol/model logic, bootstrap, manifest/configuration, or generated/type-only.
- [ ] Record the current total production-file count.
- [ ] Compare that count with the existing FIX2 hygiene output.
- [ ] Investigate any mismatch rather than choosing one count arbitrarily.

## 1.2 Record the current measured surface

- [ ] Record every file currently listed in `vitest.config.ts` coverage `include`.
- [ ] Confirm the current measured-file count is six before modification.
- [ ] Record current explicit coverage exclusions.
- [ ] Record whether all-files behavior is active.
- [ ] Record whether unimported production files appear as zero coverage.

## 1.3 Reproduce the baseline report

Run:

```bash
npm ci
npx vitest --run --coverage
```

- [ ] Record test-file count.
- [ ] Record test count.
- [ ] Record statements, branches, functions, and lines.
- [ ] Preserve `coverage/coverage-final.json`.
- [ ] Preserve the HTML report.
- [ ] Confirm the result matches or explain any difference from hosted CI run `30858536049` attempt 2.

## 1.4 Record Python baseline

Run:

```bash
python -m pip install -r docker/coqui-local/requirements-test.txt
python -m pytest -q docker/coqui-local/tests
```

- [ ] Record Python test count.
- [ ] Record whether `pytest-cov` is currently installed.
- [ ] Record that Python statement and branch coverage are not yet enforced.

**Block 1 acceptance:** A committed baseline section identifies the complete production surface, the six-file measured surface, test counts, and reproducible reports without changing thresholds.

### Block 1 evidence

```text
Commit SHA:
Commands run:
Production TypeScript files:
Measured TypeScript files:
Vitest tests:
Python tests:
Reports:
Known limitations:
```

---

# Block 2 — Expand TypeScript coverage measurement

## 2.1 Replace the six-file allowlist

- [ ] Change coverage inclusion to default to `src/**/*.{ts,tsx}` or an equivalent complete production glob.
- [ ] Preserve exclusions for `**/*.test.ts` and `**/*.test.tsx`.
- [ ] Exclude `.d.ts` files.
- [ ] Enable all-files behavior so unimported production files cannot disappear.
- [ ] Do not add broad directory exclusions for `background`, `offscreen`, `popup`, `options`, or `lib`.

## 2.2 Review candidate bootstrap exclusions

For every proposed exclusion:

- [ ] Confirm the file contains no branching or business logic.
- [ ] Confirm it only mounts or wires an already tested module.
- [ ] Add a narrow explicit pattern rather than a directory-wide pattern.
- [ ] Record the reason adjacent to the configuration or in a coverage-policy section.
- [ ] Confirm the exclusion does not hide manifest validation, runtime message routing, or error handling.

## 2.3 Generate the widened report

Run:

```bash
npx vitest --run --coverage
```

- [ ] Preserve the first widened `coverage-final.json` before adding new tests.
- [ ] Record global percentages.
- [ ] Record every file below 80% lines.
- [ ] Record every file below 70% branches.
- [ ] Record every zero-coverage production file.
- [ ] Do not immediately lower existing CI thresholds merely to make the widened report green.

## 2.4 Protect the original six core files

- [ ] Compare each original measured file with the Block 1 baseline.
- [ ] Confirm no original file loses meaningful coverage.
- [ ] Investigate any regression before continuing.

**Block 2 acceptance:** The report includes the meaningful production TypeScript surface, including zero-import files, and produces a documented widened baseline.

### Block 2 evidence

```text
Commit SHA:
Commands run:
Included files:
Excluded files and reasons:
Global coverage:
Files below target:
Zero-coverage files:
Reports:
```

---

# Block 3 — Coverage-surface integrity guard

## 3.1 Implement the guard

- [ ] Add a deterministic script or test that enumerates production TypeScript/TSX files.
- [ ] Read or share the authoritative inclusion and exclusion policy.
- [ ] Fail when a production file matches neither measured coverage nor an approved exclusion.
- [ ] Fail when an exclusion pattern matches more files than intended.
- [ ] Produce a readable list of missing or unexpectedly excluded paths.
- [ ] Avoid duplicating a hard-coded file list in multiple places.

## 3.2 Test the guard

Add tests proving it fails when:

- [ ] a new runtime `.ts` file is outside the measured surface;
- [ ] a new runtime `.tsx` file is outside the measured surface;
- [ ] an exclusion becomes overly broad;
- [ ] a test file is correctly ignored;
- [ ] a `.d.ts` file is correctly ignored; and
- [ ] an approved bootstrap exclusion remains accepted.

## 3.3 Wire the guard into CI

- [ ] Run the guard before coverage execution.
- [ ] Give the CI step a specific name.
- [ ] Ensure failure output names the offending files.
- [ ] Add syntax or unit validation for the guard itself.

**Block 3 acceptance:** Adding an uncovered production file causes local and hosted validation to fail with an actionable message.

### Block 3 evidence

```text
Commit SHA:
Guard command:
Positive tests:
Negative tests:
CI step:
```

---

# Block 4 — Playback coordinator failure and cleanup coverage

## 4.1 Audio source setup failures

Add deterministic tests for:

- [ ] object URL creation throwing;
- [ ] audio source assignment throwing where the test double supports it;
- [ ] playback-rate assignment throwing where the test double supports it;
- [ ] synchronous `audio.play()` throw;
- [ ] rejected `audio.play()` promise; and
- [ ] media error before successful start.

Every test must assert:

- [ ] stable playback error code and message class;
- [ ] terminal failed state;
- [ ] `activePlayerCount === 0`;
- [ ] `maxActivePlayerCount <= 1`;
- [ ] no stale object URL;
- [ ] no unresolved session promise; and
- [ ] subsequent recovery playback remains possible when appropriate.

## 4.2 Stale callback and duplicate event behavior

- [ ] Test duplicate `ended` events.
- [ ] Test stale `ended` from an older attempt.
- [ ] Test stale media error from an older attempt.
- [ ] Test late play-promise fulfillment from an older attempt.
- [ ] Test late play-promise rejection from an older attempt.
- [ ] Confirm stale callbacks cannot settle the current attempt.
- [ ] Confirm object URLs are revoked at most once.

## 4.3 Cleanup failure stages

Where dependencies permit, test failure during:

- [ ] pause;
- [ ] source reset;
- [ ] load;
- [ ] object URL revoke; and
- [ ] replacement cleanup.

For each:

- [ ] assert fail-closed behavior;
- [ ] assert diagnostic cleanup counters;
- [ ] assert the last failure stage;
- [ ] assert no second player starts;
- [ ] repair the dependency; and
- [ ] prove a new session can recover.

## 4.4 Fetch and prefetch races

- [ ] Fetch failure before audio return.
- [ ] Replacement abort during active fetch.
- [ ] Replacement abort during prefetched next chunk.
- [ ] Late successful prefetch after replacement.
- [ ] Late failed prefetch after replacement.
- [ ] Confirm stale fetched bytes never start playback.

## 4.5 Pause and transition coverage

- [ ] Pause during synthesis.
- [ ] Pause during active playback.
- [ ] Pause during sentence gap.
- [ ] Pause during paragraph gap.
- [ ] Preserve remaining delay after resume.
- [ ] Cancel while paused.
- [ ] Replace while paused.
- [ ] Rapid pause/resume sequences.
- [ ] Confirm no negative or repeated transition timing.

## 4.6 Coordinator threshold

- [ ] Reach at least 90% lines.
- [ ] Reach at least 85% branches.
- [ ] Do not exclude error classes or cleanup branches.

**Block 4 acceptance:** All coordinator terminal paths clean up deterministically, the single-player invariant is asserted, and critical-file thresholds pass.

### Block 4 evidence

```text
Commit SHA:
Tests added:
Coordinator lines before/after:
Coordinator branches before/after:
Commands run:
Known limitations:
```

---

# Block 5 — Background service-worker coverage

## 5.1 Selection and settings failures

- [ ] Unsupported active page.
- [ ] No active tab.
- [ ] Empty selection.
- [ ] Malformed `executeScript()` result.
- [ ] `executeScript()` rejection.
- [ ] Settings read rejection.
- [ ] Empty `READ_TEXT` input.
- [ ] Missing or invalid explicit source.

## 5.2 Offscreen lifecycle

- [ ] No supported offscreen API.
- [ ] `createDocument()` rejection.
- [ ] Concurrent creation coalescing.
- [ ] Readiness listener not installed immediately.
- [ ] Readiness timeout.
- [ ] Existing document path.
- [ ] Destroyed document path.
- [ ] Recreated document returning idle for an active persisted session.

## 5.3 Protocol response validation

- [ ] Invalid start response.
- [ ] Invalid control response.
- [ ] Invalid status response.
- [ ] Invalid diagnostics response.
- [ ] Transport rejection with no active session.
- [ ] Transport rejection with an active session.
- [ ] `SESSION_NOT_FOUND` while an active session was persisted.

## 5.4 Persistence degradation

- [ ] `chrome.storage.session.get()` rejection.
- [ ] `chrome.storage.session.set()` rejection.
- [ ] In-memory state remains available after read failure.
- [ ] In-memory state remains available after write failure.
- [ ] `persistenceDegraded` becomes visible.
- [ ] Successful later storage operation clears degraded status when contractually appropriate.
- [ ] Older same-session sequence cannot overwrite newer state.
- [ ] Older-session terminal state cannot overwrite replacement start.
- [ ] Serialized writes preserve completion.

## 5.5 Commands, menus, probes, and diagnostics

- [ ] Pause command routing.
- [ ] Resume command routing.
- [ ] Cancel command routing.
- [ ] Command failure remains visible and handled.
- [ ] Context-menu initialization success.
- [ ] Context-menu initialization error.
- [ ] Context-menu click routing.
- [ ] Probe invalid URL.
- [ ] Probe HTTP failure.
- [ ] Probe network failure.
- [ ] Probe timeout.
- [ ] Diagnostics initial snapshot timeout.
- [ ] Diagnostics later recovery.

## 5.6 Service-worker threshold

- [ ] Reach at least 85% lines.
- [ ] Reach at least 80% branches.
- [ ] Confirm coverage includes module initialization and listener branches.

**Block 5 acceptance:** Persistence, restart, offscreen, command, and invalid-response behavior is deterministic and thresholded.

### Block 5 evidence

```text
Commit SHA:
Tests added:
Service worker lines before/after:
Service worker branches before/after:
Commands run:
```

---

# Block 6 — Offscreen runtime adapter coverage

## 6.1 Message validation

- [ ] Valid start request.
- [ ] Valid control request.
- [ ] Valid status request.
- [ ] Valid diagnostic request.
- [ ] Unknown message kind.
- [ ] Malformed start request.
- [ ] Malformed control request.
- [ ] Malformed status request.
- [ ] Malformed diagnostic request.
- [ ] Stable invalid-request response.

## 6.2 Coordinator integration

- [ ] Coordinator start success.
- [ ] Coordinator start rejection.
- [ ] Coordinator control success.
- [ ] Coordinator control rejection.
- [ ] Coordinator status retrieval failure where injectable.
- [ ] Event forwarding exactly once.
- [ ] Stale event does not replace newer status.
- [ ] Valid diagnostic snapshots forward.
- [ ] Invalid diagnostic snapshots are ignored or rejected according to contract.

## 6.3 Initialization and teardown

- [ ] Initialization success.
- [ ] Initialization dependency failure.
- [ ] Listener setup behavior.
- [ ] Teardown removes or neutralizes callbacks where applicable.
- [ ] No fallback player is constructed.

## 6.4 Offscreen threshold

- [ ] Reach at least 85% lines.
- [ ] Reach at least 80% branches.

**Block 6 acceptance:** The offscreen adapter strictly validates protocol boundaries and cannot silently swallow coordinator failures.

### Block 6 evidence

```text
Commit SHA:
Tests added:
Offscreen lines before/after:
Offscreen branches before/after:
Commands run:
```

---

# Block 7 — TTS client, storage, voices, endpoints, runtime client, and messaging

## 7.1 TTS client input validation

- [ ] Malformed URL.
- [ ] Non-HTTP(S) protocol.
- [ ] Forbidden host-play endpoint.
- [ ] `maxResponseBytes` zero.
- [ ] `maxResponseBytes` negative.
- [ ] `maxResponseBytes` fractional.
- [ ] `maxResponseBytes` `NaN`.
- [ ] `maxResponseBytes` infinity.
- [ ] Timeout zero.
- [ ] Timeout negative.
- [ ] Timeout `NaN`.
- [ ] Timeout infinity.

## 7.2 TTS client abort and stream branches

- [ ] Already-aborted signal.
- [ ] Cancellation before headers.
- [ ] Timeout before headers.
- [ ] Network failure before headers.
- [ ] Missing MIME.
- [ ] Nonaudio MIME.
- [ ] Malformed `Content-Length`.
- [ ] Negative `Content-Length`.
- [ ] Fractional `Content-Length`.
- [ ] Exact-size response at cap.
- [ ] Zero-byte chunks followed by data.
- [ ] Reader `read()` rejection.
- [ ] Reader cancellation rejection.
- [ ] Reader lock release on success.
- [ ] Reader lock release on failure.
- [ ] External cancellation versus timeout race.
- [ ] Timer and listener cleanup.

## 7.3 Storage branches

- [ ] Malformed top-level storage result.
- [ ] Legacy/per-key precedence for every key.
- [ ] Nonmatching URL path does not migrate.
- [ ] Query and fragment preservation during supported migration.
- [ ] Repair writes contain only changed keys.
- [ ] Repair write rejection propagates or is surfaced according to contract.
- [ ] Storage read rejection.
- [ ] Empty save avoids write.
- [ ] Concurrent partial saves.
- [ ] Failed save propagation.
- [ ] No non-finite rate reaches UI formatting.

## 7.4 Voice discovery and endpoint branches

- [ ] `/api/tts` endpoint derivation.
- [ ] `/api/tts/` endpoint derivation.
- [ ] Nested prefix derivation.
- [ ] Query removal or preservation according to contract.
- [ ] Fragment removal.
- [ ] Invalid URL.
- [ ] Valid empty voice list.
- [ ] Duplicate voices.
- [ ] Whitespace-only voices.
- [ ] HTTP failure.
- [ ] Network failure.
- [ ] Timeout.
- [ ] Invalid JSON.
- [ ] Invalid schema.
- [ ] Timer cleanup.

## 7.5 Runtime client and messaging

- [ ] Successful runtime response.
- [ ] `chrome.runtime.lastError`.
- [ ] Receiver disappearance.
- [ ] Malformed response.
- [ ] Subscription.
- [ ] Unsubscription.
- [ ] Late event after unsubscribe.
- [ ] Stale-session filtering.
- [ ] Request and session correlation.
- [ ] No unhandled rejection.

## 7.6 Critical library thresholds

- [ ] `tts-client.ts`: at least 95% lines and 90% branches.
- [ ] `storage.ts`: at least 95% lines and 90% branches.
- [ ] `voices.ts`: at least 95% lines and 90% branches.
- [ ] `playback-runtime-client.ts`: at least 90% lines and 85% branches.
- [ ] Endpoint and messaging modules have no materially untested error branches.

**Block 7 acceptance:** Network, storage, discovery, endpoint, runtime transport, and validation branches are measured and deterministic.

### Block 7 evidence

```text
Commit SHA:
Tests added:
Per-file coverage before/after:
Commands run:
Known limitations:
```

---

# Block 8 — Popup and Options asynchronous state coverage

## 8.1 Shared settings behavior

For both Popup and Options where applicable:

- [ ] Initial load success.
- [ ] Initial load failure.
- [ ] Repaired-settings warnings.
- [ ] Dirty-state tracking.
- [ ] Failed save retains dirty state.
- [ ] Visible save error.
- [ ] Retry succeeds.
- [ ] Stale save completion cannot overwrite newer edits.
- [ ] Unmount during save causes no state update or unhandled rejection.

## 8.2 URL draft behavior

- [ ] Invalid draft remains local.
- [ ] Invalid draft is not persisted.
- [ ] Invalid draft does not trigger voice discovery.
- [ ] Last valid endpoint remains persisted.
- [ ] Local-default action uses normal validation and save path.
- [ ] Valid commit clears validation error.

## 8.3 Voice discovery state

- [ ] Success with voices.
- [ ] Success with valid empty list.
- [ ] Timeout.
- [ ] Network failure.
- [ ] HTTP failure.
- [ ] Invalid JSON.
- [ ] Invalid schema.
- [ ] Configured voice remains selected after discovery failure.
- [ ] Stale discovery result after endpoint change is ignored.
- [ ] Unmount during discovery is safe.

## 8.4 Playback request and event state

- [ ] Start pending state.
- [ ] Start accepted.
- [ ] Start rejected.
- [ ] Newer start supersedes older pending response.
- [ ] Explicit supersession status.
- [ ] Missed-event recovery by status query.
- [ ] Pause success and failure.
- [ ] Resume success and failure.
- [ ] Cancel success and failure.
- [ ] Older-session event ignored.
- [ ] Unmount during start or control request is safe.

## 8.5 UI coverage policy

- [ ] Avoid snapshots that add no behavioral assurance.
- [ ] Prefer role/label queries and visible state.
- [ ] Measure Popup and Options production files.
- [ ] Establish realistic per-file floors after async branches are covered.
- [ ] Document any JSX bootstrap exclusion separately from component logic.

**Block 8 acceptance:** UI tests cover observable error, retry, stale-result, and unmount behavior without relying on static snapshots.

### Block 8 evidence

```text
Commit SHA:
Tests added:
Popup coverage before/after:
Options coverage before/after:
Commands run:
```

---

# Block 9 — Python Coqui branch-coverage infrastructure

## 9.1 Dependencies

- [ ] Add a pinned or appropriately constrained `pytest-cov` dependency to `docker/coqui-local/requirements-test.txt`.
- [ ] Confirm dependency installation without `--legacy-peer-deps` or analogous bypasses.
- [ ] Record the installed pytest-cov and coverage.py versions in CI logs.

## 9.2 Authoritative Python coverage command

- [ ] Run tests with statement coverage.
- [ ] Enable branch coverage.
- [ ] Produce terminal missing-line output.
- [ ] Produce Cobertura XML at `reports/coqui-coverage.xml`.
- [ ] Produce JSON at `reports/coqui-coverage.json`.
- [ ] Produce Python JUnit XML at a stable path.
- [ ] Ensure the command works from repository root.

## 9.3 Initial Python thresholds

- [ ] Record the first measured baseline before adding tests.
- [ ] Enforce at least 85% statements after gap closure.
- [ ] Enforce at least 75% branches after gap closure.
- [ ] Do not exclude `app.py` runtime branches for convenience.

## 9.4 CI integration

- [ ] Replace or supplement the plain pytest step with the authoritative coverage command.
- [ ] Upload Python coverage XML.
- [ ] Upload Python coverage JSON.
- [ ] Upload Python JUnit XML.
- [ ] Fail when any expected report is missing.

**Block 9 acceptance:** Python coverage is locally and hostedly reproducible, includes branches, and produces durable reports.

### Block 9 evidence

```text
Commit SHA:
Dependency versions:
Command:
Baseline statements:
Baseline branches:
Artifacts:
```

---

# Block 10 — Python Coqui runtime gap closure

## 10.1 Configuration and voice discovery

- [ ] Dictionary voice source.
- [ ] List voice source.
- [ ] Tuple voice source.
- [ ] Set voice source.
- [ ] Alternate backend attributes.
- [ ] Empty voice source.
- [ ] Forced voices override discovery.
- [ ] Default voice selection.
- [ ] Invalid voice rejected before queue use.

## 10.2 Startup and readiness

- [ ] Model-loader failure during startup.
- [ ] Readiness before startup.
- [ ] Voices before startup.
- [ ] Readiness after startup.
- [ ] Readiness while saturated.
- [ ] Readiness after timed-out work finishes.

## 10.3 Backend output failures

- [ ] Backend exception.
- [ ] Missing output file.
- [ ] Zero-byte output file.
- [ ] Successful WAV response.
- [ ] Generic client envelope hides backend details.

## 10.4 Queue and future lifecycle

- [ ] Queue-full rejection.
- [ ] Single-worker nonoverlap.
- [ ] Cancelled queued future.
- [ ] Executor submission failure.
- [ ] Timed-out running future remains counted.
- [ ] Timed-out future clears when work finishes.
- [ ] Slot count never exceeds capacity.
- [ ] Slot count never becomes negative.
- [ ] Queued-future count never becomes negative.
- [ ] Active-inference count never becomes negative.

## 10.5 Temporary-file and shutdown behavior

- [ ] `mkstemp` failure.
- [ ] descriptor close failure.
- [ ] cleanup failure tracked.
- [ ] cleanup retry succeeds.
- [ ] cleanup requested while path active returns safely.
- [ ] shutdown with active inference returns promptly.
- [ ] shutdown with queued but not started work.
- [ ] active path remains tracked until worker exits.
- [ ] all paths are eventually removed.

## 10.6 Request and error envelopes

- [ ] Malformed JSON.
- [ ] Missing `text`.
- [ ] Wrong `text` type.
- [ ] Wrong `voice` type.
- [ ] Empty text.
- [ ] Oversized text.
- [ ] Invalid voice.
- [ ] Queue full.
- [ ] Timeout.
- [ ] Unexpected error.
- [ ] Removed host-play and debug routes remain 404.
- [ ] No filesystem path or backend exception leaks.

## 10.7 Python thresholds

- [ ] Reach at least 85% statements.
- [ ] Reach at least 75% branches.
- [ ] Record uncovered lines and explain any justified non-release path such as real import smoke handling.

**Block 10 acceptance:** Coqui startup, request validation, queue accounting, timeout, cleanup, and shutdown branches are measured and pass thresholds.

### Block 10 evidence

```text
Commit SHA:
Tests added:
Statements before/after:
Branches before/after:
Commands run:
Known uncovered lines:
```

---

# Block 11 — Threshold enforcement and coverage policy

## 11.1 Global TypeScript floors

- [ ] Statements at least 85%.
- [ ] Lines at least 85%.
- [ ] Functions at least 85%.
- [ ] Branches at least 75%.
- [ ] All-files behavior remains enabled.

## 11.2 Critical-file floors

Enforce at least:

- [ ] `playback-coordinator.ts`: 90% lines, 85% branches.
- [ ] `service-worker.ts`: 85% lines, 80% branches.
- [ ] `offscreen.ts`: 85% lines, 80% branches.
- [ ] `tts-client.ts`: 95% lines, 90% branches.
- [ ] `storage.ts`: 95% lines, 90% branches.
- [ ] `voices.ts`: 95% lines, 90% branches.
- [ ] `playback-runtime-client.ts`: 90% lines, 85% branches.

## 11.3 Enforcement implementation

- [ ] Choose Vitest per-file thresholds, a deterministic report checker, or both.
- [ ] Validate malformed `coverage-final.json` fails.
- [ ] Validate missing `coverage-final.json` fails.
- [ ] Validate a missing critical file fails.
- [ ] Validate a critical file below threshold fails with its exact percentage.
- [ ] Validate aggregate threshold failure remains readable.

## 11.4 Threshold-change policy

- [ ] Document the threshold policy in the spec, config comments, or a dedicated coverage-policy file.
- [ ] Require exact before/after values for future reductions.
- [ ] Require a bounded restoration milestone.
- [ ] Prohibit permanent convenience reductions.

**Block 11 acceptance:** Global and critical-file thresholds fail closed and cannot be bypassed by aggregate coverage from unrelated files.

### Block 11 evidence

```text
Commit SHA:
Global thresholds:
Critical thresholds:
Negative tests:
Commands run:
```

---

# Block 12 — CI artifact and reporting hardening

## 12.1 TypeScript artifacts

- [ ] Upload `coverage/coverage-final.json`.
- [ ] Upload HTML coverage report.
- [ ] Upload a concise machine-readable summary.
- [ ] Continue uploading Vitest JUnit XML.
- [ ] Ensure missing reports fail the appropriate step.

## 12.2 Python artifacts

- [ ] Upload `reports/coqui-coverage.xml`.
- [ ] Upload `reports/coqui-coverage.json`.
- [ ] Upload Python JUnit XML.
- [ ] Ensure missing reports fail the appropriate step.

## 12.3 Rerun identity

- [ ] Ensure artifact evidence can distinguish attempts.
- [ ] Record run ID and attempt in logs or summary.
- [ ] Do not present failed-attempt artifacts as successful-attempt evidence.
- [ ] Preserve failed artifacts when useful for diagnosis.

## 12.4 CI summary

Publish or log:

- [ ] exact head SHA;
- [ ] run ID;
- [ ] attempt;
- [ ] TypeScript global percentages;
- [ ] Python global percentages;
- [ ] critical-file failures;
- [ ] artifact names and IDs when available; and
- [ ] explicit success or failure.

## 12.5 Codecov

- [ ] Continue uploading the intended TypeScript report.
- [ ] Decide whether Python uses a separate flag.
- [ ] Confirm local thresholds remain authoritative.
- [ ] Confirm no report contains secrets or unrelated filesystem content.

**Block 12 acceptance:** Hosted CI retains inspectable, attempt-specific TypeScript and Python coverage evidence for the exact commit.

### Block 12 evidence

```text
Commit SHA:
CI run:
Attempt:
Artifacts:
Artifact IDs:
Digests:
```

---

# Block 13 — Test quality and leak detection

## 13.1 Shared test helpers

- [ ] Consolidate duplicated Chrome API mocks where beneficial.
- [ ] Add typed deferred-promise helpers.
- [ ] Add controllable readable-stream helpers.
- [ ] Add fake audio helpers with explicit event control.
- [ ] Keep helpers narrow enough that tests remain readable.

## 13.2 Cleanup discipline

After every relevant test, verify or enforce:

- [ ] real timers restored;
- [ ] fake timers drained or cleared;
- [ ] globals restored;
- [ ] event listeners removed;
- [ ] stream readers released;
- [ ] object URLs revoked;
- [ ] no pending fake audio playback;
- [ ] no unresolved deferred promise owned by the test; and
- [ ] no unhandled rejection.

## 13.3 Flakiness audit

- [ ] Run the full Vitest suite repeatedly without retries.
- [ ] Run the Python suite repeatedly without retries.
- [ ] Record any intermittent test.
- [ ] Fix root causes rather than adding sleeps.
- [ ] Ensure timeout failures print the last observed state.
- [ ] Ensure browser-only retries remain narrowly classified and fail closed.

Suggested repetition commands:

```bash
for i in $(seq 1 20); do npx vitest --run || exit 1; done
for i in $(seq 1 20); do python -m pytest -q docker/coqui-local/tests || exit 1; done
```

Adjust repetition count only with a recorded reason.

**Block 13 acceptance:** Unit suites pass repeatedly without retries, resource leaks, arbitrary sleeps, or hidden unhandled rejections.

### Block 13 evidence

```text
Commit SHA:
Repetitions:
Intermittent failures found:
Fixes:
Commands run:
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

- [ ] Clean checkout used.
- [ ] Dependency installation succeeded.
- [ ] Lint succeeded.
- [ ] Typecheck succeeded.
- [ ] Coverage-surface guard succeeded.
- [ ] FIX2 hygiene succeeded.
- [ ] Secret scan succeeded.
- [ ] Vitest and TypeScript coverage thresholds succeeded.
- [ ] Production build succeeded.
- [ ] Diagnostic build succeeded.
- [ ] Chromium runtime suite succeeded.
- [ ] Chromium UI suite succeeded.
- [ ] Python tests and coverage thresholds succeeded.
- [ ] No uncommitted generated files remain.
- [ ] `git diff --check` succeeds.

**Block 14 acceptance:** Every authoritative local gate passes from a clean checkout with no manual file repair.

### Block 14 evidence

```text
Commit SHA:
Host:
Node version:
Python version:
Chrome version:
Commands and results:
Coverage summaries:
```

---

# Block 15 — Hosted exact-SHA CI validation

## 15.1 Prepare candidate

- [ ] Commit all implementation, tests, configuration, and documentation.
- [ ] Record the candidate SHA before triggering validation.
- [ ] Confirm the working tree is clean.
- [ ] Confirm no temporary workflow or diagnostic file remains.

## 15.2 Hosted CI

- [ ] Trigger or observe the permanent CI workflow on the candidate SHA.
- [ ] Confirm the publisher names the exact candidate SHA.
- [ ] Confirm lint success.
- [ ] Confirm typecheck success.
- [ ] Confirm coverage-surface guard success.
- [ ] Confirm hygiene success.
- [ ] Confirm secret scan success.
- [ ] Confirm all TypeScript tests success.
- [ ] Confirm global TypeScript thresholds success.
- [ ] Confirm critical-file thresholds success.
- [ ] Confirm production and diagnostic builds success.
- [ ] Confirm real Chromium tests success.
- [ ] Confirm Coqui Python tests success.
- [ ] Confirm Python coverage thresholds success.
- [ ] Confirm Compose security validation success.
- [ ] Confirm coverage uploads success.
- [ ] Record run ID, attempt, job ID, artifacts, and digests.

## 15.3 Failure handling

If CI fails:

- [ ] Inspect the failing step and logs.
- [ ] Classify product, test, coverage, infrastructure, or publisher failure.
- [ ] Do not rerun blindly.
- [ ] Commit any required fix.
- [ ] Use the new commit SHA as the next candidate.
- [ ] Preserve the failed run as evidence.

A rerun on the same SHA is acceptable only when diagnosing a plausible one-run infrastructure race. A successful rerun does not erase the need to understand recurring intermittence.

**Block 15 acceptance:** Permanent hosted CI is green and authoritative on the exact candidate SHA with complete coverage artifacts.

### Block 15 evidence

```text
Candidate SHA:
CI run:
Attempt:
Job:
Conclusion:
TypeScript coverage:
Python coverage:
Artifacts and digests:
Failed prior attempts:
```

---

# Block 16 — Real-Coqui validation on the same exact SHA

This block is named for this TODO only. It is not the FIX2 human listening Block 16.

- [ ] Trigger or observe the permanent real-Coqui workflow.
- [ ] Confirm it names the same candidate SHA as hosted CI.
- [ ] Confirm actual model load.
- [ ] Confirm actual synthesis.
- [ ] Confirm readiness, voices, queue, timeout, and cleanup evidence.
- [ ] Confirm immutable image ID is recorded.
- [ ] Confirm artifact ID and digest are recorded.
- [ ] Confirm loopback-only, non-root, single-worker security defaults remain.
- [ ] Confirm no host-play or debug endpoint reappears.
- [ ] Confirm completion status is success.

**Block 16 acceptance:** Hosted CI and real-Coqui validation are both green on one exact SHA.

### Block 16 evidence

```text
Candidate SHA:
Real-Coqui run:
Attempt:
Job:
Image ID:
Artifact ID:
Artifact digest:
Conclusion:
```

---

# Block 17 — Documentation reconciliation

Update as applicable:

- [ ] `README.md`
- [ ] governing implementation report
- [ ] evidence index
- [ ] this TODO
- [ ] the companion specification if implementation details changed
- [ ] CI status documentation
- [ ] Coqui testing documentation

Documentation must state:

- [ ] TypeScript coverage now measures the intended production surface.
- [ ] Exact global thresholds.
- [ ] Exact critical-file thresholds.
- [ ] Exact Python thresholds.
- [ ] Exact final test counts.
- [ ] Exact final CI run and attempt.
- [ ] Exact artifact IDs and digests.
- [ ] Exact real-Coqui run.
- [ ] Any approved exclusions and reasons.
- [ ] Any known limitations.
- [ ] Block 16 human listening remains separate.

Do not:

- [ ] reuse the old six-file percentages as the new baseline;
- [ ] claim automated coverage proves audible quality;
- [ ] claim the broader FIX2 project is complete while listening evidence remains not executed; or
- [ ] omit failed attempts that materially explain a harness or product fix.

**Block 17 acceptance:** Repository documentation accurately describes the measured scope and exact-SHA evidence without overstating release completion.

### Block 17 evidence

```text
Commit SHA:
Files updated:
Facts reconciled:
Known remaining work:
```

---

# Block 18 — Final sign-off

## 18.1 Coverage-hardening decision

- [ ] Every required block is complete.
- [ ] No required checkbox is silently deferred.
- [ ] All approved deferrals include justification and a bounded milestone.
- [ ] Hosted CI is green on the final exact SHA.
- [ ] Real-Coqui is green on the same exact SHA.
- [ ] TypeScript reports are present and internally consistent.
- [ ] Python reports are present and internally consistent.
- [ ] Critical-file floors pass.
- [ ] No new temporary workflow remains.
- [ ] No secret, credential, local path, or sensitive speech payload is present in committed reports.

## 18.2 Block 16 separation

- [ ] Confirm the FIX2 listening evidence file remains truthful.
- [ ] If listening is still not executed, state that clearly.
- [ ] Do not change the human listening status as part of automated coverage sign-off.

## 18.3 Final status

Choose exactly one:

- [ ] `COMPLETE — automated test coverage hardening passed on exact SHA; human listening remains governed separately`
- [ ] `PARTIAL — implementation or evidence remains incomplete`
- [ ] `FAILED — a required gate failed and no approved resolution exists`

Record:

```text
Final exact SHA:
Hosted CI run/attempt:
Real-Coqui run/attempt:
TypeScript test count:
Python test count:
TypeScript global coverage:
Python global coverage:
Critical-file coverage:
Artifact IDs and digests:
Human listening status:
Final decision:
```

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