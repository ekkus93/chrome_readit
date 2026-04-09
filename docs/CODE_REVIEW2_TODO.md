# CODE_REVIEW2_TODO.md

## Goal

Address the issues identified in `CODE_REVIEW2.md`, with highest priority on:

1. eliminating the overlapping / rough paragraph-transition playback bug
2. restoring trust in the automated test suite
3. fixing settings persistence correctness
4. cleaning up playback/resource lifecycle issues

This TODO is written to be implementation-ready for GitHub Copilot.

---

# Phase 0 — Reproduce and instrument the reported overlap bug

## Task 0.1 — Create a deterministic reproduction harness for paragraph-boundary playback

### Subtasks
- [x] Add a dedicated test fixture text containing multiple paragraphs with clearly separated sentence endings.
- [x] Ensure at least one fixture forces chunk boundaries near paragraph boundaries.
- [x] Add a small manual-debug mode that logs chunk index, paragraph index, playback token, and selected gap duration.
- [x] Make it easy to reproduce the issue from popup/options or a dev test page without relying on arbitrary page content.

### Acceptance criteria
- [x] There is a repeatable way to trigger paragraph-to-paragraph transitions.
- [x] Logs clearly show when chunk N starts, when it finishes, and when chunk N+1 starts.
- [x] Developers can tell whether the issue is true overlap, too-short handoff, or both.

---

## Task 0.2 — Add temporary instrumentation around playback fallback decisions

### Subtasks
- [x] Instrument `PlaybackController` so development builds can log when HTMLAudio starts, errors, ends, and when WebAudio fallback starts.
- [x] Include the active playback token in those logs.
- [x] Log whether the HTMLAudio element was explicitly paused/detached before fallback.
- [x] Keep the instrumentation behind a development/debug gate so production logging stays quiet.

### Acceptance criteria
- [x] The logs can prove whether HTMLAudio and WebAudio ever overlap for the same chunk.
- [x] Production builds are not noisy.

---

# Phase 1 — Fix the most likely overlapping playback bug in `PlaybackController`

## Task 1.1 — Make HTMLAudio -> WebAudio fallback fully exclusive

**Primary file:** `src/content/playback.ts`

### Subtasks
- [x] Refactor `tryWebAudioFallback()` so it explicitly stops and detaches the current `Audio` element before starting fallback playback.
- [x] Remove or neutralize event listeners from the HTMLAudio element once fallback begins.
- [x] Ensure `this.currentAudio` is not merely nulled; the underlying audio element must be made incapable of continuing audible playback.
- [x] Preserve stale-token protection so fallback does not start for superseded playback.
- [x] Keep the fallback-start path idempotent so duplicate `error`/`play().catch()` triggers cannot start two fallback paths.

### Acceptance criteria
- [x] For a single chunk, there is never a state where HTMLAudio and WebAudio can both be audible.
- [x] Repeated `error` / rejected-play events cannot start duplicate fallback playback.
- [x] Existing playback-controller tests still pass after the refactor.

---

## Task 1.2 — Clean up object URL lifecycle on stop/cancel

**Primary file:** `src/content/playback.ts`

### Subtasks
- [x] Track the currently active object URL explicitly on the controller instance.
- [x] Revoke that object URL when playback stops, is cancelled, is superseded, or finishes.
- [x] Ensure revocation happens exactly once per URL.
- [x] Avoid revoking the same URL in competing code paths without guard logic.

### Acceptance criteria
- [x] No object URL remains live after `stop()` or normal completion.
- [x] Stopping playback repeatedly does not throw and does not double-revoke incorrectly.

---

## Task 1.3 — Add playback-controller regression tests for overlap/fallback behavior

**Primary file:** `src/content/playback.test.ts`

### Subtasks
- [x] Add a test where HTMLAudio triggers an `error` after playback has begun and verify fallback does not create concurrent playback.
- [x] Add a test that verifies the previous HTMLAudio element is paused/detached before WebAudio fallback starts.
- [x] Add a test that verifies object URLs are revoked on stop.
- [x] Add a test for repeated fallback trigger attempts (`error` event plus rejected `play()` promise) to prove idempotence.

### Acceptance criteria
- [x] The overlap/fallback edge case is covered by automated tests.
- [x] The tests fail if fallback can start without shutting down HTMLAudio.

---

# Phase 2 — Make paragraph handling explicit and deterministic

## Task 2.1 — Refactor chunking to be paragraph-first instead of separator-heuristic-first

**Primary file:** `src/background/service-worker.ts`

### Subtasks
- [x] Split source text into paragraph units first, using blank-line boundaries as the canonical paragraph separator.
- [x] Preserve paragraph identity in the intermediate representation.
- [x] Within each paragraph, split into chunks using sentence/whitespace heuristics only as a secondary step.
- [x] Return chunk metadata that explicitly records whether the next transition is intra-paragraph or inter-paragraph.

### Acceptance criteria
- [x] Paragraph boundaries are represented explicitly, not inferred later from separator slices.
- [x] Paragraph gap behavior does not depend on where an arbitrary max-length cut happened.

---

## Task 2.2 — Make gap handling consume explicit chunk metadata

**Primary file:** `src/background/service-worker.ts`

### Subtasks
- [x] Replace the current “guess paragraph gap from separator context” logic with explicit metadata such as `transitionAfter: 'sentence' | 'paragraph' | 'end'`.
- [x] Keep default and paragraph gap durations centralized and easy to tune.
- [x] Ensure the queue waits on the correct gap after each chunk.
- [x] Confirm pause/cancel behavior still works while the queue is waiting in a gap.

### Acceptance criteria
- [x] Paragraph transitions use a reliably longer pause than intra-paragraph transitions.
- [x] Pause/cancel/latest-session logic remains correct during gap waits.

---

## Task 2.3 — Add background tests for paragraph-aware chunking and pacing

**Primary files:**
- `src/background/splitting.integration.test.ts`
- `src/background/bootstrap-sequencing.test.ts`
- or new dedicated tests if cleaner

### Subtasks
- [x] Add tests that verify paragraph boundaries are preserved in the chunk metadata.
- [x] Add tests that verify paragraph transitions produce the paragraph gap, not the default gap.
- [x] Add tests where chunk boundaries happen near paragraph boundaries.
- [x] Add tests for cancellation during a paragraph gap.

### Acceptance criteria
- [x] Paragraph-aware pacing is covered by tests.
- [x] Future refactors cannot silently regress paragraph transitions.

---

# Phase 3 — Simplify and harden playback acknowledgement semantics

## Task 3.1 — Decide which completion path is authoritative

**Primary files:**
- `src/background/service-worker.ts`
- `src/content/content.ts`

### Subtasks
- [x] Review the current dual completion model: direct `sendResponse` result plus `PLAYBACK_FINISHED` message.
- [x] Choose one path as the authoritative completion signal for queue advancement.
- [x] Keep the second path only if it has a clearly different role, such as diagnostics or compatibility fallback.
- [x] Remove unnecessary duplication if it does not provide meaningful resilience.

### Acceptance criteria
- [x] The background queue has one clear completion contract.
- [x] The code is easier to reason about during playback races.

---

## Task 3.2 — Add explicit tests for completion ordering and stale-token behavior

### Subtasks
- [x] Add a test where completion arrives via the chosen authoritative path only.
- [x] Add a test for stale completion arriving after a newer chunk/session started.
- [x] Add a test proving the queue does not advance on non-authoritative completion if a backup path remains.
- [x] Add a test for cancellation while a completion signal is pending.

### Acceptance criteria
- [x] Completion handling is deterministic under stale, cancelled, and reordered events.

---

# Phase 4 — Fix settings persistence correctness and write volume

## Task 4.1 — Debounce or batch settings writes from the UI

**Primary files:**
- `src/options/Options.tsx`
- `src/popup/Popup.tsx`

### Subtasks
- [x] Stop writing to `chrome.storage.sync` on every slider tick.
- [x] Debounce rate persistence or commit on interaction end (`pointerup`, `blur`, or equivalent controlled debounce).
- [x] Avoid unnecessary writes when a value has not actually changed.
- [x] Keep the UI state responsive even if persistence is delayed slightly.

### Acceptance criteria
- [x] Moving the rate slider no longer spams storage writes.
- [x] Voice and URL changes persist reliably without unnecessary duplicate writes.

---

## Task 4.2 — Eliminate lost-update races in `saveSettings`

**Primary file:** `src/lib/storage.ts`

### Subtasks
- [x] Redesign settings persistence so concurrent partial updates from popup/options cannot overwrite one another using stale state.
- [x] Decide on one of these strategies and implement it consistently:
  - [x] separate storage keys per setting
  - [ ] a serialized in-extension write queue
  - [ ] a single authoritative settings owner/context
- [x] Update callers to match the new persistence model.
- [x] Ensure the background/content rate listeners still work with the updated storage shape.

### Acceptance criteria
- [x] Concurrent changes to different settings do not lose each other.
- [x] Tests can prove the lost-update scenario is fixed.

---

## Task 4.3 — Add tests for storage write behavior

**Primary files:**
- `src/lib/storage.test.ts`
- relevant popup/options tests

### Subtasks
- [x] Add a test simulating concurrent partial saves from two contexts.
- [x] Add tests for debounced or batched write behavior.
- [x] Add tests ensuring settings listeners still receive final values correctly.

### Acceptance criteria
- [x] Storage races are covered by automated tests.

---

# Phase 5 — Fix URL/path correctness for voice discovery

## Task 5.1 — Make voice endpoint derivation configurable and path-safe

**Primary file:** `src/lib/voices.ts`

### Subtasks
- [x] Replace the unconditional `url.pathname = '/api/voices'` rewrite with a safer endpoint derivation strategy.
- [x] Decide how the voice endpoint should relate to `ttsUrl`:
  - [ ] same origin + fixed configurable path
  - [x] derived sibling path relative to the configured endpoint
  - [ ] separately configurable `voicesUrl`
- [x] Update popup/options callers if the API contract changes.
- [x] Handle mounted subpaths and reverse-proxy prefixes correctly.

### Acceptance criteria
- [x] Voice discovery works when the TTS API is not mounted at origin root.
- [x] The behavior is explicit and documented in code.

---

## Task 5.2 — Add tests for voice URL derivation

### Subtasks
- [x] Add tests for root-mounted endpoints.
- [x] Add tests for prefixed endpoints such as `/tts/api/tts`.
- [x] Add tests for invalid/malformed URLs.

### Acceptance criteria
- [x] Voice URL generation is covered and future-safe.

---

# Phase 6 — Improve user-visible failure handling

## Task 6.1 — Stop silent no-op failures in the read pipeline

**Primary file:** `src/background/service-worker.ts`

### Subtasks
- [x] Identify all early-return cases in `sendToActiveTabOrInject()`.
- [x] Return structured failure results for cases such as:
  - [x] no active supported tab
  - [x] no selected text
  - [x] missing `ttsUrl`
  - [x] selection capture failure
  - [x] playback bridge injection failure
- [x] Update popup/options callers to display actionable messages.
- [x] Keep logs clear enough for debugging.

### Acceptance criteria
- [x] The user is told why nothing happened when the action fails.
- [x] Early returns no longer silently swallow actionable errors.

---

## Task 6.2 — Add UI coverage for common failure states

### Subtasks
- [x] Add popup/options tests for missing selection, missing TTS URL, and unsupported page behavior.
- [x] Ensure the UI error copy is brief and useful.

### Acceptance criteria
- [x] Common failure modes are visible and test-covered.

---

# Phase 7 — Stabilize the automated test suite

## Task 7.1 — Investigate and fix the hanging test suite

**Observed finding:** `npm test` did not complete in my local run after `npm ci`, and `src/background/bootstrap-sequencing.test.ts` also failed to complete within a timeout.

### Subtasks
- [x] Reproduce the hanging suite locally after a clean install.
- [x] Determine whether the hang is caused by:
  - [x] unresolved Promises
  - [x] open timers
  - [x] dangling listeners
  - [x] a specific background playback test
- [x] Start with `src/background/bootstrap-sequencing.test.ts` and trace why the run does not complete.
- [x] Add cleanup for any global timers/listeners/state introduced by tests or imported modules.
- [x] Ensure test modules reset `globalThis` overrides and mocks cleanly.

### Acceptance criteria
- [x] `npm test` completes successfully without manual intervention.
- [x] No individual test file requires an external timeout to terminate.

---

## Task 7.2 — Add explicit cleanup utilities for playback/background tests

### Subtasks
- [x] Create reusable test helpers for resetting global chunk timeout/gap overrides.
- [x] Reset any pending playback ack state between tests.
- [x] Ensure imported service-worker modules do not leave timers or pending work alive across tests.
- [x] Use `afterEach` cleanup where appropriate.

### Acceptance criteria
- [x] Tests are isolated and do not leak state into one another.

---

# Phase 8 — Tighten manifest scope if product requirements allow

## Task 8.1 — Revisit `<all_urls>` permissions and always-on content injection **(Blocked: requires explicit permission-change confirmation)**

**Primary file:** `src/manifest.ts`

### Subtasks
- [ ] Confirm which host permissions are truly required for the extension’s intended UX.
- [ ] Decide whether the content script really needs to be declared for all URLs or whether more on-demand injection is sufficient.
- [ ] Narrow host permissions and `matches` patterns if feasible.
- [ ] Verify reading selected text and control flows still work on supported pages.

### Acceptance criteria
- [ ] Permissions are no broader than necessary.
- [ ] Any reduction in scope does not break core functionality.

---

# Phase 9 — Nice-to-have cleanup work

## Task 9.1 — Add abort support for in-flight TTS fetches

**Primary file:** `src/background/service-worker.ts`

### Subtasks
- [x] Introduce `AbortController` support for TTS fetches.
- [x] Abort in-flight current/prefetch fetches when a session is cancelled or superseded.
- [x] Ensure aborted fetches do not log noisy errors that look like unexpected failures.

### Acceptance criteria
- [x] Cancelled sessions stop spending network/server work as quickly as practical.

---

## Task 9.2 — Reduce duplicated base64 conversion logic

**Primary files:**
- `src/background/service-worker.ts`
- any other helper modules where appropriate

### Subtasks
- [x] Reuse or centralize ArrayBuffer-to-base64 conversion logic instead of maintaining multiple copies.
- [x] Keep the helper safe for larger payloads.

### Acceptance criteria
- [x] There is one well-tested conversion helper instead of multiple partial implementations.

---

# Suggested implementation order for Copilot

## Block A — Highest value first
- [x] Task 1.1
- [x] Task 1.2
- [x] Task 1.3
- [x] Task 2.1
- [x] Task 2.2
- [x] Task 2.3
- [x] Task 7.1

## Block B — Correctness and persistence
- [x] Task 4.1
- [x] Task 4.2
- [x] Task 4.3
- [x] Task 5.1
- [x] Task 5.2
- [x] Task 6.1
- [x] Task 6.2

## Block C — Cleanup and hardening
- [x] Task 3.1
- [x] Task 3.2
- [x] Task 7.2
- [ ] Task 8.1
- [x] Task 9.1
- [x] Task 9.2

---

# Definition of done

The work should be considered complete only when all of the following are true:

- [ ] The paragraph-transition bug is no longer reproducible in the dev harness/manual test flow.
- [x] No overlapping playback path exists between HTMLAudio and WebAudio fallback.
- [x] `npm test` completes successfully after a clean `npm ci`.
- [x] `npm run build` still succeeds.
- [x] Settings persistence is race-safe and no longer excessively chatty.
- [x] Voice discovery works with non-root API paths.
- [x] Common user-facing failures produce visible, actionable feedback.
