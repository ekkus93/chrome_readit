# Chrome Read It Test Coverage Hardening Specification

**Status:** Proposed  
**Date:** 2026-08-03  
**Repository:** `ekkus93/chrome_readit`  
**Companion TODO:** `docs/CHROME_READIT_TEST_COVERAGE_HARDENING_TODO_2026-08-03.md`

---

## 1. Executive summary

Chrome Read It now has a strong automated validation stack: unit and integration tests, real Chromium extension tests, Coqui service tests, real-model validation, secret scanning, hygiene checks, production builds, and exact-SHA evidence publication. The remaining weakness is that the enforced TypeScript coverage metric measures only a narrow subset of production code.

At the current baseline, Vitest coverage includes six files:

- `src/lib/playback-protocol.ts`
- `src/lib/text-normalization.ts`
- `src/lib/text-segmentation.ts`
- `src/lib/chunk-packing.ts`
- `src/lib/playback-pacing.ts`
- `src/offscreen/playback-coordinator.ts`

The repository contains substantially more production TypeScript, including the background service worker, offscreen runtime adapter, TTS HTTP client, storage validation, voice discovery, endpoint derivation, runtime client, popup, and Options UI. Many of those modules already have tests, but their production lines and branches do not affect the enforced coverage threshold.

This specification defines a fail-closed coverage-hardening program that will:

1. measure the meaningful production TypeScript surface rather than six selected files;
2. add deterministic tests for high-risk failure and lifecycle branches;
3. add branch coverage for the Python Coqui service;
4. publish durable coverage artifacts in CI;
5. prevent aggregate percentages from hiding weak critical modules;
6. preserve real Chromium and real-Coqui validation as separate, complementary gates; and
7. keep Block 16 human listening validation independent and mandatory.

The objective is not to maximize a vanity percentage. The objective is to make important runtime invariants executable, visible, and difficult to regress.

---

## 2. Current baseline

The exact-SHA validation candidate before this coverage-hardening effort is:

```text
2a7abaa61d67412daeaf02465224304ab31f5e4f
```

The corresponding final hosted CI run completed successfully on attempt 2:

```text
Run: 30858536049
Tests: 214 passed
Measured statements: 95.85%
Measured branches: 86.95%
Measured functions: 93.18%
Measured lines: 95.85%
```

Those percentages are valid for the configured six-file coverage surface, but they must not be interpreted as repository-wide production coverage.

The current CI command enforces aggregate thresholds of:

```text
lines:      80%
functions:  80%
statements: 80%
branches:   70%
```

The Python Coqui service tests run under `pytest`, but Python coverage is not currently measured or thresholded.

---

## 3. Problem statement

### 3.1 Narrow measurement can conceal regressions

A change can reduce coverage in an unmeasured production module without affecting the CI percentage. This is especially concerning for:

- service-worker persistence and restart behavior;
- offscreen document lifecycle and protocol validation;
- TTS request timeouts, abort races, and bounded streaming;
- storage repair and failed-save behavior;
- voice discovery error classification;
- popup and Options asynchronous state machines; and
- Coqui queue, timeout, cleanup, and shutdown accounting.

### 3.2 Aggregate thresholds can hide weak critical files

Even after widening the include list, a large, heavily tested module can compensate numerically for a small but critical module with poor branch coverage. Global percentages alone are insufficient.

### 3.3 Browser E2E tests are necessary but not sufficient

Real Chromium tests validate integration behavior and browser APIs. They are intentionally slower and less granular than unit tests. A browser test can report that a scenario failed, but a focused unit test is usually better at identifying the exact state transition, stale callback, cleanup path, or error classification that regressed.

### 3.4 Human listening cannot be automated away

Coverage, unit tests, browser tests, and real-model validation cannot determine whether speech sounds overlapped, clipped, repeated, omitted, or unnaturally joined. Block 16 remains a separate human evidence gate.

---

## 4. Goals

### 4.1 Primary goals

- Measure all meaningful production TypeScript and TSX modules under `src/`.
- Permit exclusions only when they are explicit, narrow, and documented.
- Add tests for behaviorally important uncovered branches before raising thresholds.
- Add subsystem or per-file floors for critical runtime modules.
- Add Python statement and branch coverage for the Coqui service.
- Retain existing unit, integration, Chromium, real-Coqui, hygiene, secret-scan, and build gates.
- Produce CI artifacts that allow exact-SHA coverage inspection after the run.
- Make test failures deterministic and actionable.
- Keep test code focused on externally observable behavior and state invariants.

### 4.2 Secondary goals

- Reduce reliance on timing-sensitive browser tests for logic that can be tested deterministically.
- Make async cancellation, cleanup, and stale-result behavior explicit.
- Establish a repeatable process for adding production files without silently excluding them from coverage.
- Document why any file is excluded from coverage.

---

## 5. Non-goals

This effort does not:

- replace Block 16 human listening validation;
- claim that 100% coverage proves correctness;
- require snapshot tests for static markup;
- require tests for generated files or type-only declarations;
- require fragile tests that assert private implementation details without behavioral value;
- weaken real Chromium or real-Coqui gates;
- add silent retries that convert unverified failures into passes;
- permit flaky tests to be ignored or quarantined indefinitely;
- require mutation testing as a release gate in this phase; or
- change product behavior solely to make tests easier unless the refactor improves dependency isolation without weakening contracts.

---

## 6. Governing testing principles

### 6.1 Behavior over implementation

Tests should assert observable outcomes such as:

- protocol responses;
- terminal playback state;
- persisted status;
- visible UI errors;
- cleanup completion;
- resource bounds;
- queue accounting;
- object URL revocation;
- active-player invariants; and
- stable error codes.

Tests should avoid asserting incidental call order unless ordering is itself part of the correctness contract.

### 6.2 Fail closed

A test harness or coverage publisher must not classify an incomplete or malformed run as successful. Missing reports, unreadable reports, absent production files, and invalid coverage JSON must fail the gate.

### 6.3 Determinism before delay

Use controllable clocks, deferred promises, explicit signals, fake streams, and injected dependencies. Do not solve race tests by adding arbitrary sleeps.

### 6.4 One invariant, multiple layers

Critical invariants should be exercised at the most appropriate layers:

- unit tests for state-machine and error branches;
- integration tests for module boundaries;
- Chromium tests for real extension APIs and lifecycle behavior;
- real-Coqui tests for actual model/container behavior; and
- human listening for perceptual audio quality.

### 6.5 No percentage gaming

Do not add meaningless assertions, execute dead paths only to increase numbers, or exclude difficult files without a written justification.

---

## 7. TypeScript coverage surface

### 7.1 Default inclusion rule

Coverage must default to all production TypeScript and TSX under `src/`:

```text
src/**/*.{ts,tsx}
```

### 7.2 Required exclusions

The following categories may be excluded:

- `**/*.test.ts`
- `**/*.test.tsx`
- type declaration files such as `**/*.d.ts`
- generated code, if any, that is reproducibly generated and not hand-maintained

### 7.3 Conditional exclusions

Trivial bootstrap files may be excluded only if all of the following are true:

1. they contain no branching or business logic;
2. they only mount a component or import an entry module;
3. the exclusion is listed in `vitest.config.ts` with an adjacent explanation or in a dedicated coverage-policy document; and
4. their referenced runtime behavior is covered elsewhere.

Examples may include React root-mount files or pure manifest assembly, but no file is excluded merely because it is inconvenient to test.

### 7.4 Coverage-surface integrity test

Add a test or script that enumerates production `src/**/*.ts` and `src/**/*.tsx` files and verifies that every file is either:

- measured by the coverage include rules; or
- matched by an approved exclusion with a documented reason.

This guard must fail when a new production file is added outside the measured surface.

---

## 8. Threshold policy

### 8.1 Staged rollout

Widening the coverage surface may initially reduce aggregate percentages. Thresholds must be staged rather than lowered permanently or bypassed.

#### Stage A: measurement baseline

- Expand coverage to the intended production surface.
- Record exact per-file statement, branch, function, and line percentages.
- Do not reduce the existing six-file quality; their coverage must not regress.
- Establish temporary repository-wide floors based on the measured baseline.

#### Stage B: critical-gap closure

Add tests for high-risk uncovered branches and raise thresholds to at least:

```text
Global statements: 85%
Global lines:      85%
Global functions:  85%
Global branches:   75%
```

#### Stage C: subsystem floors

Critical files must have stronger minimums than generic UI/bootstrap code. Initial target floors:

```text
playback-coordinator.ts       branches >= 85%, lines >= 90%
service-worker.ts             branches >= 80%, lines >= 85%
offscreen.ts                  branches >= 80%, lines >= 85%
tts-client.ts                 branches >= 90%, lines >= 95%
storage.ts                    branches >= 90%, lines >= 95%
voices.ts                     branches >= 90%, lines >= 95%
playback-runtime-client.ts    branches >= 85%, lines >= 90%
Popup.tsx                      branches >= 75%, lines >= 85%
Options.tsx                    branches >= 75%, lines >= 85%
```

The exact implementation mechanism may use Vitest per-file thresholds, a post-processing script over `coverage-final.json`, or both. The selected mechanism must be deterministic and fail closed.

### 8.2 No uncovered-file loophole

Coverage must be configured with all-files behavior so a production file with zero imported lines cannot disappear from the report.

### 8.3 Threshold changes require evidence

Any future threshold reduction must include:

- the exact before/after values;
- affected files;
- justification;
- an issue or TODO for restoration; and
- a bounded expiration date or milestone.

Permanent threshold reduction for convenience is prohibited.

---

## 9. Required TypeScript test expansion

## 9.1 Playback coordinator

The coordinator owns the single-player invariant and requires the strongest deterministic coverage.

Add or confirm tests for:

- object URL creation failure;
- assigning `audio.src` failure where injectable/testable;
- assigning playback rate failure where injectable/testable;
- synchronous `audio.play()` throw;
- rejected `audio.play()` promise;
- media error event before and after play resolution;
- duplicate `ended` events;
- stale `ended`, error, and play-resolution callbacks from an older attempt;
- object URL revocation exactly once;
- cleanup failure at pause, source reset, load, or revoke stages;
- replacement after cleanup failure remaining fail closed;
- successful recovery after the cleanup dependency is repaired;
- fetch failure before audio is returned;
- fetch cancellation during replacement;
- stale prefetched audio arriving after replacement;
- pause during synthesis;
- pause during playback;
- pause during sentence and paragraph transition gaps;
- preservation of remaining gap duration across pause/resume;
- cancel while paused;
- replacement while paused;
- session supersession classification;
- no `activePlayerCount` leak after every terminal path;
- `maxActivePlayerCount <= 1` across every scenario;
- no invariant violation after expected failures; and
- diagnostic counters remaining internally consistent.

Every failure-path test must verify terminal state and cleanup, not only the returned error.

## 9.2 Background service worker

Add or confirm tests for:

- unsupported active pages;
- empty or malformed selection results;
- `executeScript()` rejection;
- settings read failure before start;
- offscreen creation failure;
- concurrent offscreen creation coalescing;
- offscreen readiness timeout;
- invalid offscreen start response;
- invalid offscreen control response;
- invalid offscreen status response;
- transport failure with no active session;
- transport failure with an active session;
- recreated offscreen document returning idle for an active persisted session;
- `chrome.storage.session.get()` rejection;
- `chrome.storage.session.set()` rejection;
- persistence-degraded status remaining observable;
- stale status rejection across session replacement;
- same-session sequence monotonicity;
- serialized writes preventing older state from overwriting terminal state;
- command routing for Pause, Resume, and Cancel;
- command-routing errors not becoming unhandled rejections;
- context-menu setup and click routing;
- readiness probe invalid URL;
- readiness probe HTTP failure;
- readiness probe network failure;
- readiness probe timeout; and
- diagnostics startup timeout and recovery.

## 9.3 Offscreen runtime adapter

Add or confirm tests for:

- strict protocol validation for start, control, status, and diagnostic messages;
- malformed messages receiving stable invalid-request errors;
- coordinator events forwarding once;
- stale coordinator events not replacing newer status;
- diagnostic snapshots forwarding only valid structures;
- runtime listener behavior when coordinator methods reject;
- initialization failure classification;
- teardown behavior; and
- no direct fallback audio player outside the coordinator.

## 9.4 TTS client

Add or confirm tests for:

- malformed URL;
- non-HTTP(S) URL;
- forbidden host-play endpoint;
- invalid `maxResponseBytes` values, including zero, negatives, fractions, `NaN`, and infinities;
- invalid timeout values, including zero, negatives, `NaN`, and infinities;
- already-aborted external signal;
- external cancellation before headers;
- timeout before headers;
- network failure before headers;
- non-2xx status;
- missing or non-audio MIME;
- declared oversize body;
- malformed, negative, nonnumeric, and fractional `Content-Length`;
- no `Content-Length`;
- false low `Content-Length`;
- chunked response exactly at the cap;
- chunked response above the cap;
- zero-length chunks followed by valid chunks;
- empty completed response;
- stream reader `read()` rejection;
- timeout during body read;
- cancellation during body read;
- reader cancellation failure;
- reader lock release after terminal paths;
- timer and abort-listener cleanup; and
- race precedence between external cancellation and timeout.

## 9.5 Storage and settings

Add or confirm tests for:

- empty storage defaults;
- malformed top-level storage result;
- legacy nested settings;
- precedence of per-key values over legacy object values;
- invalid strings, arrays, objects, `NaN`, infinities, negative values, and huge values;
- URL protocol validation;
- host-play URL migration with query strings and trailing slashes;
- nonmatching paths not being migrated;
- repair writes containing only changed keys;
- repair-write rejection;
- read rejection;
- empty update avoiding a write;
- partial concurrent saves;
- failed save propagation;
- preservation of the last valid persisted value after UI validation failure; and
- no path that can pass a non-finite rate to UI formatting.

## 9.6 Voice discovery and endpoint derivation

Add or confirm tests for:

- `/api/tts`, `/api/tts/`, nested prefixes, query strings, and fragments;
- invalid endpoints;
- valid empty voice list;
- duplicate and whitespace-only voices;
- malformed JSON;
- malformed schema;
- HTTP failure with status preservation;
- network failure;
- timeout;
- timer cleanup;
- currently configured voice preservation after discovery failure; and
- stale discovery response not overwriting a newer request.

## 9.7 Playback runtime client and messaging

Add or confirm tests for:

- runtime callback success and failure;
- `chrome.runtime.lastError` handling;
- promise-style and callback-style API compatibility where supported;
- malformed responses;
- event subscription and unsubscription;
- late events after unsubscribe;
- stale-session event filtering;
- request-ID and session-ID correlation; and
- no unhandled rejection when the receiver disappears.

## 9.8 Popup and Options

Tests should prioritize state behavior over static snapshots.

Add or confirm tests for:

- initial settings load success and failure;
- repaired-settings warning display;
- dirty-state tracking;
- failed save retaining dirty state;
- visible save error;
- successful retry after failure;
- invalid URL draft never being persisted;
- invalid URL draft not triggering voice discovery;
- local-default action using the same validation/save path;
- voice discovery success, valid-empty result, timeout, network failure, HTTP failure, invalid JSON, and invalid schema;
- configured voice preservation after discovery failure;
- stale voice response after endpoint change;
- probe success, failure, and timeout;
- start request pending state;
- start rejection;
- stale start response after a newer start;
- explicit supersession;
- missed-event recovery through status query;
- Pause, Resume, and Cancel success and failure;
- stale playback event from an older session;
- component unmount while save, discovery, probe, or playback request is pending; and
- no state update or unhandled rejection after unmount.

---

## 10. Python Coqui coverage

### 10.1 Measurement

Add `pytest-cov` to the test requirements and run the service tests with branch coverage, for example:

```bash
python -m pytest \
  --cov=docker/coqui-local \
  --cov-config=.coveragerc \
  --cov-branch \
  --cov-report=term-missing \
  --cov-report=xml:reports/coqui-coverage.xml \
  --cov-report=json:reports/coqui-coverage.json \
  --junitxml=reports/coqui-junit.xml \
  docker/coqui-local/tests
```

The exact import target may need to use the package/module name rather than a file path. The final command must work from the repository root in CI.

### 10.2 Initial thresholds

After recording the widened baseline, enforce at least:

```text
Python statements: 85%
Python branches:   75%
```

Raise the floors after critical gaps are closed. Do not omit branch coverage.

### 10.3 Required Coqui tests

Add or confirm tests for:

- every invalid environment variable type and bound;
- forced voice trimming and deduplication;
- discovery from dictionaries, lists, tuples, sets, and alternate backend attributes;
- backend with no discoverable voices;
- startup model-loader failure;
- readiness and voices before model readiness;
- default voice selection;
- invalid voice rejection before queue use;
- zero-byte backend output;
- missing backend output;
- backend exception;
- queue-full behavior;
- model inference never overlapping;
- timeout remaining visible until underlying work finishes;
- cancelled queued futures;
- executor submission failure;
- temporary-file creation failure;
- descriptor close failure;
- cleanup failure tracking and retry;
- cleanup requested while a path is active;
- shutdown with active work;
- shutdown with queued but not started work;
- slot, queued-future, active-inference, and timed-out-future accounting invariants;
- malformed JSON request;
- wrong field types;
- stable generic unexpected-error envelope;
- absence of removed host-play and debug endpoints; and
- no leakage of filesystem paths or backend exception text to clients.

---

## 11. CI and artifact requirements

### 11.1 TypeScript reports

CI must publish, at minimum:

- `coverage/coverage-final.json`
- an HTML coverage report archive
- JUnit XML
- a machine-readable coverage summary

### 11.2 Python reports

CI must publish, at minimum:

- `reports/coqui-coverage.xml`
- `reports/coqui-coverage.json`
- Python JUnit XML if configured

### 11.3 Artifact identity

Artifact names must include the GitHub run ID. Rerun attempts must remain distinguishable through artifact ID, attempt metadata, or explicit attempt suffixes.

### 11.4 Coverage status summary

The CI log or durable status publisher must report:

- exact head SHA;
- run ID and attempt;
- TypeScript global percentages;
- Python global percentages;
- critical-file threshold failures;
- missing-file or malformed-report failures; and
- artifact IDs when available.

### 11.5 Codecov

Codecov may remain a reporting destination, but local CI thresholds are authoritative. A Codecov service outage must follow the existing explicit CI policy; it must not replace local enforcement.

---

## 12. Flakiness and retry policy

- Unit tests must not receive automatic retries by default.
- A failed unit test is a failure until its cause is understood.
- Browser-harness retries are allowed only for narrowly classified infrastructure cleanup races and must remain fail closed.
- Product assertions must not be retried into success without preserving the failed attempt as evidence.
- Timing-sensitive tests must use bounded waits and include the last observed state in failure output.
- Any recurring intermittent failure must receive a tracked root-cause task; repeated reruns are not an acceptable steady-state workflow.

---

## 13. Test maintainability requirements

- Shared Chrome mocks should live in reusable test helpers when duplication becomes material.
- Deferred-promise and controllable-stream helpers should be reusable and typed.
- Tests must restore globals, timers, event listeners, and mocks after each case.
- Every test must leave no pending timers, open readers, unresolved promises, object URLs, or active fake audio player unless the test explicitly verifies a leak detector.
- Test names must describe behavior and expected outcome.
- Avoid broad `as any` casts when a narrow test type can express the required API.
- Production-only test hooks must be minimal, namespaced, and unavailable in production builds where practical.

---

## 14. Security and privacy requirements

Coverage hardening must preserve existing security controls:

- no credentials, tokens, or local paths in committed reports;
- no TTS text payloads containing sensitive user data in durable CI logs;
- no raw secret-match output from history scans;
- no reintroduction of host audio playback or debug endpoints;
- no weakening of loopback-only container publication;
- no unpinned GitHub Actions; and
- no coverage upload containing files outside the intended repository source surface.

---

## 15. Relationship to Block 16 listening validation

This project is independent from, and cannot complete, Block 16.

Coverage hardening can prove that:

- only one player is active;
- state transitions are serialized;
- cleanup occurs;
- sentence and paragraph pacing calculations are correct;
- real browser and real model workflows complete; and
- errors are classified and visible.

It cannot prove that a human listener hears:

- no sentence collision;
- no clipped starts or endings;
- no omitted or duplicated words;
- natural sentence seams;
- appropriate paragraph pauses; or
- acceptable output at rates `0.5`, `1`, `2`, `4`, and `10`.

Block 16 must remain open until the required human listening matrix is executed and recorded.

---

## 16. Implementation sequence

The implementation must proceed in this order:

1. Record the current baseline and coverage surface.
2. Expand TypeScript coverage measurement with explicit exclusions.
3. Add the coverage-surface integrity guard.
4. Inspect the widened report before selecting tests.
5. Add coordinator failure and cleanup tests.
6. Add service-worker and offscreen lifecycle tests.
7. Add TTS, storage, voices, endpoint, and runtime-client branch tests.
8. Add Popup and Options async-state tests.
9. Add Python statement and branch coverage.
10. Add missing Coqui runtime tests.
11. Enforce global and critical-file floors.
12. Publish durable reports and exact-SHA evidence.
13. Run full CI and real-Coqui validation on the resulting exact SHA.
14. Update documentation without claiming Block 16 completion.

Do not begin by raising thresholds against the old six-file surface. Measurement expansion must happen first.

---

## 17. Required validation commands

At minimum, local and hosted validation must include:

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
python -m pytest -q docker/coqui-local/tests
```

After Python coverage is added, the plain Python test command must be replaced or supplemented by the authoritative branch-coverage command.

The final hosted validation must also include:

- Compose security-default validation;
- coverage artifact upload;
- JUnit artifact upload;
- Chromium diagnostic artifact upload;
- exact-SHA real-Coqui validation; and
- durable status publication.

---

## 18. Acceptance criteria

This specification is complete only when all of the following are true:

### Coverage architecture

- All meaningful production TypeScript/TSX files are included by default.
- Every exclusion is explicit and justified.
- A guard fails when a new production file is neither covered nor approved for exclusion.
- All-files behavior prevents zero-import files from disappearing.

### TypeScript tests

- Critical coordinator failure and cleanup paths have deterministic tests.
- Service-worker persistence degradation and offscreen failures have deterministic tests.
- TTS abort, timeout, stream, and validation branches are covered.
- Storage repair and failed-write branches are covered.
- Voice discovery error categories are covered.
- Popup and Options async stale-result and retry behavior are covered.

### Python tests

- Python statement and branch coverage are measured.
- Queue, timeout, cleanup, shutdown, startup, and zero-byte-output branches are covered.
- Python thresholds pass without exclusions that hide production logic.

### Thresholds

- Global TypeScript thresholds meet or exceed Stage B targets.
- Critical files meet their subsystem floors or have a documented, bounded restoration task.
- Python thresholds meet or exceed the initial targets.

### CI evidence

- All reports are generated and uploaded.
- Missing or malformed reports fail CI.
- Hosted CI succeeds on the exact final SHA.
- Real-Coqui validation succeeds on the same exact SHA.
- Artifact IDs and digests are recorded.

### Documentation truthfulness

- The implementation report states the measured scope accurately.
- No document describes the old six-file percentage as repository-wide coverage.
- Block 16 remains incomplete unless separate human listening evidence exists.

---

## 19. Completion definition

The test-coverage hardening project may be marked complete when:

1. every TODO item in the companion file is resolved or explicitly deferred with justification;
2. all acceptance criteria in this specification are satisfied;
3. final hosted CI and real-Coqui validation are green on one exact SHA;
4. the coverage artifacts are inspectable and internally consistent; and
5. documentation accurately distinguishes automated coverage completion from human listening completion.

Until then, the project status is `PARTIAL`.