# Chrome Read It Playback Hardening FIX2 Specification

**Document:** `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_SPEC_2026-08-02.md`  
**Status:** Corrective hardening specification  
**Date:** 2026-08-02  
**Repository:** `ekkus93/chrome_readit`  
**Baseline reviewed:** `032265d9f10d87012e13057177f0463dc96ec211` (`master`)  
**Baseline CI evidence:** workflow `CI`, run `30785364984`, job `91597786574`, conclusion `success`  
**Companion implementation plan:** `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_TODO_2026-08-02.md`  
**Predecessor specification:** `docs/CHROME_READIT_PLAYBACK_HARDENING_SPEC_2026-08-02.md`

---

## 1. Purpose

The first playback-hardening pass replaced Chrome Read It’s fragmented playback paths with a substantially better architecture:

- one offscreen playback coordinator;
- one production `HTMLAudioElement`;
- a service worker that routes commands rather than owning the queue;
- sentence-aware segmentation and chunk packing;
- bounded inter-chunk pacing;
- a synthesis-only Docker service;
- strict TypeScript, unit, service, and unpacked-Chromium CI gates.

That architectural direction is correct and must be preserved.

This FIX2 specification addresses defects and incomplete evidence found during a line-by-line review of the implementation. The dominant remaining risk is no longer duplicate player implementations. It is **fail-open and quiet-failure behavior around the otherwise sound coordinator**:

- uncertain audio cleanup can be ignored before replacement starts;
- several UI operations discard structured failures;
- voice and status failures collapse into empty or generic states;
- response-size enforcement occurs after full buffering;
- server queue and temporary-file bookkeeping can become inconsistent on exceptional paths;
- the Chromium harness observes coordinator events rather than actual player ownership and can conceal overlap;
- several original TODO acceptance scenarios were not executed;
- real Docker/model/cache and human listening evidence remain absent.

FIX2 is complete only when the code fails closed on invariant-threatening errors, exposes recoverable failures explicitly, and provides evidence that directly observes the properties being claimed.

---

## 2. Source-of-truth hierarchy

During FIX2 implementation, the following precedence applies:

1. This FIX2 specification.
2. The FIX2 TODO.
3. The original playback-hardening specification, where it does not conflict with FIX2.
4. Existing implementation reports and addenda as historical evidence only.
5. Current code behavior only when explicitly retained by this specification.

The original TODO must not be marked fully complete merely because ordinary CI is green. FIX2 must distinguish:

- implemented architecture;
- implementation defects;
- missing automated proof;
- environment-dependent validation;
- unrecoverable historical baseline evidence.

---

## 3. Current-state assessment

### 3.1 Strong parts that must be retained

The reviewed baseline correctly provides:

- one offscreen queue owner;
- one persistent production audio element;
- stop-before-replace ordering in the normal path;
- UUID session identifiers;
- immutable settings snapshots per accepted request;
- current plus one-ahead synthesis;
- abort controllers for active synthesis requests;
- typed cross-context messages and structured errors;
- paragraph-aware text normalization;
- sentence segmentation and chunk packing;
- minimum continuation, sentence, and paragraph gaps;
- client rejection of host-play endpoints;
- loopback-only Compose publication;
- a non-root container runtime;
- a single model executor and bounded queue;
- no production host-play or debug endpoints;
- green lint, typecheck, unit, build, mocked service, Compose, and Chromium gates.

FIX2 shall not reintroduce:

- popup-local audio;
- Options-local audio;
- page-injected playback;
- host-side playback;
- service-worker-owned progression;
- process-local numeric session identities;
- a second fallback player.

### 3.2 Defect classes addressed by FIX2

FIX2 addresses six classes of remaining failure:

1. **Invariant uncertainty** — the code cannot prove the old source stopped, but continues anyway.
2. **Silent or quiet failure** — errors are converted to `[]`, `null`, `idle`, console warnings, ignored callbacks, or unresolved optimistic UI state.
3. **Resource-bound failure** — response, queue, thread, or temporary-file behavior is nominally bounded but not bounded on every exceptional path.
4. **Stale-state failure** — asynchronous persistence or UI state updates can overwrite or outlive newer authoritative state.
5. **Validation mismatch** — tests observe a proxy for an invariant instead of the invariant itself.
6. **Incomplete sign-off** — real model, socket, cache, listening, and extended browser scenarios remain unevidenced.

---

## 4. Goals

### 4.1 Fail-closed playback ownership

The system shall guarantee:

- replacement does not start if the previous source cannot be conclusively neutralized;
- no cleanup exception that threatens single-player ownership is ignored;
- actual active-player count is observable in test builds;
- the active-player count never exceeds one;
- every play attempt reaches exactly one terminal accounting path;
- a rejected `play()`, media error, stale callback, cancel, replacement, or normal end cannot leak active-player state.

### 4.2 Explicit failure visibility

The system shall ensure:

- UI controls validate and display structured failures;
- test-speech supersession reaches a terminal UI state;
- settings load/save failures are visible and retryable;
- voice discovery distinguishes an empty voice set from transport, HTTP, schema, and JSON failures;
- status restoration failures are visible instead of silently ignored;
- keyboard and context-menu failures are retained in authoritative status and diagnostics;
- internal failures are not mislabeled as caller `INVALID_REQUEST` errors.

### 4.3 Bounded client and server resources

The system shall:

- stream TTS responses with a hard byte cap;
- apply connect/response timeouts to synthesis, readiness, and voice requests;
- avoid buffering unbounded bodies before rejecting them;
- release server queue capacity on every pre-submit failure;
- retain and retry failed temporary-file cleanup;
- expose queue occupancy and accepting-work state;
- define honest semantics for non-cancellable Coqui work after an HTTP timeout;
- prevent indefinite shutdown waits on irrecoverably hung inference.

### 4.4 Directly observable validation

The test suite shall:

- measure active production player ownership rather than infer it from accepted/chunk events;
- exercise rapid replacements, rejected play, media error, stale callbacks, controls during gaps, and worker restart controls;
- test all required playback rates;
- build and start the real Docker image;
- synthesize with the configured real model;
- inspect loopback binding, temporary files, and model-cache reuse;
- retain structured human listening evidence.

### 4.5 Accurate completion records

The governing TODO and implementation reports shall accurately state:

- what passed;
- what remains manual;
- what historical evidence is unavailable;
- the exact validated SHA;
- exact workflow, run, job, and artifact identifiers;
- any accepted limitations.

---

## 5. Non-goals

FIX2 does not require:

- replacing Coqui solely for voice quality;
- streaming synthesis audio from the server;
- word-level highlighting;
- cloud accounts or cloud TTS;
- supporting browsers without Manifest V3 offscreen documents;
- preserving malformed legacy messages indefinitely;
- making arbitrary remote TTS endpoints safe without authentication;
- guaranteeing forceful cancellation inside an in-process Coqui inference call.

If hard cancellation is required, process isolation may be introduced. Thread cancellation must not be falsely claimed.

---

## 6. Mandatory invariants

These invariants are release-blocking.

### FIX2-INV-1: Conclusive stop-before-replace

A new source may not call `play()` until the previous source has been conclusively neutralized.

Conclusive neutralization requires:

- the old playback promise is settled;
- old handlers cannot mutate active state;
- `pause()` completed without an ownership-threatening exception;
- the old source was cleared or otherwise made non-audible;
- the old object URL was revoked exactly once when no longer in use;
- active-player accounting returned to zero.

If conclusive neutralization cannot be established, the new session shall fail with a structured internal cleanup error. It shall not continue optimistically.

### FIX2-INV-2: One observable active player

A test-build diagnostic counter shall represent actual coordinator-owned player activation. Its maximum value across a test must be no greater than one.

An `accepted` event must not reset or conceal active-player state.

### FIX2-INV-3: Exact terminal accounting

Every attempted chunk playback must reach exactly one terminal path:

- ended;
- media error;
- rejected or synchronously thrown `play()`;
- cancel;
- supersession;
- explicit cleanup failure.

Duplicate callbacks must be harmless and must not decrement counters twice.

### FIX2-INV-4: No swallowed user operation failure

Pause, resume, cancel, test speech, settings persistence, voice loading, and server probing must return or display success/failure. Console logging alone is not sufficient.

### FIX2-INV-5: Ordered authoritative status

Durable playback status writes must be monotonic. An older event may not overwrite a newer state.

Each persisted record shall include a monotonic sequence number or comparable ordering field. Writes shall be serialized, and readers shall reject stale records.

### FIX2-INV-6: Bounded TTS download

The extension must stop reading and cancel a TTS response as soon as its configured maximum byte count is exceeded. A missing or false `Content-Length` must not permit unbounded buffering.

### FIX2-INV-7: Bounded TTS wait

Synthesis, readiness, and voice-discovery requests must have explicit timeouts and structured timeout errors.

### FIX2-INV-8: Honest server queue state

The server must not report queue readiness while it cannot accept another request, unless the endpoint is explicitly documented and named as model-only readiness.

### FIX2-INV-9: No lost queue slot

After queue-slot acquisition, every path either:

- transfers release responsibility to a submitted future; or
- releases the slot before returning or raising.

Temporary-file creation, descriptor closing, executor submission, and validation failures must not leak capacity.

### FIX2-INV-10: No untracked leaked tempfile

A path shall remain tracked until deletion is confirmed or nonexistence is confirmed. Failed deletion must be retained, reported, and retried.

### FIX2-INV-11: Tests must observe their claim

A test claiming “single player” must observe active player ownership. A test claiming “real Docker/model” must use the real image and model. A test claiming “cache reuse” must compare first and recreated-container behavior. Proxy-only evidence must be labeled accordingly.

### FIX2-INV-12: No compatibility fallback that weakens correctness

Unsupported Chrome APIs, malformed internal messages, invalid configuration, or dependency conflicts must not be hidden through a fallback that changes correctness semantics. The implementation shall either:

- use a tested equivalent path;
- declare a minimum supported platform version; or
- fail with an explicit actionable error.

---

## 7. Target architecture

The high-level architecture remains unchanged:

```text
Popup / Options / Keyboard / Context Menu
                  |
                  v
        Manifest V3 Service Worker
      capture + validation + routing
      ordered durable status mirror
                  |
                  v
        Offscreen Playback Coordinator
      session + queue + one Audio element
      fail-closed cleanup + diagnostics
                  |
                  v
          TTS HTTP Client
      timeout + streaming byte limit
                  |
                  v
          Local Coqui Service
    model readiness + bounded queue
    serialized inference + tracked files
```

FIX2 strengthens contracts between these components. It does not add another playback owner.

---

## 8. Playback coordinator requirements

### 8.1 Structured cleanup result

Audio cleanup shall return a structured result rather than silently catching all errors.

Recommended shape:

```ts
export type AudioCleanupResult =
  | { ok: true }
  | {
      ok: false
      error: PlaybackError
      stage: 'pause' | 'clear-source' | 'reload' | 'revoke-url' | 'accounting'
    }
```

`reload` may remain best-effort only after pause and source clearing have succeeded. Failures in `pause`, source clearing, object URL ownership, or accounting are terminal.

Add a dedicated error code such as:

```text
AUDIO_CLEANUP_FAILED
```

The error must include a safe stage-specific message without exposing selected text or audio contents.

### 8.2 Active-player instrumentation

The coordinator shall maintain test-visible counters:

- `activePlayerCount`;
- `maxActivePlayerCount`;
- successful play starts;
- terminal player settlements;
- cleanup failures.

Production behavior must not depend on diagnostics being enabled.

Accounting rules:

1. Increment only when the exact active play attempt is considered started.
2. Settle once using an idempotent guard.
3. Decrement in the same central settlement function.
4. Assert against negative counts.
5. In test mode, fail immediately if the count exceeds one.
6. Do not reset the count on session acceptance.

### 8.3 Supersession semantics

Superseding a non-terminal session shall produce an explicit terminal result for the old session.

Use either:

- an emitted `superseded` event; or
- a `cancelled` event carrying `SESSION_SUPERSEDED`.

The old session’s terminal event must be emitted before the new session’s accepted event, while stale callbacks remain unable to affect the new session.

### 8.4 Playback controls

Control requests from a UI surface shall carry the currently displayed `expectedSessionId`.

- A stale popup must not pause or cancel a newer session.
- Global keyboard shortcuts may intentionally omit the expected ID because they target the current global session.
- Idempotent pause/resume/cancel shall return the authoritative state.
- A failed resume must remain failed and visible.

### 8.5 Pause and transition timing

Inter-chunk waits shall use a deadline or accumulated elapsed-time model that preserves remaining delay accurately across pause/resume.

Required properties:

- time spent paused does not consume the remaining gap;
- cancellation interrupts the gap promptly;
- replacement interrupts the gap promptly;
- repeated pause/resume does not extend or collapse the gap beyond scheduling tolerance;
- no fixed polling interval is the sole source of correctness.

### 8.6 Diagnostics

Test diagnostics shall include:

- session and request IDs;
- source;
- chunk and paragraph positions;
- transition type;
- play-attempt ID;
- active-player count;
- maximum active-player count;
- cleanup stage and result;
- terminal reason;
- sequence number;
- monotonic timestamp.

Diagnostic history may be bounded, but compaction must not remove failures or invariant violations from the retained test record.

---

## 9. Protocol and message validation

### 9.1 Complete runtime guards

Every optional field represented by a TypeScript protocol type shall be validated at runtime.

For `PlaybackEvent`, validate at least:

- `chunkId` is absent or a non-empty string in the expected session/chunk form;
- `transition` is absent or one of `continuation`, `sentence`, `paragraph`, `end`;
- chunk events contain a chunk ID;
- terminal events do not claim impossible active progress;
- status counters are internally consistent;
- error status and terminal state combinations are valid.

### 9.2 Error classification

Unexpected offscreen or coordinator failures shall use an internal error category such as:

```text
INTERNAL_PLAYBACK_ERROR
```

They must not be mislabeled as `INVALID_REQUEST` unless request validation actually failed.

### 9.3 Remove hidden source defaults

`READ_TEXT` shall require an explicit valid source. Missing source must be rejected or handled through a narrowly scoped legacy adapter that records the compatibility path.

It must not silently become `debug-fixture`.

### 9.4 Legacy protocol retirement

Legacy message names may remain only while active UI or command callers still require them. FIX2 shall either:

- migrate all callers to the shared protocol and delete legacy adapters; or
- document each retained legacy message, its caller, and its removal criterion.

There must not be two independently evolving semantic protocols.

---

## 10. Durable status requirements

### 10.1 Ordered persistence

Status persistence shall use a single serialized writer.

Each event/status record shall include:

- `sessionId`;
- `requestId`;
- `sequence`;
- `updatedAtMs` or equivalent monotonic ordering metadata;
- state and structured error.

A write may proceed only if it is newer than the last accepted sequence for that session, and a record from an older session must not replace a newer active session record.

### 10.2 Persistence failures

Storage unavailability or write failure shall:

- be logged with a structured safe diagnostic;
- remain available to popup/Options through status-query response metadata;
- not falsely report that durable state was saved;
- not break active playback.

This is a degraded-observability state, not a silent success.

### 10.3 Restart behavior

After service-worker recreation:

- status query shall recover the authoritative offscreen state;
- stale durable state shall never override a live offscreen response;
- destroyed-offscreen detection shall produce one terminal interruption record;
- subsequent starts shall create a new offscreen document and UUID session;
- popup and Options controls shall work after reopening.

---

## 11. Popup and Options requirements

### 11.1 Typed control helper

Popup and Options shall use a shared typed helper for pause, resume, and cancel.

The helper shall:

- include `expectedSessionId` when appropriate;
- reject runtime transport errors;
- validate `PlaybackControlResponse`;
- expose structured errors;
- update visible state from the authoritative response;
- never use an empty callback that discards failure.

### 11.2 Test-speech lifecycle

Each UI shall track the accepted test session ID.

The test state must terminate on:

- completed;
- cancelled;
- failed;
- superseded;
- offscreen interruption;
- invalid response;
- transport failure.

A test button must not remain disabled after another source replaces its session.

### 11.3 Settings validation and persistence

Stored settings are untrusted input.

On load:

- validate voice as a trimmed string;
- validate and clamp rate through the canonical rate function;
- validate TTS URL syntax and allowed protocols;
- repair only explicitly supported legacy URL shapes;
- record invalid stored values rather than crashing the UI.

On save:

- persist only valid values;
- do not update the “persisted” reference until storage succeeds;
- display a save error and retain a retryable dirty state on failure;
- do not silently discard save promises.

### 11.4 TTS URL editing

Options shall maintain a draft URL and commit only a valid value through an explicit Save action or a clearly bounded validated debounce.

Partial typing must not poison synchronized settings or trigger fetches for every malformed intermediate value.

### 11.5 Voice discovery result

Voice loading shall return a discriminated result:

```ts
export type VoiceDiscoveryResult =
  | { ok: true; voices: VoiceOption[] }
  | { ok: false; error: PlaybackError }
```

The UI shall distinguish:

- valid empty voice set, including a single-speaker model;
- invalid URL;
- timeout;
- network failure;
- HTTP failure;
- non-JSON response;
- invalid response schema.

Voice and readiness endpoint derivation shall use one shared, tested URL helper and correctly handle trailing slashes, nested prefixes, query strings, and fragments.

### 11.6 Accessibility and control state

Controls shall expose disabled state based on authoritative playback state:

- Pause enabled only when pausable;
- Resume enabled only when paused;
- Cancel enabled only when a cancellable session exists.

Visible error/status changes shall use appropriate live regions without replacing structured details with generic messages.

---

## 12. TTS HTTP client requirements

### 12.1 Streaming byte limit

When `Response.body` is available, read through a stream reader.

Algorithm:

1. Validate status and MIME before reading.
2. Reject an excessive declared `Content-Length` immediately.
3. Read chunks while tracking cumulative bytes.
4. If cumulative bytes exceed the limit, cancel the reader and throw `TTS_RESPONSE_TOO_LARGE`.
5. Reject an empty completed body.
6. Combine chunks only after successful bounded completion.

If streaming is unavailable, use a documented bounded fallback only when the platform itself guarantees a suitable cap. Otherwise fail explicitly rather than pretending the limit is enforced.

### 12.2 Request timeouts

Use an abort controller linked to:

- session cancellation/replacement;
- a configured synthesis timeout.

Timeout and user cancellation must remain distinguishable.

Add an error code such as:

```text
TTS_TIMEOUT
```

Readiness and voice discovery shall have shorter independent timeouts.

### 12.3 Response validation

Continue to reject:

- non-HTTP(S) URLs;
- host-play paths;
- non-2xx responses;
- non-audio MIME types;
- empty bodies;
- oversized bodies.

Tests shall include chunked transfer without `Content-Length`, false low `Content-Length`, slow body delivery, and abort during streaming.

---

## 13. Text pipeline requirements

The current normalization, packing, and pacing design remains acceptable. FIX2 shall add regression coverage rather than replace it unnecessarily.

Add cases for at least:

- `The U.S. Army responded.`;
- `Meet at 5 p.m. Monday.`;
- `The U.K. Government announced changes.`;
- `Dr. Élodie spoke.`;
- `123 Main St. near the park.`;
- URLs with multiple query parameters and fragments;
- prose questions followed by text resembling `key=value`;
- non-ASCII sentence starts;
- punctuation adjacent to closing Unicode quotes.

The full `DEBUG_COLLISION_FIXTURE` shall be consumed by:

- pure segmentation/packing tests;
- the Chromium test harness;
- structured listening validation.

The test shall prove semantic text is preserved exactly once after normalization and packing.

---

## 14. Docker service requirements

### 14.1 Fail-fast configuration

Invalid environment configuration shall fail startup with an actionable error. Do not silently convert invalid values to minimums.

Validate:

- positive integer text limit;
- positive integer queue capacity;
- positive finite timeout;
- non-empty model identifier;
- normalized non-empty forced voice values.

### 14.2 Queue-slot ownership

After semaphore acquisition, all subsequent work shall be inside one exception-safe ownership block.

The implementation must release capacity if any of these fail:

- temporary-file creation;
- descriptor close;
- bookkeeping insertion;
- pre-submit voice validation;
- executor submission.

The future callback becomes responsible for release only after successful submission.

### 14.3 Validate voice before queueing

When voices are discoverable, validate the requested voice before queue acquisition and executor submission. Invalid requests must not consume inference capacity.

### 14.4 Temporary-file lifecycle

Track a temporary path until deletion is confirmed.

On deletion failure:

- retain the path in the tracked set;
- record the exception safely;
- retry during shutdown;
- expose a diagnostic count;
- make tests simulate permission and transient deletion failures.

A successful HTTP response may use a background cleanup task, but disconnect and task-failure behavior must be tested.

### 14.5 Readiness and capacity

The readiness contract shall be explicit.

Recommended response:

```json
{
  "ok": true,
  "ready": true,
  "accepting_requests": true,
  "queue_capacity": 4,
  "queue_in_use": 0,
  "worker_busy": false
}
```

If the endpoint remains model-only readiness, rename or document it accordingly and add a separate capacity endpoint. The UI must probe the endpoint that answers whether playback can begin.

### 14.6 Timeout semantics

An in-process thread cannot be safely killed. Therefore:

- HTTP timeout shall return a stable 504;
- the still-running job shall remain visible in queue diagnostics;
- readiness shall report unavailable capacity honestly;
- cleanup shall occur when the job eventually finishes;
- shutdown behavior shall have a bounded policy.

If enforceable hard timeouts are required, run inference in a managed child process and recycle it after a deadline. Do not claim a thread was cancelled when it was not.

### 14.7 Shutdown

Shutdown must not wait forever without evidence.

Define and test:

- graceful wait duration;
- remaining-work behavior after the grace period;
- tempfile retry behavior;
- process termination behavior if process isolation is used.

### 14.8 Error handling

Unexpected server exceptions shall return a stable generic error envelope and be logged server-side. Client responses must not contain stack traces, file paths, selected text, model internals, or secrets.

---

## 15. Manifest and platform requirements

### 15.1 Minimum Chrome version

Declare and document a minimum Chrome version that supports the required offscreen and context APIs, or provide a tested equivalent path.

A process-local `offscreenDocumentKnown` boolean must not be treated as authoritative existence proof on an unsupported platform.

### 15.2 Host permissions

Review `<all_urls>`.

Preferred options:

1. Use `activeTab`/`scripting` for user-invoked selection capture and request optional host access for the configured TTS origin.
2. If broad host permission is retained, document that it is required for arbitrary configured TTS endpoints—not merely selection capture—and justify the Chrome Web Store posture.

### 15.3 Privacy

Do not log:

- selected text;
- test text;
- audio bytes;
- complete request bodies;
- credentials embedded in endpoint URLs.

User-visible errors shall redact URL userinfo and sensitive query values.

---

## 16. CI and dependency requirements

### 16.1 Dependency installation

Remove `--legacy-peer-deps` unless a documented, tested compatibility exception remains unavoidable.

If it remains temporarily:

- document the exact conflict;
- pin the compatible versions;
- add an issue/removal criterion;
- prove the build and Chromium behavior with that combination.

### 16.2 Coverage thresholds

Define focused coverage thresholds for:

- playback coordinator;
- protocol guards;
- text normalization;
- segmentation;
- chunk packing;
- pacing;
- TTS client;
- service-worker routing.

Thresholds must fail CI when coverage regresses. Codecov upload alone is not a gate.

### 16.3 GitHub Actions integrity

Pin third-party actions to immutable commit SHAs for release-quality workflows, with comments naming the tracked release.

The CI status publisher shall compare both workflow run ID and run attempt so an older rerun attempt cannot publish mixed or stale data.

### 16.4 Real Docker gate

Add a bounded real-image validation workflow or documented manual release gate that:

- builds with `--no-cache`;
- starts the actual image;
- waits for the real model;
- exercises endpoints and real synthesis;
- inspects loopback binding;
- checks temporary files;
- recreates the container and verifies cache reuse;
- retains logs and structured evidence.

This gate may be scheduled or manually dispatched if model size makes every-push execution impractical, but release completion requires a successful run for the exact candidate SHA.

---

## 17. Required automated tests

### 17.1 Coordinator unit tests

Add tests for:

- three or more rapid starts;
- stale `ended` and stale `error` callbacks;
- duplicate `ended` callbacks;
- `error` followed by `ended`;
- synchronous `play()` throw;
- rejected `play()` promise;
- cleanup failure during pause;
- cleanup failure during source clearing;
- exact-once object URL revocation;
- cancel during synthesis;
- cancel during playback;
- cancel during a transition gap;
- pause during synthesis;
- pause during playback;
- pause halfway through a transition gap;
- repeated pause/resume;
- replacement while paused;
- failed resume;
- superseded terminal event ordering;
- maximum active-player count never exceeding one.

### 17.2 Protocol tests

Add malformed cases for every optional field and impossible field combination. Guards must reject structurally invalid events rather than partially narrowing them.

### 17.3 UI tests

Popup and Options tests shall cover:

- control success and structured failure;
- stale expected session ID;
- superseded test speech clearing the disabled state;
- status restoration failure;
- settings load failure;
- settings save failure and retry;
- invalid stored rate/voice/URL;
- valid empty voice list;
- voice timeout/network/HTTP/schema errors;
- URL draft not persisted until valid commit;
- control enable/disable state.

### 17.4 TTS client tests

Add:

- chunked body under limit;
- chunked body over limit;
- false low `Content-Length` with larger stream;
- no `Content-Length`;
- slow headers/body timeout;
- user abort distinct from timeout;
- reader cancellation after limit;
- endpoint derivation with prefixes, trailing slash, query, and fragment.

### 17.5 Server tests

Add:

- invalid environment startup failures;
- tempfile creation failure releases queue slot;
- descriptor-close failure releases queue slot;
- executor-submit failure releases queue slot;
- invalid voice does not acquire a slot;
- deletion failure remains tracked;
- deletion retry succeeds;
- readiness reports queue saturation;
- timed-out work remains represented until completion;
- shutdown bounded behavior;
- unexpected exception stable envelope;
- client disconnect cleanup where testable.

---

## 18. Required Chromium scenarios

The unpacked-extension harness shall use the actual extension topology and the full collision fixture.

Required scenarios:

1. normal reading → popup test replacement;
2. popup test → Options test replacement;
3. Options test → normal reading replacement;
4. at least five rapid starts from mixed sources;
5. pause/resume/cancel through popup;
6. stale popup attempts to control a newer session;
7. rejected `play()` path;
8. media error path;
9. worker termination during synthesis;
10. worker termination during playback;
11. reopen popup after worker recreation;
12. Pause, Resume, and Cancel through the recreated worker;
13. continuation, sentence, and paragraph pacing at rates `0.5`, `1`, `2`, `4`, and `10`;
14. no overlap according to actual active-player instrumentation;
15. no omission, duplication, or reordering of fixture text;
16. unique session IDs across restart.

The harness shall fail when:

- `activePlayerCount > 1`;
- player accounting becomes negative;
- a superseded session completes;
- a UI remains stuck in sending state;
- a gap falls below its configured minimum minus a documented scheduling tolerance;
- a stale control mutates the current session.

---

## 19. Real Docker validation

For the exact candidate SHA:

```bash
docker compose -f docker/docker-compose.yml down -v
docker compose -f docker/docker-compose.yml build --no-cache
docker compose -f docker/docker-compose.yml up -d
```

Evidence shall include:

- image digest;
- effective Compose configuration;
- process user;
- host socket binding;
- model and voice list;
- first-start model initialization timing;
- successful real WAV synthesis;
- MIME and non-empty byte validation;
- invalid voice, empty text, oversized text, overload, and timeout responses;
- temporary-file observations before, during, and after requests;
- queue/readiness observations;
- container recreation without deleting the volume;
- proof that the second start reused cached model data;
- final container logs and clean shutdown.

Do not call mocked `TestClient` execution “real Docker validation.”

---

## 20. Structured listening validation

Human listening is required because automated timing cannot prove that seams sound natural.

Use `DEBUG_COLLISION_FIXTURE` and record, for each tested voice and rate:

- exact SHA;
- browser and platform;
- model and voice;
- playback rate;
- chunk count and text boundaries;
- continuation, sentence, and paragraph timestamps;
- whether any overlap was heard;
- whether text was omitted or repeated;
- whether sentence seams sounded collided;
- whether paragraph pauses were clearly distinct;
- any pronunciation or segmentation defect;
- pass/fail judgment.

Required rates:

```text
0.5, 1, 2, 4, 10
```

At least one normal voice from the configured VCTK model must be tested. Additional voices are encouraged.

---

## 21. Documentation and evidence requirements

FIX2 completion shall update:

- the FIX2 TODO;
- the original playback-hardening TODO with cross-reference or accurate completion state;
- the implementation report and addendum;
- root README;
- Docker README;
- docs index;
- CI-status bridge documentation if rerun-attempt logic changes.

The final evidence record shall include:

- exact final SHA;
- clean-tree status;
- Node, npm, Chrome, Python, Docker, and Compose versions;
- all validation commands and exit codes;
- CI run/job/artifact identifiers;
- real Docker evidence;
- listening evidence;
- secret and obsolete-reference search results;
- documented accepted limitations.

Historical pre-FIX1 environment evidence that was never recorded shall be labeled unavailable. It must not be fabricated or recreated under a false date.

---

## 22. Prohibited implementations

The following are prohibited unless this specification is explicitly amended:

- starting replacement audio after uncertain cleanup;
- empty `catch` blocks on invariant-critical operations;
- `.catch(() => undefined)` on user-visible state restoration;
- empty runtime callbacks that discard control failures;
- returning `[]` for every voice-discovery failure;
- defaulting malformed internal messages to debug behavior;
- optimistic settings state that is marked persisted before storage succeeds;
- full-body buffering presented as a hard response-size limit;
- semaphore acquisition without exception-safe ownership transfer;
- removing a tempfile from tracking before deletion is confirmed;
- claiming timed-out thread work was cancelled;
- an overlap test that resets active state on acceptance;
- weakening assertions or increasing timing tolerances solely to make CI green;
- adding another player or host-audio fallback;
- treating mocked service tests as real-model evidence;
- declaring the original TODO complete while required manual/runtime evidence is absent.

---

## 23. Acceptance criteria

FIX2 is complete only when all of the following are true for one exact commit:

1. Lint, strict typecheck, unit tests, coverage thresholds, production build, diagnostic build, manifest validation, mocked server tests, Compose validation, and Chromium tests pass.
2. Actual test-build active-player instrumentation never exceeds one in the complete Chromium scenario matrix.
3. Audio cleanup fails closed and every cleanup-failure stage has a regression test.
4. Popup and Options surface control, status, settings, voice, and supersession failures.
5. Durable status persistence is serialized and monotonic.
6. TTS responses are stream-limited and synthesis/probe requests time out explicitly.
7. Server queue capacity and tempfile tracking remain correct across every injected exceptional path.
8. Readiness semantics accurately include accepting-work state or are renamed and split clearly.
9. The full collision fixture passes segmentation, packing, Chromium, and listening validation.
10. The real Docker image and real model pass endpoint, synthesis, loopback, cleanup, overload, timeout, recreation, and cache-reuse validation.
11. Dependency conflicts and `--legacy-peer-deps` are removed or explicitly documented as a temporary tracked exception.
12. GitHub Actions and status publishing are hardened, including rerun-attempt handling.
13. Documentation and TODO state match the evidence.
14. No secret, private key, bearer token, API key, host-play path, obsolete player, or silent-failure pattern remains in the active production path without an explicit reviewed justification.
15. The repository is clean at the exact validated SHA.

Until these criteria are met, the correct status is:

> **FIX1 architecture retained; FIX2 corrective hardening and final runtime sign-off incomplete.**

---

## 24. Expected primary files

Likely modified files include:

### Extension runtime

- `src/offscreen/playback-coordinator.ts`
- `src/offscreen.ts`
- `src/background/service-worker.ts`
- `src/lib/playback-protocol.ts`
- `src/lib/messaging.ts`
- `src/lib/tts-client.ts`
- `src/lib/storage.ts`
- `src/lib/voices.ts`
- `src/lib/text-segmentation.ts`
- `src/lib/debug-fixtures.ts`
- `src/popup/Popup.tsx`
- `src/options/Options.tsx`
- `src/manifest.ts`

### Extension tests

- `src/offscreen/playback-coordinator.test.ts`
- `src/offscreen.test.ts`
- `src/background/service-worker.test.ts`
- `src/lib/playback-protocol.test.ts`
- `src/lib/tts-client.test.ts`
- `src/lib/storage.test.ts`
- `src/lib/text-segmentation.test.ts`
- `src/lib/chunk-packing.test.ts`
- `src/popup/Popup.test-speech.test.tsx`
- `src/popup/Popup.ui.test.tsx`
- `src/options/Options.test-speech.int.test.tsx`
- `src/options/Options.ui.test.tsx`
- `scripts/chromium-e2e.mjs`

### Server

- `docker/coqui-local/app.py`
- `docker/coqui-local/tests/test_app.py`
- `docker/coqui-local/Dockerfile`
- `docker/coqui-local/requirements.txt`
- `docker/docker-compose.yml`

### Build, CI, and documentation

- `vite.config.ts` or a dedicated `vitest.config.ts`
- `package.json`
- `package-lock.json`
- `.github/workflows/ci.yml`
- `.github/workflows/publish-ci-status.yml`
- optional real-Docker validation workflow
- `README.md`
- `docker/coqui-local/README.md`
- `docs/README.md`
- original playback-hardening TODO and implementation reports

This list is guidance, not permission to modify unrelated files or preserve obsolete compatibility layers.