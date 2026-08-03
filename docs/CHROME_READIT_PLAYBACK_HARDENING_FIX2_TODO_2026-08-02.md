# Chrome Read It Playback Hardening FIX2 TODO

**Document:** `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_TODO_2026-08-02.md`  
**Status:** Ready for implementation  
**Date:** 2026-08-02  
**Repository:** `ekkus93/chrome_readit`  
**Reviewed baseline:** `032265d9f10d87012e13057177f0463dc96ec211` (`master`)  
**Baseline CI:** workflow `CI`, run `30785364984`, job `91597786574`, conclusion `success`  
**Governing specification:** `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_SPEC_2026-08-02.md`  
**Predecessor TODO:** `docs/CHROME_READIT_PLAYBACK_HARDENING_TODO_2026-08-02.md`

---

## 0. Execution rules

### 0.1 Completion policy

- [ ] Work directly from the FIX2 specification; do not reinterpret it as optional guidance.
- [ ] Preserve the existing offscreen-coordinator architecture.
- [ ] Do not add a popup, Options, content-script, WebAudio, browser-speech, or host-audio fallback.
- [ ] Do not weaken tests, remove assertions, enlarge timing tolerances, or convert failures into warnings merely to obtain a green run.
- [ ] Do not mark a task complete based only on code presence. Record the exact test or runtime evidence.
- [ ] Keep implementation defects, validation gaps, manual/environment work, and unrecoverable historical evidence separate.
- [ ] Use structured errors for expected failure modes.
- [ ] Never expose selected text, audio bytes, URL credentials, private paths, or stack traces in user-visible errors.
- [ ] Do not create a branch or pull request unless explicitly requested. The project’s current working convention is direct `master` updates.

### 0.2 Silent-failure prohibition

Before completing any block, search its modified files for:

```text
catch {}
catch { return [] }
catch { return null }
.catch(() => undefined)
.catch(() => {})
void someAsyncOperation()
chrome.runtime.lastError
console.warn
if (!api) return
```

For every occurrence:

- [ ] classify it as explicitly justified best-effort cleanup, or replace it;
- [ ] ensure user-visible operations do not rely only on console logging;
- [ ] ensure invariant-critical operations fail closed;
- [ ] add a negative-path test proving the intended behavior.

### 0.3 Evidence record

Create or update an implementation report that records:

- [ ] starting SHA;
- [ ] final SHA;
- [ ] files changed by block;
- [ ] commands and exit codes;
- [ ] CI run, attempt, job, and artifact IDs;
- [ ] real Docker evidence;
- [ ] listening evidence;
- [ ] accepted limitations;
- [ ] historical evidence that is unavailable and must not be fabricated.

---

## 1. Baseline and review preservation

### 1.1 Record the FIX2 starting state

- [ ] Record the exact `master` SHA before the first runtime change.
- [ ] Record `node --version`.
- [ ] Record `npm --version`.
- [ ] Record Chrome/Chromium version and binary path.
- [ ] Record `python --version`.
- [ ] Record `docker --version`.
- [ ] Record `docker compose version`.
- [ ] Record operating system and architecture.
- [ ] Record the current effective Compose configuration.
- [ ] Record the current CI status issue payload for the baseline SHA.
- [ ] Preserve the original FIX1 spec, TODO, report, and addendum as historical documents.

**Acceptance:** The report contains exact values captured before runtime changes. Missing pre-FIX1 information is labeled unavailable rather than reconstructed.

### 1.2 Establish a review-finding matrix

Create a table mapping every FIX2 finding to:

- [ ] severity;
- [ ] affected files;
- [ ] implementation task;
- [ ] tests;
- [ ] evidence;
- [ ] disposition: fixed, accepted limitation, or not applicable.

At minimum include:

- [ ] weak Chromium single-player proof;
- [ ] fail-open audio cleanup;
- [ ] unbounded TTS response buffering;
- [ ] UI control failures discarded;
- [ ] stuck test-speech state after supersession;
- [ ] Docker queue-slot leak paths;
- [ ] untracked tempfile cleanup failures;
- [ ] unordered durable status writes;
- [ ] voice discovery collapsing all errors to `[]`;
- [ ] unvalidated stored settings and optimistic persistence;
- [ ] partial TTS URL persistence while typing;
- [ ] inaccurate readiness semantics;
- [ ] non-cancellable timed-out inference;
- [ ] invalid voice consuming queue capacity;
- [ ] incomplete protocol guards;
- [ ] missing-source debug fallback;
- [ ] unused expected-session protection;
- [ ] missing network timeouts;
- [ ] segmentation edge cases;
- [ ] `--legacy-peer-deps`;
- [ ] status-publisher rerun-attempt handling;
- [ ] broad host permission/minimum Chrome version concerns.

---

## 2. Fail-closed audio lifecycle — P0

### 2.1 Add explicit cleanup errors

Affected files:

- `src/lib/playback-protocol.ts`
- `src/offscreen/playback-coordinator.ts`

Tasks:

- [ ] Add `AUDIO_CLEANUP_FAILED` to `PlaybackErrorCode`.
- [ ] Add a safe cleanup-stage representation: `pause`, `clear-source`, `reload`, `revoke-url`, `accounting`.
- [ ] Implement a structured cleanup result or a typed exception carrying the stage.
- [ ] Ensure internal cleanup failures are not converted to `INVALID_REQUEST`.
- [ ] Add `INTERNAL_PLAYBACK_ERROR` if needed for genuinely unexpected coordinator failures.
- [ ] Ensure error messages do not include selected text, object URLs, or sensitive endpoint details.

**Acceptance:** Every cleanup failure reaches a structured terminal state with a distinct code and stage.

### 2.2 Make stop-before-replace conclusive

- [ ] Refactor `stopAudio()` so `pause()` failure is not ignored.
- [ ] Treat failure to neutralize or clear the source as terminal.
- [ ] Permit `audio.load()` to remain best-effort only after pause and source clearing succeeded.
- [ ] Ensure replacement does not call `play()` after uncertain cleanup.
- [ ] Settle the old playback promise before replacement acceptance.
- [ ] Detach or stale-proof old handlers before new playback begins.
- [ ] Revoke the old object URL exactly once.
- [ ] Verify no code path starts a second source as a recovery fallback.

**Acceptance:** Injected pause and source-clear failures reject the replacement and leave no second source active.

### 2.3 Centralize player settlement

- [ ] Create one idempotent settlement function for ended, error, rejected play, synchronous throw, cancel, replacement, and cleanup failure.
- [ ] Prevent duplicate settlement.
- [ ] Prevent double object-URL revocation.
- [ ] Prevent old callbacks from clearing handlers or state belonging to a newer play attempt.
- [ ] Ensure `removeAttribute('src')` exceptions cannot leave the playback promise unresolved.
- [ ] Assert active-player accounting never becomes negative.

### 2.4 Emit supersession as a terminal result

- [ ] Add a `superseded` event or emit `cancelled` with `SESSION_SUPERSEDED`.
- [ ] Emit the old session’s terminal event before the replacement’s accepted event.
- [ ] Ensure superseded sessions never later emit `completed`.
- [ ] Preserve stale callback cleanup without allowing stale state mutation.

### 2.5 Coordinator regression tests

Add focused tests for:

- [ ] three rapid starts;
- [ ] five rapid starts;
- [ ] mixed-source rapid starts;
- [ ] stale `ended` callback;
- [ ] stale `error` callback;
- [ ] duplicate `ended` callback;
- [ ] `error` followed by `ended`;
- [ ] synchronous `play()` throw;
- [ ] rejected `play()` promise;
- [ ] pause cleanup failure;
- [ ] source-clear cleanup failure;
- [ ] object-URL revocation failure;
- [ ] exact-once object-URL revocation;
- [ ] replacement while paused;
- [ ] replacement during transition gap;
- [ ] failed resume;
- [ ] supersession event order;
- [ ] old session never completes;
- [ ] new playback never starts after cleanup uncertainty.

**Block acceptance:** All tests pass without weakening the single-player invariant.

---

## 3. Observable active-player invariant — P0

### 3.1 Add production-path test instrumentation

Affected files:

- `src/offscreen/playback-coordinator.ts`
- `src/offscreen.ts`
- `scripts/chromium-e2e.mjs`

- [ ] Add test-build diagnostics for `activePlayerCount`.
- [ ] Add `maxActivePlayerCount`.
- [ ] Add play-attempt IDs.
- [ ] Add successful play-start count.
- [ ] Add terminal settlement count.
- [ ] Add cleanup-failure count and stage.
- [ ] Increment only for the actual active coordinator player.
- [ ] Decrement only in the central settlement function.
- [ ] Do not reset active count on session acceptance.
- [ ] In test mode, fail immediately if count exceeds one.
- [ ] Keep diagnostics unavailable or safely bounded in production builds.

### 3.2 Replace the weak Chromium assertion

- [ ] Remove the logic that clears `activeChunk` on `accepted` as proof of no overlap.
- [ ] Retain chunk-order assertions as sequencing evidence, not player-count evidence.
- [ ] Assert `maxActivePlayerCount === 1` for sessions that play audio.
- [ ] Assert final `activePlayerCount === 0` after terminal completion/cancel/failure.
- [ ] Assert player settlements equal successful play starts at the end of each scenario.
- [ ] Preserve diagnostic records for any invariant violation.

**Acceptance:** A deliberately injected stop failure makes the Chromium invariant test fail instead of being hidden by a new accepted event.

---

## 4. Protocol and message hardening — P0/P1

### 4.1 Complete runtime guards

Affected files:

- `src/lib/playback-protocol.ts`
- `src/lib/playback-protocol.test.ts`

- [ ] Validate optional `chunkId`.
- [ ] Validate optional `transition`.
- [ ] Require chunk IDs for chunk-started/chunk-ended events.
- [ ] Validate event/state consistency.
- [ ] Validate progress counters for internal consistency.
- [ ] Reject impossible terminal/error combinations.
- [ ] Add tests for malformed optional fields.
- [ ] Add tests for unknown transition values.
- [ ] Add tests for invalid chunk-event shapes.

### 4.2 Require explicit `READ_TEXT` source

Affected files:

- `src/lib/messaging.ts`
- `src/background/service-worker.ts`
- all callers and tests

- [ ] Make `source` required for `READ_TEXT`.
- [ ] Remove the silent `debug-fixture` default.
- [ ] Reject malformed messages with a structured validation error.
- [ ] If a legacy adapter is retained, scope and document it explicitly.
- [ ] Add tests proving missing source is rejected.

### 4.3 Retire or document legacy control messages

- [ ] Inventory every caller of `SPEECH_STATUS`, `PAUSE_SPEECH`, `RESUME_SPEECH`, and `CANCEL_SPEECH`.
- [ ] Prefer migrating UI callers to the shared playback protocol.
- [ ] Delete unused adapters.
- [ ] If any adapter remains, document caller and removal criterion.
- [ ] Ensure legacy and new messages cannot diverge semantically.

### 4.4 Correct error classification

Affected file: `src/offscreen.ts`

- [ ] Use `INVALID_REQUEST` only for failed request validation.
- [ ] Map coordinator/internal exceptions to internal or interruption errors.
- [ ] Preserve safe causal detail in diagnostics.
- [ ] Add tests for thrown start/control handlers.

**Block acceptance:** All cross-context messages are runtime-validated and malformed callers do not silently fall through to debug behavior.

---

## 5. Ordered durable status and restart behavior — P0

### 5.1 Add monotonic status metadata

Affected files:

- `src/lib/playback-protocol.ts`
- `src/offscreen/playback-coordinator.ts`
- `src/background/service-worker.ts`

- [ ] Add a monotonic event/status sequence number.
- [ ] Include session ID and request ID with every persisted record.
- [ ] Include an ordering timestamp where useful.
- [ ] Ensure sequence increments in one authoritative location.

### 5.2 Serialize session-storage writes

- [ ] Implement one write queue or promise chain.
- [ ] Reject an older sequence for the same session.
- [ ] Reject an older session record after a newer active session is known.
- [ ] Ensure `playing` cannot overwrite `completed` because of write completion order.
- [ ] Preserve playback when storage is unavailable.
- [ ] Surface degraded persistence status to status-query callers.
- [ ] Add race tests with intentionally reordered storage promises.

### 5.3 Harden status query after restart

- [ ] Prefer a valid live offscreen response over durable mirror data.
- [ ] Use durable state only to classify an absent/destroyed offscreen session.
- [ ] Write exactly one `OFFSCREEN_INTERRUPTED` terminal record.
- [ ] Ensure subsequent status queries remain stable.
- [ ] Ensure the next start recreates the document.
- [ ] Test worker restart during synthesis, playback, pause, and transition wait.

### 5.4 Replace uncertain offscreen existence fallback

- [ ] Declare a minimum supported Chrome version, or implement a tested equivalent API path.
- [ ] Do not treat process-local `offscreenDocumentKnown` as authoritative when required APIs are unsupported.
- [ ] Distinguish unsupported platform from transient offscreen destruction.
- [ ] Add tests for API unavailable, API failure, and create-document race.

**Block acceptance:** Deliberately reordered writes cannot resurrect stale active playback, and restart queries return stable authoritative state.

---

## 6. Popup and Options failure visibility — P0

### 6.1 Shared typed control helper

Affected files:

- new shared UI/runtime helper as appropriate
- `src/popup/Popup.tsx`
- `src/options/Options.tsx`

- [ ] Send shared `PLAYBACK_CONTROL` requests.
- [ ] Include displayed `expectedSessionId` for popup/Options controls.
- [ ] Validate `PlaybackControlResponse`.
- [ ] Display transport errors.
- [ ] Display structured coordinator errors.
- [ ] Update visible state from the authoritative response.
- [ ] Remove empty callbacks that discard failure.
- [ ] Keep global keyboard controls intentionally session-global and document that distinction.

### 6.2 Fix stuck test-speech state

- [ ] Track the accepted popup test session ID.
- [ ] Track the accepted Options test session ID.
- [ ] Clear sending state on completion.
- [ ] Clear sending state on cancellation.
- [ ] Clear sending state on failure.
- [ ] Clear sending state on supersession.
- [ ] Clear sending state on interruption.
- [ ] Clear sending state on invalid response or transport failure.
- [ ] Ensure another source replacing test speech does not leave the button disabled.

### 6.3 Make control availability stateful

- [ ] Disable Pause unless current state is pausable.
- [ ] Disable Resume unless current state is paused.
- [ ] Disable Cancel unless a cancellable session exists.
- [ ] Preserve keyboard accessibility.
- [ ] Use live regions for status and errors.

### 6.4 Surface status restoration failure

- [ ] Remove `.catch(() => undefined)` from Options status restoration.
- [ ] Handle popup `runtime.lastError` rather than merely ignoring the response.
- [ ] Distinguish “no active session” from “status unavailable.”
- [ ] Add retry behavior or an actionable message.

### 6.5 UI tests

Popup and Options tests must cover:

- [ ] pause success;
- [ ] pause failure;
- [ ] resume success;
- [ ] resume failure;
- [ ] cancel success;
- [ ] cancel failure;
- [ ] stale expected session ID;
- [ ] superseded test speech;
- [ ] offscreen interruption;
- [ ] invalid control response;
- [ ] runtime transport failure;
- [ ] status restoration failure;
- [ ] correct disabled/enabled controls.

**Block acceptance:** No user-initiated playback operation can fail with only a console warning or ignored callback.

---

## 7. Settings and voice discovery hardening — P0/P1

### 7.1 Treat stored settings as untrusted

Affected files:

- `src/lib/storage.ts`
- `src/lib/storage.test.ts`

- [ ] Validate stored voice type and trim it.
- [ ] Validate stored rate type and finiteness.
- [ ] Clamp rate through the canonical playback-rate function.
- [ ] Validate TTS URL syntax and HTTP(S) protocol.
- [ ] Preserve explicit migration only for supported host-play URL shapes.
- [ ] Return repair/warning metadata for invalid stored values.
- [ ] Add tests for strings, `NaN`, infinities, negatives, huge rates, arrays, objects, empty voices, and malformed URLs.
- [ ] Ensure corrupt storage cannot crash `toFixed()` in popup or Options.

### 7.2 Make settings saves observable

- [ ] Do not update `persistedSettingsRef` before `chrome.storage.sync.set()` succeeds.
- [ ] Retain dirty state when save fails.
- [ ] Show a visible save error.
- [ ] Permit retry.
- [ ] Avoid unhandled rejected save promises.
- [ ] Add tests for transient and persistent storage failures.

### 7.3 Stop persisting partial URL drafts

Affected file: `src/options/Options.tsx`

- [ ] Separate `ttsUrlDraft` from persisted `ttsUrl`.
- [ ] Add explicit Save or bounded validated commit behavior.
- [ ] Do not persist malformed intermediate text.
- [ ] Do not request voices for malformed intermediate text.
- [ ] Preserve “Use local default” through the same validation/save path.
- [ ] Show validation errors without replacing the last valid persisted endpoint.

### 7.4 Replace empty-list voice fallback

Affected files:

- `src/lib/voices.ts`
- popup/Options voice-loading code
- tests

- [ ] Return `VoiceDiscoveryResult` with success or structured failure.
- [ ] Distinguish a valid empty voice list from failure.
- [ ] Add timeout.
- [ ] Report invalid URL.
- [ ] Report network failure.
- [ ] Report HTTP failure.
- [ ] Report invalid JSON.
- [ ] Report invalid schema.
- [ ] Preserve the currently configured voice without implying discovery succeeded.

### 7.5 Unify endpoint derivation

- [ ] Create one helper for sibling API endpoints.
- [ ] Handle `/api/tts`.
- [ ] Handle `/api/tts/`.
- [ ] Handle nested prefixes.
- [ ] Remove query and fragment appropriately.
- [ ] Test `ping`, `ready`, and `voices` derivation.
- [ ] Delete duplicate derivation logic.

**Block acceptance:** Invalid storage and failed voice discovery are visible, typed, and non-destructive.

---

## 8. TTS HTTP client resource bounds — P0

### 8.1 Add request timeout composition

Affected file: `src/lib/tts-client.ts`

- [ ] Add configurable synthesis timeout.
- [ ] Link timeout abort with session abort.
- [ ] Distinguish `CANCELLED` from `TTS_TIMEOUT`.
- [ ] Clean up timeout timers/listeners.
- [ ] Ensure replacement abort remains prompt.

### 8.2 Stream response bodies

- [ ] Validate status before reading.
- [ ] Validate MIME before reading.
- [ ] Reject declared oversize immediately.
- [ ] Use `response.body.getReader()` when available.
- [ ] Track cumulative bytes.
- [ ] Cancel the reader immediately when the cap is exceeded.
- [ ] Reject empty completed streams.
- [ ] Concatenate only after bounded completion.
- [ ] Do not describe `arrayBuffer()` post-checking as a hard limit.
- [ ] Define an explicit behavior for platforms without readable streams.

### 8.3 Add probe timeouts

- [ ] Add shorter timeout to readiness probe.
- [ ] Add shorter timeout to voice discovery.
- [ ] Surface timeout distinctly from HTTP failure.

### 8.4 TTS client tests

Add tests for:

- [ ] valid chunked stream;
- [ ] chunked stream over cap;
- [ ] no `Content-Length`;
- [ ] false low `Content-Length`;
- [ ] excessive declared length;
- [ ] zero-byte stream;
- [ ] slow header timeout where testable;
- [ ] slow body timeout;
- [ ] session cancellation during body read;
- [ ] reader cancellation after over-cap detection;
- [ ] timeout timer cleanup;
- [ ] host-play rejection before network request.

**Block acceptance:** A malicious response without `Content-Length` cannot cause unbounded extension memory buffering.

---

## 9. Pacing and text pipeline completion — P1

### 9.1 Replace correctness-by-polling for transition waits

Affected files:

- `src/offscreen/playback-coordinator.ts`
- coordinator tests

- [ ] Use deadline/remaining-time accounting.
- [ ] Freeze remaining time while paused.
- [ ] Interrupt promptly on cancel.
- [ ] Interrupt promptly on replacement.
- [ ] Test pause halfway through each transition type.
- [ ] Test repeated pause/resume.
- [ ] Test cancel during a gap.
- [ ] Test replacement during a gap.
- [ ] Define acceptable scheduling tolerance.

### 9.2 Extend segmentation regressions

Affected files:

- `src/lib/text-segmentation.ts`
- `src/lib/text-segmentation.test.ts`

Add explicit cases for:

- [ ] `The U.S. Army responded.`
- [ ] `Meet at 5 p.m. Monday.`
- [ ] `The U.K. Government announced changes.`
- [ ] `Dr. Élodie spoke.`
- [ ] `123 Main St. near the park.`
- [ ] multiple URL query parameters;
- [ ] URL fragments;
- [ ] a real prose question followed by `key=value` text;
- [ ] Unicode uppercase/lowercase starts;
- [ ] Unicode closing quotes and punctuation.

### 9.3 Consume the complete collision fixture

Affected files:

- `src/lib/debug-fixtures.ts`
- segmentation/packing tests
- `scripts/chromium-e2e.mjs`

- [ ] Import and use `DEBUG_COLLISION_FIXTURE` in pure tests.
- [ ] Import or load the same fixture in Chromium testing.
- [ ] Verify normalized semantic text appears exactly once.
- [ ] Verify no paragraph boundary is crossed by packing.
- [ ] Verify no required punctuation case regresses.
- [ ] Avoid maintaining a weaker duplicated fixture string in the browser harness.

**Block acceptance:** The shared fixture is one source of truth across pure, browser, and listening validation.

---

## 10. Docker configuration and queue correctness — P0

### 10.1 Fail fast on invalid environment values

Affected file: `docker/coqui-local/app.py`

- [ ] Reject non-integer `MAX_TEXT_CHARS`.
- [ ] Reject zero or negative `MAX_TEXT_CHARS`.
- [ ] Reject non-integer `SYNTH_QUEUE_CAPACITY`.
- [ ] Reject zero or negative queue capacity.
- [ ] Reject non-finite timeout.
- [ ] Reject zero or negative timeout.
- [ ] Reject empty model identifier.
- [ ] Normalize/deduplicate forced voices.
- [ ] Do not silently clamp invalid deployment configuration.
- [ ] Add startup tests for each invalid value.

### 10.2 Fix semaphore ownership

- [ ] Move every operation after `_slots.acquire()` into one exception-safe block.
- [ ] Release on `mkstemp()` failure.
- [ ] Release on descriptor-close failure.
- [ ] Release on bookkeeping failure.
- [ ] Release on executor-submit failure.
- [ ] Transfer release responsibility to the future callback only after successful submission.
- [ ] Add injected-failure tests for every path.
- [ ] Assert capacity returns to the configured value after each failed submission.

### 10.3 Validate voices before queue acquisition

- [ ] Discover/cache available voices safely.
- [ ] Reject an invalid requested voice before semaphore acquisition.
- [ ] Ensure invalid voice does not create a tempfile.
- [ ] Ensure invalid voice does not enter the executor.
- [ ] Add tests observing queue occupancy and backend calls.

### 10.4 Make queue metrics explicit

- [ ] Track queue capacity.
- [ ] Track slots in use.
- [ ] Track active inference.
- [ ] Track queued futures.
- [ ] Track timed-out-but-still-running work.
- [ ] Protect metrics with appropriate synchronization.
- [ ] Add invariant checks against negative or over-capacity values.

**Block acceptance:** Every injected pre-submit exception leaves queue capacity unchanged.

---

## 11. Docker tempfile, timeout, readiness, and shutdown — P0/P1

### 11.1 Retain failed cleanup paths

- [ ] Remove a path from tracking only after confirmed deletion or confirmed absence.
- [ ] Retain paths whose deletion failed.
- [ ] Record safe cleanup diagnostics.
- [ ] Retry retained paths during shutdown.
- [ ] Add a bounded retry policy if appropriate.
- [ ] Expose tracked/leaked cleanup count in diagnostics or logs.
- [ ] Add tests for permanent deletion failure.
- [ ] Add tests for transient failure followed by successful retry.

### 11.2 Test response/disconnect cleanup

- [ ] Verify normal `FileResponse` completion removes the file.
- [ ] Verify client disconnect behavior where Starlette/TestClient permits.
- [ ] Ensure background cleanup exceptions are not silently lost.
- [ ] Ensure shutdown retries any retained path.

### 11.3 Correct readiness semantics

- [ ] Decide whether `/api/ready` means model-only or accepting-work readiness.
- [ ] Prefer returning `accepting_requests`, capacity, in-use count, and worker busy state.
- [ ] Return non-ready or explicit saturation state when no request can be accepted.
- [ ] Update popup/Options probes to use the correct semantic endpoint.
- [ ] Update README and Docker README.
- [ ] Add saturation tests.

### 11.4 Make timeout behavior honest

- [ ] Preserve stable 504 response.
- [ ] Track timed-out work until it actually finishes.
- [ ] Keep the queue slot occupied while the underlying thread is running.
- [ ] Reflect unavailable capacity in readiness.
- [ ] Clean the tempfile when the job eventually ends.
- [ ] Document that in-process thread inference is not force-cancelled.
- [ ] Evaluate process isolation if hard cancellation is required.

### 11.5 Bound shutdown

- [ ] Define graceful shutdown duration.
- [ ] Test normal shutdown with no work.
- [ ] Test shutdown with queued work.
- [ ] Test shutdown with a blocked inference.
- [ ] Avoid an undocumented infinite `executor.shutdown(wait=True)` path.
- [ ] If process isolation is introduced, test worker termination and recreation.

### 11.6 Stable unexpected-error envelope

- [ ] Add a global unexpected-exception handler where appropriate.
- [ ] Return a stable generic client envelope.
- [ ] Log safe diagnostic detail server-side.
- [ ] Do not expose selected text, paths, traces, or model internals.
- [ ] Test unexpected endpoint/runtime exceptions.

**Block acceptance:** Queue, readiness, tracked files, and shutdown all report the real state after timeout and filesystem failures.

---

## 12. Manifest, permission, and platform hardening — P1

### 12.1 Declare supported Chrome baseline

Affected files:

- `src/manifest.ts`
- README/documentation

- [ ] Determine the minimum Chrome version required by offscreen documents and the selected context APIs.
- [ ] Add `minimum_chrome_version` if appropriate.
- [ ] Document unsupported-browser behavior.
- [ ] Remove correctness-weakening compatibility fallbacks.

### 12.2 Review `<all_urls>`

- [ ] Confirm selection capture works through `activeTab` and `scripting` without permanent broad host access.
- [ ] Determine whether optional host permissions can be requested for the configured TTS origin.
- [ ] If feasible, replace `<all_urls>` with narrower/optional permissions.
- [ ] If retained, accurately document that arbitrary TTS origins—not selection capture alone—drive the requirement.
- [ ] Record Chrome Web Store implications.

### 12.3 Redact endpoint errors

- [ ] Strip URL userinfo from visible errors.
- [ ] Avoid echoing sensitive query values.
- [ ] Add tests for URLs containing credentials or tokens.

---

## 13. Chromium scenario matrix — P0/P1

Affected file: `scripts/chromium-e2e.mjs`

### 13.1 Build reusable browser helpers

- [ ] Identify the extension worker by manifest name or another stable identity.
- [ ] Retain meaningful errors from failed probes rather than ignoring every cause.
- [ ] Add helpers to open/reopen popup and Options pages.
- [ ] Add helpers for typed start/control/status messages.
- [ ] Add helper to retrieve player diagnostics.
- [ ] Add helper to force service-worker termination.
- [ ] Add helper to inject media play rejection/error in the test build.

### 13.2 Replacement matrix

Run and verify:

- [ ] normal reading → popup test;
- [ ] popup test → Options test;
- [ ] Options test → normal reading;
- [ ] normal reading → normal reading;
- [ ] five rapid mixed-source starts;
- [ ] superseded session never completes;
- [ ] each superseded UI exits sending state;
- [ ] actual maximum active-player count remains one.

### 13.3 Control matrix

- [ ] Pause active playback from popup.
- [ ] Resume from popup.
- [ ] Cancel from popup.
- [ ] Pause from Options.
- [ ] Resume from Options.
- [ ] Cancel from Options.
- [ ] Verify stale expected session ID cannot affect a replacement.
- [ ] Verify keyboard controls intentionally affect the current global session.

### 13.4 Error matrix

- [ ] Rejected `audio.play()`.
- [ ] Synchronous `audio.play()` throw.
- [ ] Media `error` event.
- [ ] Duplicate `ended` event.
- [ ] Cleanup failure injection.
- [ ] TTS HTTP failure.
- [ ] TTS timeout.
- [ ] Oversized streamed response.
- [ ] Offscreen destruction.
- [ ] Invalid response payload.

### 13.5 Pacing matrix

At rates `0.5`, `1`, `2`, `4`, and `10`:

- [ ] verify continuation minimum;
- [ ] verify sentence minimum;
- [ ] verify paragraph minimum;
- [ ] verify ordering `paragraph > sentence > continuation`;
- [ ] use configured values rather than a weaker hard-coded threshold;
- [ ] document scheduling tolerance;
- [ ] verify pause halfway through a gap preserves remaining delay.

### 13.6 Worker restart matrix

- [ ] Terminate worker during synthesis.
- [ ] Terminate worker during playback.
- [ ] Terminate worker while paused.
- [ ] Terminate worker during a transition gap.
- [ ] Reopen popup after restart.
- [ ] Query accurate status.
- [ ] Pause through recreated worker.
- [ ] Resume through recreated worker.
- [ ] Cancel through recreated worker.
- [ ] Start new session and prove unique UUID.

### 13.7 Fixture integrity

- [ ] Use full `DEBUG_COLLISION_FIXTURE`.
- [ ] Verify every normalized segment is synthesized exactly once.
- [ ] Verify order.
- [ ] Verify paragraph count.
- [ ] Verify no semicolon split regression.
- [ ] Verify no URL/query regression.

**Block acceptance:** The harness directly observes player ownership and completes the full original TODO scenario/rate/restart matrix.

---

## 14. CI, coverage, dependencies, and status publisher — P1

### 14.1 Add focused coverage thresholds

Affected configuration:

- `vite.config.ts` or dedicated `vitest.config.ts`
- `package.json`
- `.github/workflows/ci.yml`

- [ ] Set line/function/branch/statement thresholds for the coordinator.
- [ ] Set thresholds for protocol guards.
- [ ] Set thresholds for normalization/segmentation/packing/pacing.
- [ ] Set thresholds for TTS client.
- [ ] Set thresholds for service-worker routing.
- [ ] Fail CI on regression.
- [ ] Keep Codecov as reporting, not the sole gate.

### 14.2 Remove peer-dependency bypass

- [ ] Run a normal `npm ci` and capture the exact conflict.
- [ ] Align CRXJS, Vite, Vitest, React, and related versions.
- [ ] Remove `--legacy-peer-deps` from CI and documented commands.
- [ ] If temporarily unavoidable, pin versions and document the conflict/removal issue.
- [ ] Prove production build and Chromium test with the selected versions.

### 14.3 Pin GitHub Actions

- [ ] Pin `actions/checkout` to an immutable SHA.
- [ ] Pin `actions/setup-node`.
- [ ] Pin `actions/upload-artifact`.
- [ ] Pin `actions/setup-python`.
- [ ] Pin `browser-actions/setup-chrome`.
- [ ] Pin Codecov action.
- [ ] Add comments naming the intended release versions.
- [ ] Retain minimum permissions.

### 14.4 Harden CI status publisher reruns

Affected file: `.github/workflows/publish-ci-status.yml`

- [ ] Fetch the current run object.
- [ ] Compare both run ID and run attempt.
- [ ] Do not publish an older-attempt event with latest-attempt jobs.
- [ ] Record run attempt in stale-event logic.
- [ ] Add a testable generator/helper if necessary.
- [ ] Validate a real rerun path.
- [ ] Preserve issue ownership checks and branch isolation.

### 14.5 Add real-Docker validation entry point

- [ ] Decide scheduled, manual-dispatch, release, or dedicated runner execution.
- [ ] Keep ordinary CI bounded.
- [ ] Require real-Docker success for final release sign-off.
- [ ] Retain logs and structured evidence artifacts.

**Block acceptance:** CI is fail-closed, dependency-compatible without an untracked bypass, and the status issue reports the correct rerun attempt.

---

## 15. Real Docker/model validation — release-blocking manual/runtime block

### 15.1 Clean real build

For the exact candidate SHA:

- [ ] `docker compose -f docker/docker-compose.yml down -v`
- [ ] `docker compose -f docker/docker-compose.yml build --no-cache`
- [ ] Record image digest.
- [ ] Record build output and duration.
- [ ] Start Compose.
- [ ] Record container ID and non-root user.
- [ ] Confirm no unexpected host devices or privileges.

### 15.2 Real endpoint smoke

- [ ] Wait for real model initialization.
- [ ] `GET /api/ping` succeeds.
- [ ] `GET /api/ready` reports accurate model and queue state.
- [ ] `GET /api/voices` returns the real model’s voices.
- [ ] `POST /api/tts` returns 200.
- [ ] Content type begins with `audio/`.
- [ ] WAV bytes are non-empty and structurally valid.
- [ ] Invalid voice returns structured 400.
- [ ] Empty text returns structured 400.
- [ ] Oversized text returns structured 413.
- [ ] Queue saturation returns structured 429.
- [ ] Timeout returns structured 504.
- [ ] Removed host-play/debug endpoints return 404.

### 15.3 Loopback and process inspection

- [ ] Inspect host listening sockets.
- [ ] Prove publication is only `127.0.0.1` by default.
- [ ] Inspect container process list.
- [ ] Confirm one configured Uvicorn worker.
- [ ] Confirm non-root execution.

### 15.4 Real tempfile observation

- [ ] Observe temp directory before synthesis.
- [ ] Observe during active synthesis.
- [ ] Observe after successful response.
- [ ] Observe after invalid voice.
- [ ] Observe after backend failure if safely injectable.
- [ ] Observe after timeout completes.
- [ ] Confirm no accumulating `chrome-readit-*.wav` files.

### 15.5 Model-cache reuse

- [ ] Record first-start download/cache behavior and duration.
- [ ] Stop and recreate the container without deleting the named volume.
- [ ] Record second-start behavior and duration.
- [ ] Prove model data was reused rather than downloaded again.
- [ ] Record effective volume source and target.

### 15.6 Clean shutdown

- [ ] Stop the service normally.
- [ ] Confirm shutdown completes within the documented bound.
- [ ] Confirm no tracked temp paths remain.
- [ ] Retain final logs.

**Block acceptance:** Evidence uses the real image and model, not a fake backend or only `docker compose config`.

---

## 16. Structured listening validation — release-blocking manual block

### 16.1 Prepare the record

Create a listening report containing:

- [ ] exact SHA;
- [ ] OS;
- [ ] Chrome version;
- [ ] Docker image digest;
- [ ] Coqui model;
- [ ] voice;
- [ ] fixture version/hash;
- [ ] date and tester.

### 16.2 Run required rates

Using `DEBUG_COLLISION_FIXTURE`, test:

- [ ] rate `0.5`;
- [ ] rate `1`;
- [ ] rate `2`;
- [ ] rate `4`;
- [ ] rate `10`.

For each rate record:

- [ ] chunk count;
- [ ] chunk boundaries;
- [ ] continuation timestamps;
- [ ] sentence timestamps;
- [ ] paragraph timestamps;
- [ ] maximum active-player count;
- [ ] overlap heard: yes/no;
- [ ] omission heard: yes/no;
- [ ] repetition heard: yes/no;
- [ ] sentence seams collided: yes/no;
- [ ] paragraph pauses distinct: yes/no;
- [ ] pronunciation/segmentation notes;
- [ ] pass/fail.

### 16.3 Additional listening cases

- [ ] ordinary short prose;
- [ ] a long single sentence;
- [ ] several paragraphs;
- [ ] abbreviations and initials;
- [ ] decimals and version strings;
- [ ] domains, email, and URL query strings;
- [ ] pause/resume mid-sentence;
- [ ] replacement while speaking;

**Block acceptance:** Human evidence confirms no audible overlap/collision and clearly distinct paragraph pacing at all required rates.

---

## 17. Documentation reconciliation and repository hygiene — P1

### 17.1 Update governing documents

- [ ] Update this FIX2 TODO as work is completed.
- [ ] Add accurate cross-reference/status to the original playback-hardening TODO.
- [ ] Update the implementation report with the previously successful FIX1 CI evidence.
- [ ] Add a FIX2 implementation report or addendum.
- [ ] Update README architecture and validation sections.
- [ ] Update Docker README readiness/timeout/cache semantics.
- [ ] Update docs index.
- [ ] Document minimum Chrome version.
- [ ] Document host-permission rationale.
- [ ] Document any accepted inability to hard-cancel in-process Coqui inference.

### 17.2 Remove misleading claims

Search and correct claims that:

- [ ] current Chromium testing fully proves actual single-player ownership;
- [ ] `/api/ready` includes queue availability if it does not;
- [ ] `<all_urls>` is required solely for selection capture;
- [ ] response post-checking is a hard streaming size limit;
- [ ] timed-out Coqui threads are cancelled;
- [ ] mocked service tests are real Docker/model evidence;
- [ ] the original TODO is complete before manual sign-off.

### 17.3 Obsolete-path search

Search active code for:

```text
/api/tts/play
/api/playing
/api/tts/cancel
AudioContext
AudioBufferSourceNode
speechSynthesis
new Audio(
createElement('audio')
createElement("audio")
base64
host play
```

- [ ] Classify every result.
- [ ] Confirm only the coordinator creates production audio.
- [ ] Confirm removed host/debug endpoints have no active caller.
- [ ] Confirm historical docs are labeled historical.

### 17.4 Silent-failure final search

- [ ] Search all active source files for empty catches.
- [ ] Search for ignored async promises.
- [ ] Search for ignored runtime callbacks.
- [ ] Search for `return []`, `return null`, or default values in error paths.
- [ ] Review every result and document justification.
- [ ] Add tests for retained best-effort paths.

### 17.5 Secret scan

- [ ] Search current tree for API keys, bearer tokens, passwords, private keys, and credentials in URLs.
- [ ] Run available repository/history secret scanning.
- [ ] Record commands and results.
- [ ] Remove or rotate any discovered secret before proceeding.

### 17.6 Clean tree

- [ ] Remove generated files not intended for source control.
- [ ] Remove temporary workflows and diagnostics.
- [ ] Confirm `git status --short` is empty at final SHA.

---

## 18. Full validation gate

Run from a clean checkout of one exact candidate SHA.

### 18.1 Extension and static service gates

```bash
npm ci
npm run lint
npm run typecheck
npm test -- --run
npm run build
npm run build:e2e
CHROME_PATH=/path/to/chrome xvfb-run -a npm run test:chromium
python -m pip install -r docker/coqui-local/requirements-test.txt
python -m pytest -q docker/coqui-local/tests
docker compose -f docker/docker-compose.yml config
```

- [ ] Record every command.
- [ ] Record every exit code.
- [ ] Record test counts.
- [ ] Record coverage thresholds and results.
- [ ] Record Chromium diagnostic summary.

### 18.2 Hosted CI

- [ ] Push final candidate SHA.
- [ ] Require status issue #2 to report the exact SHA.
- [ ] Require workflow conclusion `success`.
- [ ] Record run ID.
- [ ] Record run attempt.
- [ ] Record job ID.
- [ ] Record artifact IDs.
- [ ] Validate the machine-readable JSON.
- [ ] If rerun, prove the publisher reports the correct attempt.

### 18.3 Runtime gates

- [ ] Complete Block 15 real Docker/model validation.
- [ ] Complete Block 16 structured listening validation.

### 18.4 Final decision

Do not mark FIX2 complete unless:

- [ ] all P0 defects are fixed;
- [ ] all required automated scenarios pass;
- [ ] active-player instrumentation proves maximum one;
- [ ] real Docker/model/cache evidence passes;
- [ ] listening evidence passes;
- [ ] documentation matches reality;
- [ ] no unjustified silent fallback remains;
- [ ] exact final SHA is recorded;
- [ ] repository tree is clean.

The final status must be one of:

```text
COMPLETE — all automated, Docker, listening, documentation, and evidence gates passed.

PARTIAL — implementation is present, but one or more named runtime/manual gates remain.

BLOCKED — a named defect or environment limitation prevents safe completion.
```

Never use “complete” as a synonym for “code was written” or “ordinary CI is green.”

---

## 19. Suggested implementation order

Execute in this order to avoid building more evidence on unsafe foundations:

1. **Block 2:** fail-closed audio lifecycle.
2. **Block 3:** direct active-player instrumentation.
3. **Block 4:** protocol validation and source/error semantics.
4. **Block 5:** ordered durable status.
5. **Block 6:** popup/Options failure visibility.
6. **Block 7:** settings and voices.
7. **Block 8:** streaming TTS limits and timeouts.
8. **Blocks 10–11:** Docker queue, tempfile, readiness, timeout, and shutdown.
9. **Block 9:** pacing and segmentation regressions.
10. **Block 13:** complete Chromium matrix.
11. **Block 14:** CI/dependency/status-publisher hardening.
12. **Blocks 15–16:** real Docker and listening sign-off.
13. **Blocks 17–18:** documentation, hygiene, and final exact-SHA gate.

Do not defer Blocks 2 and 3 until after UI or documentation work. They protect the primary safety invariant and determine whether later validation is trustworthy.