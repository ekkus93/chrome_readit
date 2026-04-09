# CS_CODE_REVIEW1_TODO.md

## Goal

Address every issue identified in `docs/CS_CODE_REVIEW1.md`, with priority on eliminating the remaining paragraph-boundary stumble, removing duplicate playback paths, and tightening playback/session correctness across the MV3 extension.

This TODO is intended to guide implementation work in small, testable phases.

---

# Phase 1 — Eliminate remaining chunk-boundary stumble

**Status:** Done

## Task 1.1 — Add an explicit inter-chunk handoff gap in the background queue

**Status:** Done

### Subtasks
- [x] Update `processChunksSequentially()` in `src/background/service-worker.ts` so the next chunk is not sent immediately after a successful playback acknowledgement.
- [x] Add a small post-ack delay after `const ack = await ackPromise` and before the loop advances to the next chunk.
- [x] Keep the delay small enough to avoid sluggish playback while still allowing output buffers to drain.
- [x] Ensure the delay is skipped or exited early if the session becomes stale, cancelled, or paused during the wait.

### Acceptance criteria
- Playback no longer feels like the first sentence of the next paragraph is starting on top of the last sentence of the previous paragraph.
- Chunk sequencing still remains strictly one-at-a-time.
- Cancellation during the handoff delay does not allow the next chunk to start.

---

## Task 1.2 — Make paragraph-boundary pacing explicit and configurable in code

**Status:** Done

### Subtasks
- [x] Review `splitTextIntoChunks()` and identify where paragraph boundaries are already implied by newline splitting.
- [x] Decide whether the queue should use one fixed gap for all chunks or a longer gap for paragraph boundaries.
- [x] If paragraph-aware pacing is added, encode the boundary information in a way the queue can consume cleanly instead of guessing later.
- [x] Keep the implementation simple and deterministic; do not create a second timing system outside the background queue.

### Acceptance criteria
- Paragraph transitions sound more natural than sentence-only transitions.
- Any boundary-aware pause logic is derived from chunk metadata, not fragile string re-parsing in multiple places.

---

## Task 1.3 — Cover handoff timing with tests

**Status:** Done

### Subtasks
- [x] Add or update background tests to prove that chunk N+1 is not dispatched before chunk N acknowledgement plus the configured delay.
- [x] Add a test that cancellation during the delay prevents the next chunk from being sent.
- [x] Keep tests deterministic by controlling timers or stubbing the delay path.

### Acceptance criteria
- Automated tests fail if the queue regresses back to zero-gap handoff.
- Automated tests verify cancellation and latest-session behavior still work with the new delay.

---

# Phase 2 — Remove duplicate and conflicting playback paths

**Status:** Done

## Task 2.1 — Remove content-script playback forwarding from `test-tts`

**Status:** Done

### Subtasks
- [x] Update the `test-tts` handler in `src/background/service-worker.ts` so it no longer forwards `PLAY_AUDIO` to the active tab.
- [x] Keep the handler focused on fetching audio bytes and returning them to the caller.
- [x] Verify popup/options test playback still work through the returned audio payload only.
- [x] Ensure this path does not interfere with an active reading session beyond whatever the popup itself intentionally does locally.

### Acceptance criteria
- Pressing the test-speech control results in exactly one audible playback path.
- `test-tts` no longer triggers in-tab playback as a side effect.

---

## Task 2.2 — Remove redundant content-side `playback.stop()` before new chunk playback

**Status:** Done

### Subtasks
- [x] Remove the explicit `playback.stop()` call from the `PLAY_AUDIO` handler in `src/content/content.ts`.
- [x] Rely on `PlaybackController.playBase64()` / `playArrayBuffer()` calling `playUint8Array()`, which already calls `this.stop()`.
- [x] Verify the removal does not break session invalidation or stale-completion protection.

### Acceptance criteria
- Starting a new chunk still stops the previous playback cleanly.
- Playback token increments happen only in the controller, not redundantly in the message handler.

---

## Task 2.3 — Re-check popup and options playback expectations

**Status:** Done

### Subtasks
- [x] Inspect popup/options code paths that invoke `request-tts` or `test-tts`.
- [x] Confirm they expect returned audio bytes and do not depend on background-driven tab playback.
- [x] Update any affected tests so the contract is explicit: test playback is local to the extension UI, not the content script.

### Acceptance criteria
- UI test-play behavior matches the intended contract.
- No extension UI assumes that `test-tts` causes audio to play in the page context.

---

# Phase 3 — Harden `PlaybackController` lifecycle correctness

**Status:** Pending

## Task 3.1 — Fix the stale-token WebAudio Promise leak

**Status:** Pending

### Subtasks
- [ ] Update `playViaWebAudio()` in `src/content/playback.ts` so stale-token completion resolves the Promise instead of returning without resolution.
- [ ] Preserve cleanup behavior for the WebAudio source and context in both stale and normal completion paths.
- [ ] Ensure the stale-resolution result is compatible with the outer `finish()` logic and does not accidentally report success.

### Acceptance criteria
- A stopped or superseded WebAudio fallback cannot leave a hanging Promise behind.
- Fallback completion for stale playback resolves as a non-success state.

---

## Task 3.2 — Expand lifecycle tests around fallback and stop behavior

**Status:** Pending

### Subtasks
- [ ] Add or update tests in `src/content/playback.test.ts` for the stale WebAudio completion path.
- [ ] Verify `stop()` resolves the active play Promise in all supported playback modes.
- [ ] Confirm repeated stop/replace cycles do not leak unresolved operations.

### Acceptance criteria
- Playback controller tests cover HTMLAudio success, WebAudio fallback success, stale fallback completion, and explicit stop behavior.

---

# Phase 4 — Harden background session and acknowledgement handling

**Status:** Pending

## Task 4.1 — Reuse a single active-tab reference in `sendToActiveTabOrInject`

**Status:** Pending

### Subtasks
- [ ] Refactor `sendToActiveTabOrInject()` so `READ_SELECTION` captures the active playback tab once and reuses it for both selection capture and session creation.
- [ ] Keep the supported-page validation in the shared path rather than duplicating it.
- [ ] Ensure `READ_TEXT` still works without unnecessary tab lookups.

### Acceptance criteria
- Selection text and playback session always target the same tab instance for a given read request.
- A user switching tabs mid-flow cannot pair text from one tab with playback in another.

---

## Task 4.2 — Make `waitForPlaybackAck()` recover instead of throw

**Status:** Pending

### Subtasks
- [ ] Replace the hard throw when `pendingPlaybackAck` already exists with a controlled recovery path.
- [ ] Decide on the recovery policy: resolve the older ack as cancelled/stale, log a warning, and register the new ack.
- [ ] Ensure the recovery behavior is compatible with cancellation and latest-session rules.
- [ ] Keep the failure mode visible in logs rather than silently swallowing the situation.

### Acceptance criteria
- Unexpected ack overlap no longer crashes the queue via a thrown exception.
- The queue either recovers cleanly or fails explicitly without leaving dangling state.

---

## Task 4.3 — Add coverage for ack overlap and recovery behavior

**Status:** Pending

### Subtasks
- [ ] Add or update tests in background/session/bootstrap coverage to simulate a second ack registration while one is still pending.
- [ ] Verify the old pending ack is resolved deterministically.
- [ ] Verify the queue remains cancellable and does not leave `pendingPlaybackAck` stuck.

### Acceptance criteria
- Background tests prove the ack state machine is self-healing rather than exception-driven.

---

# Phase 5 — Normalize message contracts and types

**Status:** Pending

## Task 5.1 — Extend the `PLAY_AUDIO` message type

**Status:** Pending

### Subtasks
- [ ] Update `src/lib/messaging.ts` so the `PLAY_AUDIO` variant includes the fields actually sent at runtime, including `rate` and `playbackToken`.
- [ ] Update `isPlayAudio()` and related type guards if needed so the runtime checks still reflect the contract correctly.
- [ ] Remove unnecessary `Record<string, unknown>` casts at call sites that only exist because the type is incomplete.

### Acceptance criteria
- Message producers and consumers share one accurate `PLAY_AUDIO` contract.
- TypeScript can access `rate` and `playbackToken` without ad hoc casts in the normal path.

---

## Task 5.2 — Standardize control-message naming

**Status:** Pending

### Subtasks
- [ ] Choose the canonical control message shape for pause, resume, cancel, and status requests.
- [ ] Update runtime handlers, popup callers, options callers, and any tests to use the canonical form consistently.
- [ ] Remove legacy alias branches once all callers are migrated.
- [ ] Keep any externally visible message names consistent with existing MV3 extension architecture.

### Acceptance criteria
- The codebase no longer mixes `action: 'pause-speech'` and `kind: 'PAUSE_SPEECH'` style conventions for the same control surface.
- Runtime handlers are simpler and no longer carry compatibility branches for internal callers.

---

## Task 5.3 — Verify cross-context message compatibility after normalization

**Status:** Pending

### Subtasks
- [ ] Audit popup, options, background, and content modules for message construction and handling.
- [ ] Update tests that assert message shapes.
- [ ] Confirm no manifest or MV3 context requires a compatibility shim for old internal message names.

### Acceptance criteria
- All extension contexts agree on the same message schema.
- No internal caller depends on a removed alias.

---

# Phase 6 — Reduce production noise and keep diagnostics intentional

**Status:** Pending

## Task 6.1 — Disable hardcoded debug logging in production paths

**Status:** Pending

### Subtasks
- [ ] Change the hardcoded `DEBUG = true` flags in `src/content/content.ts` and `src/background/service-worker.ts`.
- [ ] Decide whether to use `false` or an environment-aware flag already compatible with the build.
- [ ] Keep operational warnings intact; only reduce noisy debug diagnostics.

### Acceptance criteria
- Normal users do not get verbose playback diagnostics by default.
- Useful warning/error logs remain available for real failures.

---

## Task 6.2 — Re-evaluate diagnostic comments and temporary logging

**Status:** Pending

### Subtasks
- [ ] Review nearby playback-debug comments added during overlap investigation.
- [ ] Remove or tighten comments that are only useful for short-term debugging.
- [ ] Preserve comments that explain non-obvious architecture or lifecycle behavior.

### Acceptance criteria
- The code remains understandable without carrying stale “temporary diagnostics” intent indefinitely.

---

# Phase 7 — Final validation and regression coverage

**Status:** Pending

## Task 7.1 — Update automated tests for all review-driven fixes

**Status:** Pending

### Subtasks
- [ ] Update or add tests covering queue handoff delay, `test-tts` single-play behavior, stale WebAudio resolution, tab reuse, ack recovery, and message typing assumptions.
- [ ] Keep tests focused on production behavior rather than implementation trivia.
- [ ] Reuse existing test files and patterns where possible.

### Acceptance criteria
- The affected regression areas are all represented in automated coverage.

---

## Task 7.2 — Manual playback QA for the overlap/stumble path

**Status:** Pending

### Subtasks
- [ ] Verify reading across multiple paragraphs no longer produces audible overlap.
- [ ] Verify there is no accidental long dead air between ordinary chunks.
- [ ] Verify starting a new read interrupts the old one cleanly.
- [ ] Verify popup/options test speech produce exactly one playback source.
- [ ] Verify pause, resume, and cancel still work after message normalization.

### Acceptance criteria
- Real extension behavior matches the intended one-chunk-at-a-time contract in Chrome.

---

## Task 7.3 — Run repo validation before closing the review TODO

**Status:** Pending

### Subtasks
- [ ] Run `npm run lint`.
- [ ] Run `npm run test`.
- [ ] Fix any resulting issues rather than suppressing warnings or weakening behavior.

### Acceptance criteria
- Lint passes cleanly.
- Tests pass cleanly.
- The review-fix branch is in a releasable state.
