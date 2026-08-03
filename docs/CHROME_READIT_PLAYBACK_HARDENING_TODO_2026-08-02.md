# Chrome Read It Playback Hardening TODO

**Document:** `docs/CHROME_READIT_PLAYBACK_HARDENING_TODO_2026-08-02.md`  
**Status:** Ready for implementation  
**Date:** 2026-08-02  
**Repository:** `ekkus93/chrome_readit`  
**Baseline reviewed:** `564de25e3eb885000bb9fd9fd870d8e54d3854e8` (`master`)  
**Governing specification:** `docs/CHROME_READIT_PLAYBACK_HARDENING_SPEC_2026-08-02.md`

> **Historical status — 2026-08-03:** Superseded by the FIX2 TODO. Candidate `31702133a5afd326902aa8f5bdfb6e2afe5dfe28` passed automated and real-Coqui validation, but human listening is `NOT RUN`; this predecessor is not a completion claim.

---

## 1. Goal

Implement the playback architecture defined in the companion specification and eliminate:

1. simultaneous browser audio sources;
2. simultaneous Docker-host playback processes;
3. sentences that sound fused because independently synthesized files have inadequate handoff gaps;
4. service-worker restart stalls and playback-token collisions;
5. stale completion events advancing the wrong queue;
6. temporary-file, inference-concurrency, endpoint-exposure, and dependency-reproducibility defects in the Docker TTS service;
7. obsolete and competing playback implementations.

The work is complete only after automated and real Chrome validation proves the single-player invariant and restart-safe queue behavior.

---

## 2. Ralph-loop implementation contract

For every block below:

1. inspect the current implementation before editing;
2. add or update tests that fail for the targeted defect;
3. implement the smallest coherent correction;
4. run the block’s focused tests;
5. run the repository quality gates;
6. inspect the diff for unrelated changes;
7. update this TODO with exact evidence;
8. commit the completed block with a focused message;
9. do not mark a task complete based only on code inspection;
10. do not claim browser, Docker, restart, or audio-timing behavior without corresponding runtime evidence.

Required recurring extension gates after relevant blocks:

```bash
npm ci
npm run lint
npm run typecheck
npm test -- --run
npm run build
```

Required recurring server gates after relevant blocks:

```bash
python -m pytest docker/coqui-local/tests

docker compose -f docker/docker-compose.yml config
```

Use the project’s chosen Python environment tooling if a dedicated server test environment is added. Record the exact command actually used.

---

## 3. Global implementation rules

- [ ] Preserve only one production playback coordinator.
- [ ] Do not create a second emergency `Audio()` path to work around failures.
- [ ] Do not use successful message dispatch as proof of playback completion.
- [ ] Do not retain numeric process-local IDs as cross-context playback identities.
- [ ] Do not keep `/api/tts/play` in the normal extension workflow.
- [ ] Do not weaken cancellation, stale-session, or failure visibility to make tests pass.
- [ ] Do not add fixed sleeps to hide ordering races in tests.
- [ ] Do not log selected text or audio payloads.
- [ ] Do not broaden Chrome permissions as part of this work.
- [ ] Remove obsolete code only after reference searches and build/test proof.
- [ ] Keep all new message and state shapes strictly typed and runtime-guarded.
- [ ] Keep test-only timing overrides isolated from production code.

---

# Block 0 — Baseline, reproduction, and evidence harness

## Task 0.1 — Record the exact starting state

**Files:**

- this TODO;
- optional implementation report under `docs/` if the project’s workflow uses one.

### Subtasks

- [ ] Record the starting commit SHA.
- [ ] Record Node, npm, Chrome/Chromium, Docker, Docker Compose, Python, and platform versions used for validation.
- [ ] Run the existing lint, test, and build commands before modifying playback code.
- [ ] Record whether each command passes, fails, hangs, or emits unsupported-engine warnings.
- [ ] Run `docker compose -f docker/docker-compose.yml config` and preserve the effective port and volume configuration.
- [ ] Search the repository for all playback creation and host-playback paths:

```bash
git grep -n "new Audio\|AudioContext\|speechSynthesis\|/api/tts/play\|paplay\|aplay\|OFFSCREEN_PLAY_AUDIO\|PLAYBACK_FINISHED"
```

- [ ] Record every active caller and every apparently orphaned implementation.

### Acceptance criteria

- [ ] The baseline is reproducible from exact commands.
- [ ] Existing failures are not incorrectly attributed to the new changes.
- [ ] Every potential audio-producing path is enumerated.

---

## Task 0.2 — Add a deterministic collision fixture

**Primary files:**

- `src/lib/debug-fixtures.ts`;
- focused test fixture file if cleaner;
- future Chromium test page.

### Fixture requirements

Include text that exercises:

- multiple short sentences that should be packed;
- a semicolon that must remain inside a sentence unit;
- a paragraph boundary;
- a decimal such as `3.14`;
- a version such as `1.2.3`;
- a domain such as `example.com`;
- a URL;
- `Dr.`, `Mr.`, `U.S.`, `A.I.`, `a.m.`, `p.m.`;
- `St.`, `Jr.`, and `Sr.` in both continuation and sentence-ending positions;
- quoted terminal punctuation;
- an ellipsis;
- one sentence longer than the hard chunk maximum.

### Subtasks

- [ ] Add the fixture without embedding private/user-selected content.
- [ ] Make the fixture invokable through the normal playback protocol in development builds.
- [ ] Ensure the fixture is also consumed by pure segmentation/chunking tests.
- [ ] Add event logging sufficient to distinguish:
  - two players active at once;
  - sequential chunks with an inadequate gap;
  - a stalled queue;
  - a repeated or missing chunk.

### Acceptance criteria

- [ ] One fixture deterministically exercises all critical boundaries.
- [ ] Development logs identify session, chunk, transition, and timing without logging full text.

---

# Block 1 — Immediate true-overlap containment

This block removes confirmed overlap paths before the larger queue migration.

## Task 1.1 — Prevent repeated popup test speech from overlapping

**Primary file:** `src/popup/Popup.tsx`

### Preferred implementation

Route popup test speech through the normal coordinator protocol immediately if feasible.

### Temporary containment only if protocol work is not yet available

If this task must precede the coordinator migration:

- [ ] retain the current test `Audio` element and object URL in refs;
- [ ] before starting a new test:
  - [ ] pause the prior element;
  - [ ] clear handlers;
  - [ ] clear `src`;
  - [ ] revoke its object URL;
  - [ ] clear refs;
- [ ] clean up on popup unmount;
- [ ] ensure failures clean up the object URL;
- [ ] prevent duplicate clicks while the same request is in flight.

### Tests

- [ ] Click “Try speech” twice and verify the first player is stopped before the second starts.
- [ ] Unmount during playback and verify cleanup.
- [ ] Verify rejected playback does not leave a retained player or URL.

### Acceptance criteria

- [ ] Popup test speech cannot create two audible players.
- [ ] Any temporary local-player implementation is deleted in Block 5.

---

## Task 1.2 — Prevent repeated Options test speech from overlapping

**Primary file:** `src/options/Options.tsx`

### Subtasks

- [ ] stop and clean up `testAudioRef.current` before replacing it;
- [ ] track and revoke the active test object URL;
- [ ] clear the player on component unmount;
- [ ] ensure the normal Stop control also stops temporary test audio until unification is complete;
- [ ] prevent a stale `onended` callback from changing the status of a newer test;
- [ ] add a per-test token if temporary local playback remains.

### Tests

- [ ] second test stops first test before playing;
- [ ] Stop neutralizes the local test player;
- [ ] stale `onended` from the old player is ignored;
- [ ] unmount revokes the URL.

### Acceptance criteria

- [ ] Options test speech cannot overlap itself or ignore Stop.
- [ ] Any temporary local-player implementation is deleted in Block 5.

---

## Task 1.3 — Migrate and prohibit `/api/tts/play`

**Primary files:**

- `src/lib/storage.ts`;
- storage tests;
- request validation helper;
- `docker/coqui-local/app.py`;
- `docker/docker-compose.yml`.

### Subtasks

- [ ] add a pure URL migration helper;
- [ ] detect a stored path ending in `/api/tts/play`;
- [ ] migrate it to the sibling `/api/tts` URL;
- [ ] persist the corrected value exactly once;
- [ ] handle query strings and trailing slashes deterministically;
- [ ] reject any normal start request still targeting a host-play endpoint;
- [ ] add tests for:
  - [ ] default URL;
  - [ ] legacy `/api/tts/play`;
  - [ ] prefixed path such as `/local/tts/api/tts/play`;
  - [ ] query parameters;
  - [ ] malformed URL;
- [ ] make `PLAY_ON_HOST=0` actually disable host-play endpoints if they temporarily remain;
- [ ] default debug/host-play endpoints to disabled.

### Acceptance criteria

- [ ] The extension cannot send normal playback to `/api/tts/play`.
- [ ] Existing users with the stale URL are repaired automatically.
- [ ] Host playback is unavailable by default.

---

## Task 1.4 — Reject non-audio and empty TTS responses centrally

**Primary files:**

- current TTS fetch helper;
- future coordinator synthesis helper;
- tests.

### Subtasks

- [ ] require a successful HTTP status;
- [ ] require `Content-Type` beginning with `audio/`;
- [ ] require non-empty bytes;
- [ ] impose a maximum response size;
- [ ] return stable error codes for HTTP, non-audio, empty, and oversized responses;
- [ ] do not create an object URL for invalid content.

### Acceptance criteria

- [ ] A JSON response from `/api/tts/play` can never reach an audio player.
- [ ] The UI receives a useful structured error.

---

# Block 2 — Shared playback protocol and offscreen coordinator foundation

## Task 2.1 — Define strict shared protocol types

**New primary file:** `src/lib/playback-protocol.ts`

### Required types

- [ ] `StartPlaybackRequest`;
- [ ] `StartPlaybackResponse`;
- [ ] `PlaybackControlRequest`;
- [ ] `PlaybackControlResponse`;
- [ ] `PlaybackStatusRequest`;
- [ ] `PlaybackStatus`;
- [ ] `PlaybackEvent`;
- [ ] `PlaybackError` and stable error codes;
- [ ] runtime guards for every cross-context message.

### Requirements

- [ ] use string UUIDs for request/session IDs;
- [ ] distinguish request acceptance from playback completion;
- [ ] include playback source (`selection`, `popup-test`, `options-test`, `debug-fixture`);
- [ ] support optional expected session ID on controls;
- [ ] reject malformed messages without throwing;
- [ ] replace duplicated string literals in existing modules.

### Tests

- [ ] valid message shapes accepted;
- [ ] missing/incorrect fields rejected;
- [ ] unknown commands rejected;
- [ ] no broad `as Record<string, unknown>` logic remains at call sites where a guard should be used.

### Acceptance criteria

- [ ] All playback contexts import one protocol definition.
- [ ] Dispatch success and playback completion are unambiguously different concepts.

---

## Task 2.2 — Create the offscreen playback coordinator

**Suggested new file:** `src/offscreen/playback-coordinator.ts`  
**Modified entry:** `src/offscreen.ts`

### State model

Implement one coordinator instance with:

- [ ] active session or `null`;
- [ ] session state enum;
- [ ] normalized text metadata;
- [ ] chunk list;
- [ ] current chunk index;
- [ ] active synthesis request;
- [ ] one prefetched request;
- [ ] AbortControllers;
- [ ] current audio source;
- [ ] current object URL;
- [ ] pause state;
- [ ] remaining transition delay;
- [ ] bounded diagnostic event history.

### Subtasks

- [ ] initialize idempotently;
- [ ] register one runtime listener;
- [ ] accept `START_PLAYBACK` and return promptly with a UUID session ID;
- [ ] atomically supersede any previous session;
- [ ] implement `pause`, `resume`, and `cancel`;
- [ ] implement status query;
- [ ] emit status changes to live extension UI contexts without depending on them being open;
- [ ] keep queue work inside the offscreen document;
- [ ] do not depend on a service-worker-held promise to start the next chunk.

### Acceptance criteria

- [ ] The coordinator can run a mocked multi-chunk session independently of service-worker module state.
- [ ] Repeated initialization does not register duplicate listeners.

---

## Task 2.3 — Implement stop-before-replace atomically

**Primary coordinator/player files**

### Required ordering

For a new start request:

1. mark old session superseded;
2. abort old fetches;
3. invalidate old callback tokens;
4. pause/stop current source;
5. clear handlers and `src`;
6. revoke old object URL;
7. clear old state;
8. accept and initialize new session;
9. begin new synthesis/playback.

### Tests

- [ ] capture an ordered call trace;
- [ ] prove old pause/stop occurs before new `play()`;
- [ ] trigger old `ended`, `error`, and rejected-play callbacks after replacement and prove they cannot affect the new session;
- [ ] repeat start rapidly three or more times and prove only the final session plays.

### Acceptance criteria

- [ ] No replacement path can leave two audible sources active.
- [ ] Stale callbacks are harmless.

---

## Task 2.4 — Make audio lifecycle leak-free

### Subtasks

- [ ] centralize player creation and cleanup;
- [ ] revoke every object URL exactly once;
- [ ] call `pause()` and clear `src` on stop;
- [ ] call `load()` when appropriate to release media resources;
- [ ] detach event handlers;
- [ ] handle synchronous `play()` exceptions and rejected promises;
- [ ] handle `error` and `ended` races idempotently;
- [ ] ensure cleanup works with no active player;
- [ ] ensure repeated Stop is safe.

### Optional WebAudio decision

- [ ] decide whether to delete WebAudio fallback or adopt it into the coordinator;
- [ ] if retained:
  - [ ] fully neutralize HTMLAudio before fallback;
  - [ ] make fallback startup idempotent;
  - [ ] support pause/resume/cancel;
  - [ ] close `AudioContext` on every terminal path;
  - [ ] add explicit one-source tests.

### Acceptance criteria

- [ ] Object URL, element, handler, and optional context lifecycle tests pass.
- [ ] The simplest valid single-player design is preferred.

---

# Block 3 — Text segmentation, packing, and pacing

## Task 3.1 — Extract text normalization into a pure module

**New suggested file:** `src/lib/text-normalization.ts`

### Subtasks

- [ ] normalize line endings;
- [ ] normalize non-breaking spaces;
- [ ] collapse horizontal whitespace;
- [ ] preserve blank-line paragraph boundaries;
- [ ] normally convert single line breaks to spaces;
- [ ] trim text;
- [ ] count Unicode code points safely;
- [ ] enforce the configured maximum selected-text length;
- [ ] return structured metadata such as paragraph count and truncation/error status.

### Tests

- [ ] CRLF, CR, and LF;
- [ ] blank lines;
- [ ] wrapped single-line breaks;
- [ ] non-breaking spaces;
- [ ] empty normalized input;
- [ ] maximum-length boundary;
- [ ] astral Unicode/code-point counting.

### Acceptance criteria

- [ ] Service-worker and coordinator code do not carry ad-hoc normalization logic.

---

## Task 3.2 — Implement robust sentence segmentation

**New suggested file:** `src/lib/text-segmentation.ts`

### Subtasks

- [ ] use `Intl.Segmenter` when available;
- [ ] implement a deterministic fallback;
- [ ] preserve terminal quotes/brackets;
- [ ] stop treating semicolons as sentence endings;
- [ ] protect decimals;
- [ ] protect semantic versions;
- [ ] protect domains;
- [ ] protect URLs and email addresses;
- [ ] protect common titles and abbreviations;
- [ ] protect dotted initialisms;
- [ ] protect time abbreviations;
- [ ] handle ellipses;
- [ ] distinguish `St.`, `Jr.`, and `Sr.` continuation from actual sentence endings;
- [ ] preserve original punctuation in segment text;
- [ ] ensure no empty segments.

### Required regression examples

- [ ] `The value is 3.14. Continue.`
- [ ] `Version 1.2.3 is current. Upgrade later.`
- [ ] `Visit example.com. Then return.`
- [ ] a full `https://` URL followed by a sentence;
- [ ] an email address;
- [ ] `Dr. Smith spoke to Mr. Jones.`
- [ ] `The U.S. policy changed.`
- [ ] `We visited the U.S. It was memorable.`
- [ ] `Meet at 5 p.m. today.`
- [ ] `I live on Main St. It is quiet.`
- [ ] `St. Louis is large.`
- [ ] `John Smith Jr. arrived.`
- [ ] `He is John Smith Jr. He arrived.`
- [ ] quoted and parenthesized endings;
- [ ] ellipsis continuation and ellipsis ending;
- [ ] semicolon joining clauses.

### Acceptance criteria

- [ ] The segmentation module has no browser-extension dependencies.
- [ ] Existing abbreviation tests remain covered or are superseded by stronger tests.

---

## Task 3.3 — Implement sentence packing

**New suggested file:** `src/lib/chunk-packing.ts`

### Defaults

```ts
const TARGET_CHUNK_CHARS = 280
const SOFT_MAX_CHUNK_CHARS = 400
const HARD_MAX_CHUNK_CHARS = 500
```

### Subtasks

- [ ] pack adjacent complete sentences within one paragraph;
- [ ] never cross paragraph boundaries;
- [ ] prefer chunks near the target size;
- [ ] allow smaller chunks when paragraph boundaries require them;
- [ ] split oversized single sentences at ranked clause/whitespace boundaries;
- [ ] use hard cuts only as a last resort;
- [ ] emit metadata:
  - [ ] paragraph index;
  - [ ] chunk index in paragraph;
  - [ ] global chunk index;
  - [ ] transition after;
  - [ ] forced-split indicator;
- [ ] guarantee no chunk exceeds the hard maximum unless a documented Unicode edge case makes it unavoidable;
- [ ] preserve all normalized text exactly once, modulo intended whitespace normalization.

### Tests

- [ ] three short sentences become one chunk;
- [ ] next sentence exceeding soft max starts a new chunk;
- [ ] paragraph always forces a new chunk;
- [ ] long sentence clause split;
- [ ] long unbroken token fallback;
- [ ] reconstruction property test: concatenated semantic text equals normalized input under documented whitespace rules;
- [ ] no empty chunks;
- [ ] transition metadata correct.

### Acceptance criteria

- [ ] The ordinary case is no longer one TTS request per sentence.

---

## Task 3.4 — Implement bounded pacing

**New suggested file:** `src/lib/playback-pacing.ts`

### Initial constants

```ts
const BASE_CONTINUATION_GAP_MS = 60
const BASE_SENTENCE_GAP_MS = 180
const BASE_PARAGRAPH_GAP_MS = 550

const MIN_CONTINUATION_GAP_MS = 35
const MIN_SENTENCE_GAP_MS = 120
const MIN_PARAGRAPH_GAP_MS = 350
```

### Subtasks

- [ ] implement bounded sublinear rate scaling;
- [ ] clamp invalid rates through one shared rate helper;
- [ ] return zero for `end`;
- [ ] distinguish continuation/sentence/paragraph;
- [ ] implement a cancellable, pausable transition timer in the coordinator;
- [ ] freeze and resume remaining delay accurately;
- [ ] interrupt delay immediately on cancel/supersede.

### Tests

- [ ] rates `0.5`, `1`, `2`, `4`, and current maximum;
- [ ] minimums never violated;
- [ ] paragraph always exceeds sentence gap;
- [ ] sentence always exceeds continuation gap under supported rates;
- [ ] pause halfway through a gap preserves remaining time;
- [ ] cancel during gap starts no next chunk.

### Acceptance criteria

- [ ] High playback rates cannot collapse sentence/paragraph transitions to near-zero values.

---

# Block 4 — Synthesis queue and authoritative completion

## Task 4.1 — Move TTS fetching into the coordinator

**Primary coordinator and synthesis helper files**

### Subtasks

- [ ] move current and prefetched fetch ownership out of the service worker;
- [ ] permit no more than one current and one prefetched request;
- [ ] tie every fetch to session AbortControllers;
- [ ] abort on cancel/supersede;
- [ ] classify transient and terminal errors;
- [ ] optionally retry a failed prefetch once when it becomes current;
- [ ] enforce request and response size bounds;
- [ ] validate audio MIME and bytes centrally;
- [ ] keep voice, rate, and URL immutable for one accepted session unless a future explicit live-update design is added.

### Tests

- [ ] one-ahead limit;
- [ ] no out-of-order playback when second fetch completes first;
- [ ] aborted fetch is not logged as unexpected failure;
- [ ] failed current synthesis fails session;
- [ ] failed prefetch retry behavior;
- [ ] cancellation aborts both requests.

### Acceptance criteria

- [ ] The service worker no longer owns synthesis promises needed for queue progression.

---

## Task 4.2 — Make player completion the only queue-advance signal

### Subtasks

- [ ] define internal completion event with exact session/chunk ID;
- [ ] treat command response only as accepted/rejected dispatch;
- [ ] advance only on active player `ended` success;
- [ ] fail only on active player terminal failure;
- [ ] ignore stale or duplicate completion;
- [ ] make completion handling idempotent;
- [ ] remove global singleton `pendingPlaybackAck` from the service worker;
- [ ] remove acknowledgement replacement semantics no longer needed after queue migration.

### Tests

- [ ] dispatch accepted but no `ended`: queue does not advance;
- [ ] stale `ended`: queue does not advance;
- [ ] duplicate `ended`: advances once;
- [ ] `error` then `ended`: one terminal result;
- [ ] replacement during current playback: old completion ignored;
- [ ] completion while paused cannot accidentally start the next chunk before resume if pause state requires a gap.

### Acceptance criteria

- [ ] Queue ordering has one auditable completion contract.

---

## Task 4.3 — Make start requests non-blocking for UI callers

**Primary files:**

- `src/background/service-worker.ts`;
- popup/options request helpers;
- protocol tests.

### Subtasks

- [ ] return start acceptance promptly with session ID;
- [ ] do not hold a runtime message response open for the entire reading;
- [ ] expose status separately;
- [ ] make popup/options show accepted/playing/failed state from status events or queries;
- [ ] ensure keyboard/context-menu starts still log terminal failures locally even without a UI caller waiting.

### Acceptance criteria

- [ ] Long reading does not depend on one long-lived `sendResponse` channel.
- [ ] Popup closure does not affect playback.

---

# Block 5 — Unify all user-facing playback

## Task 5.1 — Route selection reading through the coordinator

**Primary file:** `src/background/service-worker.ts`

### Subtasks

- [ ] retain text-only selection capture;
- [ ] validate supported tab and selected text;
- [ ] load and migrate settings;
- [ ] ensure offscreen document;
- [ ] send `START_PLAYBACK`;
- [ ] return accepted session ID or structured error;
- [ ] delete the service-worker chunk loop and state after coordinator coverage is complete;
- [ ] delete process-local session counters and pending acknowledgement state;
- [ ] keep offscreen creation race protection.

### Tests

- [ ] selection capture and start request;
- [ ] no selection;
- [ ] unsupported page;
- [ ] offscreen creation race;
- [ ] coordinator rejection surfaced;
- [ ] no audio data is base64-routed through the service worker if the coordinator fetches directly.

### Acceptance criteria

- [ ] The service worker is a short-lived router, not the queue owner.

---

## Task 5.2 — Route popup test speech through the coordinator

**Primary file:** `src/popup/Popup.tsx`

### Subtasks

- [ ] replace `request-tts` plus local `Audio` with `START_PLAYBACK` source `popup-test`;
- [ ] delete base64 decoding and object URL creation from popup;
- [ ] display coordinator status;
- [ ] make Pause/Resume/Cancel target the active coordinator session;
- [ ] disable or update controls based on status;
- [ ] show structured errors;
- [ ] remove temporary containment refs from Task 1.1.

### Acceptance criteria

- [ ] Popup contains no TTS audio-player implementation.

---

## Task 5.3 — Route Options test speech through the coordinator

**Primary file:** `src/options/Options.tsx`

### Subtasks

- [ ] replace local player with source `options-test`;
- [ ] remove audio sniffing duplicated from the background/coordinator;
- [ ] remove test `Audio` and object URL refs;
- [ ] use shared status and controls;
- [ ] keep server connectivity testing separate from audible test speech;
- [ ] remove temporary containment code from Task 1.2.

### Acceptance criteria

- [ ] Options contains no TTS audio-player implementation.

---

## Task 5.4 — Unify controls and status

**Primary files:**

- popup;
- options;
- service worker;
- protocol;
- coordinator.

### Subtasks

- [ ] Pause applies during audio, synthesis, and transition gaps;
- [ ] Resume is idempotent;
- [ ] Cancel is idempotent and terminal;
- [ ] keyboard shortcuts use the same control message;
- [ ] popup/options buttons use the same control message;
- [ ] status reports current and total chunks/paragraphs;
- [ ] status after replacement reports only the active session;
- [ ] optional `expectedSessionId` prevents stale UI controls from stopping a newer session;
- [ ] reopening popup/options queries and displays current state.

### Acceptance criteria

- [ ] Every control surface operates the same active player.

---

# Block 6 — Restart safety and offscreen lifecycle

## Task 6.1 — Eliminate restart-sensitive tokens

### Subtasks

- [ ] use `crypto.randomUUID()` session IDs;
- [ ] derive chunk IDs from session UUID plus chunk index;
- [ ] remove reliance on `nextSessionId = 1`;
- [ ] remove the recent-token workaround if no longer needed;
- [ ] retain idempotence for duplicate internal commands;
- [ ] add tests that recreate/reimport the service-worker module and begin another session without ID collision.

### Acceptance criteria

- [ ] A worker restart cannot cause a new chunk to be mistaken for an old duplicate.

---

## Task 6.2 — Prove queue progression without the service worker

### Subtasks

- [ ] start a multi-chunk session;
- [ ] dispose/reinitialize the service-worker module or use a real extension worker termination test;
- [ ] prove offscreen starts subsequent chunks;
- [ ] restore the worker and query current status;
- [ ] route Pause/Resume/Cancel successfully after restoration.

### Acceptance criteria

- [ ] Active playback does not require service-worker in-memory promises.

---

## Task 6.3 — Handle offscreen interruption explicitly

### Subtasks

- [ ] define behavior when the offscreen document is destroyed;
- [ ] ensure callers do not hang;
- [ ] return/report `OFFSCREEN_INTERRUPTED`;
- [ ] allow a subsequent new start to recreate the document cleanly;
- [ ] do not claim automatic mid-chunk recovery unless it is actually implemented and tested.

### Acceptance criteria

- [ ] Offscreen loss is visible and recoverable for the next request.

---

# Block 7 — Docker TTS service hardening

## Task 7.1 — Bind the service to loopback by default

**Primary file:** `docker/docker-compose.yml`

### Subtasks

- [ ] change port publication to `127.0.0.1:5002:5002`;
- [ ] document how to opt into remote binding explicitly;
- [ ] add a configuration test or script that fails if the default mapping becomes `0.0.0.0` again;
- [ ] remove irrelevant Pulse environment settings if host playback is removed.

### Acceptance criteria

- [ ] Default Compose config exposes TTS only on loopback.

---

## Task 7.2 — Add request models and explicit limits

**Primary file:** `docker/coqui-local/app.py`

### Subtasks

- [ ] trim and reject empty text;
- [ ] enforce maximum chunk text length;
- [ ] validate voice against available speakers for multi-speaker models;
- [ ] reject invalid voice with HTTP 400;
- [ ] enforce bounded queued work;
- [ ] return HTTP 429 or 503 on overload;
- [ ] enforce/request a synthesis timeout;
- [ ] return stable JSON error shape for non-audio failures;
- [ ] avoid returning internal stack details to clients in production.

### Acceptance criteria

- [ ] Unbounded work cannot be submitted to the local model.

---

## Task 7.3 — Serialize or queue model inference

### Preferred design

Use a bounded single-consumer synthesis queue.

### Subtasks

- [ ] ensure concurrent HTTP requests do not invoke the shared model simultaneously;
- [ ] set queue capacity explicitly, initially four jobs;
- [ ] expose overload cleanly;
- [ ] cancel/remove queued work when the request is abandoned where practical;
- [ ] protect startup/shutdown state;
- [ ] add concurrency tests with a mocked model that records overlap;
- [ ] prove maximum active inference count is one.

### Acceptance criteria

- [ ] Shared Coqui model access is deterministic and bounded.

---

## Task 7.4 — Delete temporary files on every path

### Subtasks

- [ ] attach a response background cleanup task for successful `FileResponse` delivery;
- [ ] delete files after synthesis errors;
- [ ] delete debug host-play files after process exit if debug playback remains;
- [ ] clean stale process entries;
- [ ] add best-effort shutdown cleanup for tracked temporary files;
- [ ] add tests for success, failure, cancellation/disconnect where practical, and debug playback.

### Acceptance criteria

- [ ] Repeated synthesis leaves no accumulating WAV files.

---

## Task 7.5 — Add liveness and readiness separation

### Subtasks

- [ ] retain `/api/ping` as liveness;
- [ ] add `/api/ready` that verifies model initialization and queue availability;
- [ ] make startup failure explicit;
- [ ] add a Docker health check using readiness if appropriate;
- [ ] update UI/server test behavior to use the correct endpoint instead of synthesizing `health-check` text unnecessarily.

### Acceptance criteria

- [ ] “Process alive” and “model ready to synthesize” are distinguishable.

---

## Task 7.6 — Gate or remove debug and host-play endpoints

### Subtasks

- [ ] remove `/api/tts/play`, `/api/playing`, `/api/tts/cancel`, and `/api/debug`; or
- [ ] gate them behind `ENABLE_DEBUG_ENDPOINTS=1`;
- [ ] enforce `PLAY_ON_HOST=0` if host playback remains;
- [ ] default all debug paths to disabled;
- [ ] ensure disabled paths return 404 rather than appearing operational;
- [ ] add tests for default-disabled and explicit-enabled modes.

### Acceptance criteria

- [ ] The production-local image has no accidental host playback surface.

---

## Task 7.7 — Mount the model cache correctly

**Primary file:** `docker/docker-compose.yml`

### Subtasks

- [ ] mount the declared `coqui_models` volume at the actual Coqui cache path;
- [ ] verify the environment variable matches the library’s effective cache behavior;
- [ ] rebuild/restart and prove the model is reused rather than downloaded again;
- [ ] correct README claims if implementation differs.

### Acceptance criteria

- [ ] The declared persistent model cache is real and verified.

---

## Task 7.8 — Pin dependencies and fail closed

**Primary files:**

- `docker/coqui-local/requirements.txt`;
- `docker/coqui-local/Dockerfile`;
- optional lock/constraints file.

### Subtasks

- [ ] pin the tested Coqui TTS version;
- [ ] pin compatible FastAPI, Pydantic, Uvicorn, and required audio dependencies;
- [ ] document tested Python version;
- [ ] stop swallowing model pre-download failure during Docker build;
- [ ] fail startup if model initialization fails;
- [ ] add an image smoke test that imports the service and verifies readiness with a mocked or real model as appropriate.

### Acceptance criteria

- [ ] A successful image build/start means the configured runtime is actually usable.

---

# Block 8 — Remove obsolete playback implementations

## Task 8.1 — Determine active references

### Search targets

- `src/content/playback.ts`;
- `src/content/player.ts`;
- `src/player/index.ts`;
- player HTML entry/assets;
- legacy message strings such as `play-audio`, `player_ready`, `request-tts`, `test-tts`;
- older offscreen message helpers superseded by the shared protocol.

### Subtasks

- [ ] run `git grep` for imports, HTML entries, manifest references, tests, docs, and generated build references;
- [ ] classify each path as active, adopted into coordinator, or dead;
- [ ] record the classification before deletion.

### Acceptance criteria

- [ ] No file is deleted based on filename assumptions alone.

---

## Task 8.2 — Delete or consolidate dead players

### Subtasks

- [ ] remove the standalone player page if unused;
- [ ] remove content playback controller if not adopted;
- [ ] remove duplicated base64/player helpers no longer used;
- [ ] remove obsolete tests tied only to deleted behavior;
- [ ] preserve and relocate valuable regression cases into coordinator tests;
- [ ] remove stale README and docs references;
- [ ] confirm built manifest contains no removed entry.

### Acceptance criteria

- [ ] Repository search finds only one production audio-player implementation.

---

## Task 8.3 — Simplify background message handlers

**Primary file:** `src/background/service-worker.ts`

### Subtasks

- [ ] consolidate duplicate `runtime.onMessage` listeners where practical;
- [ ] use protocol guards;
- [ ] remove `request-tts` and `test-tts` audio-return handlers after UI migration;
- [ ] remove old acknowledgement handling;
- [ ] remove dead tab messaging fields and comments;
- [ ] ensure every claimed async response path calls `sendResponse` exactly once;
- [ ] add handler-routing tests.

### Acceptance criteria

- [ ] Background routing is short, typed, and auditable.

---

# Block 9 — Build, typing, and CI hardening

## Task 9.1 — Add explicit strict type checking

**Primary files:**

- `package.json`;
- TS configs;
- CI workflow.

### Subtasks

- [ ] add `npm run typecheck` using `tsc -b` or the correct project command;
- [ ] ensure tests and extension code are covered appropriately;
- [ ] fix all strict errors rather than suppressing broadly;
- [ ] keep `skipLibCheck` decision documented;
- [ ] run typecheck in CI before build.

### Acceptance criteria

- [ ] Vite transpilation is not the only TypeScript validation.

---

## Task 9.2 — Use a supported Node version

**Primary file:** `.github/workflows/ci.yml`

### Subtasks

- [ ] change CI to Node 22 or another version supported by the locked Vite release;
- [ ] add an `engines.node` field and optional `.nvmrc`/`.node-version`;
- [ ] remove unsupported Node 18 assumptions from README;
- [ ] verify clean install and build without engine mismatch warnings.

### Acceptance criteria

- [ ] CI runtime matches package engine requirements.

---

## Task 9.3 — Make the Vite extension build fail closed

**Primary file:** `vite.config.ts`

### Subtasks

- [ ] remove catch-and-continue behavior for missing `@crxjs/vite-plugin`;
- [ ] fail clearly when the extension plugin cannot load;
- [ ] preserve any necessary Node `File` compatibility in a maintainable form;
- [ ] add a CI assertion that `dist/manifest.json` includes the expected background, popup, options, and offscreen entries;
- [ ] prove a build without the CRX plugin cannot pass.

### Acceptance criteria

- [ ] “Build passed” always means a usable extension bundle was produced.

---

## Task 9.4 — Strengthen CI coverage and server gates

### Subtasks

- [ ] run lint;
- [ ] run typecheck;
- [ ] run extension unit/integration tests with coverage;
- [ ] run server tests;
- [ ] validate Compose config;
- [ ] build extension;
- [ ] validate manifest assets and required entries;
- [ ] optionally build the Docker image in CI with a mocked/no-download mode if full model build is too expensive;
- [ ] introduce focused coverage thresholds for protocol, segmentation, packing, pacing, and coordinator modules;
- [ ] ensure Codecov input points to an actually produced report.

### Acceptance criteria

- [ ] New critical modules cannot regress silently.

---

# Block 10 — Real Chromium extension testing

## Task 10.1 — Add an unpacked-extension test harness

**Suggested tooling:** Playwright with Chromium persistent context.

### Subtasks

- [ ] build the extension;
- [ ] load `dist/` as an unpacked extension;
- [ ] discover the extension ID dynamically;
- [ ] serve a deterministic local page containing the collision fixture;
- [ ] provide a deterministic fake TTS server returning small generated WAV fixtures with known durations;
- [ ] instrument coordinator events and active player count through a test-only diagnostics API;
- [ ] avoid depending on the heavy real Coqui model for normal CI.

### Acceptance criteria

- [ ] CI can exercise the actual Manifest V3 worker/offscreen/UI topology.

---

## Task 10.2 — Prove the single-player invariant

### Required scenarios

- [ ] normal multi-chunk reading;
- [ ] second normal read supersedes first;
- [ ] popup test supersedes normal reading;
- [ ] options test supersedes popup test;
- [ ] normal reading supersedes test speech;
- [ ] rapid repeated starts;
- [ ] audio error/rejected-play path;
- [ ] optional WebAudio fallback path if retained.

### Assertion

At all observed points:

```text
active Chrome Read It audio source count <= 1
```

### Acceptance criteria

- [ ] The test fails if any two sources overlap, even briefly.

---

## Task 10.3 — Prove sequencing and bounded pacing

### Subtasks

- [ ] record actual chunk end and next chunk start timestamps;
- [ ] verify N+1 never starts before N ends;
- [ ] verify continuation/sentence/paragraph minimum gaps;
- [ ] test rates `0.5`, `1`, `2`, `4`, and supported maximum;
- [ ] verify paragraph gap is observably longer than sentence gap;
- [ ] verify packed short sentences are synthesized as one request;
- [ ] verify semicolon does not create a separate request.

### Acceptance criteria

- [ ] Automated timing evidence distinguishes no-overlap from acceptable pacing.

---

## Task 10.4 — Prove service-worker restart safety

### Subtasks

- [ ] start a multi-chunk session;
- [ ] terminate or force suspension/restart of the service worker between chunks;
- [ ] verify offscreen continues synthesis/playback;
- [ ] reopen popup and query progress;
- [ ] pause/resume/cancel through the restarted worker;
- [ ] start a new session and prove no token collision with pre-restart chunks.

### Acceptance criteria

- [ ] Queue progression and IDs remain correct across a real worker restart.

---

# Block 11 — Real Docker and listening validation

## Task 11.1 — Validate the hardened Docker service

### Subtasks

- [ ] build from a clean state;
- [ ] start Compose;
- [ ] verify port is bound only to loopback;
- [ ] verify `/api/ping`;
- [ ] verify `/api/ready`;
- [ ] verify `/api/voices`;
- [ ] synthesize valid audio through `/api/tts`;
- [ ] verify non-empty audio MIME and bytes;
- [ ] verify invalid voice handling;
- [ ] verify oversized input handling;
- [ ] verify queue overload behavior;
- [ ] verify debug endpoints are unavailable by default;
- [ ] verify temporary files do not accumulate after repeated requests;
- [ ] verify model cache persists across container recreation;
- [ ] inspect logs for swallowed exceptions.

### Acceptance criteria

- [ ] Exact command output and relevant observations are recorded.

---

## Task 11.2 — Conduct structured listening tests

Use at least:

- the deterministic collision fixture;
- ordinary prose with short sentences;
- prose with long sentences;
- multiple paragraphs;
- abbreviations/numbers/URLs;
- supported playback rates.

### For each test, record

- voice;
- rate;
- chunk count;
- sentence packing result;
- whether any true overlap occurred;
- whether sentence seams sounded abrupt;
- whether paragraph seams were clear;
- whether any text was repeated, omitted, or split incorrectly;
- relevant diagnostic event IDs/timestamps.

### Acceptance criteria

- [ ] No true overlap is heard or observed.
- [ ] Sentence transitions no longer sound collided at supported rates.
- [ ] Paragraphs have a clearly distinct pause.
- [ ] Text is complete and ordered.

---

# Block 12 — Documentation, cleanup, and release evidence

## Task 12.1 — Update user and developer documentation

**Likely files:**

- `README.md`;
- Docker README;
- architecture/review documents as appropriate.

### Subtasks

- [ ] document one-player architecture;
- [ ] document offscreen queue ownership;
- [ ] document `/api/tts` as the only normal endpoint;
- [ ] document loopback binding;
- [ ] document readiness and troubleshooting;
- [ ] document supported Node version;
- [ ] document test commands;
- [ ] remove claims about unused players or unmounted cache volumes;
- [ ] mark older review documents as historical where their architecture is superseded.

### Acceptance criteria

- [ ] Documentation matches the actual implementation and defaults.

---

## Task 12.2 — Perform repository hygiene review

### Subtasks

- [ ] search for obsolete message strings;
- [ ] search for all remaining audio constructors/sources;
- [ ] search for `/api/tts/play`;
- [ ] search for temp-file TODO/pass blocks;
- [ ] search for debug endpoints;
- [ ] search for unsupported Node 18 references;
- [ ] search for dead imports and generated artifacts;
- [ ] confirm no API keys, tokens, private selected text, audio artifacts, model files, `.env`, or certificates are committed;
- [ ] confirm working tree is clean after final commit.

### Required final searches

```bash
git grep -n "new Audio\|AudioContext\|speechSynthesis"
git grep -n "/api/tts/play\|paplay\|aplay"
git grep -n "request-tts\|test-tts\|player_ready\|play-audio"
git grep -n "TODO\|FIXME\|pass$" -- src docker
```

Every remaining hit must be expected and explained.

### Acceptance criteria

- [ ] There is one intentional playback implementation and no accidental host-play path.

---

## Task 12.3 — Final quality gate

Run from a clean checkout at the exact final SHA:

```bash
npm ci
npm run lint
npm run typecheck
npm test -- --run
npm run build
python -m pytest docker/coqui-local/tests
docker compose -f docker/docker-compose.yml config
```

Also run:

- [ ] real Chromium extension tests;
- [ ] real Docker smoke validation;
- [ ] structured listening validation;
- [ ] secret scan/reference search;
- [ ] final diff/status inspection.

### Acceptance criteria

- [ ] Every command exits successfully.
- [ ] No validation depends on uncommitted files.
- [ ] Evidence identifies the exact tested SHA.
- [ ] No “done” claim is made while real Chrome or Docker evidence remains pending.

---

## 4. Definition of done

The complete hardening effort is done only when:

### Single playback ownership

- [ ] normal reading uses the offscreen coordinator;
- [ ] popup test speech uses the offscreen coordinator;
- [ ] options test speech uses the offscreen coordinator;
- [ ] no independent UI-local TTS player remains;
- [ ] no normal server-host playback path remains;
- [ ] real Chromium tests prove active source count never exceeds one.

### Queue correctness

- [ ] offscreen owns queue progression;
- [ ] service-worker restart does not stall playback;
- [ ] IDs remain globally unique across restarts;
- [ ] only active player completion advances the queue;
- [ ] stale/duplicate/late events are ignored safely;
- [ ] cancel and replacement abort all old fetches and audio.

### Natural pacing

- [ ] short adjacent sentences are packed;
- [ ] semicolons do not force chunks;
- [ ] difficult punctuation and abbreviation cases are covered;
- [ ] bounded minimum gaps remain at high rates;
- [ ] paragraph pauses are clearly longer;
- [ ] listening tests no longer reproduce sentence collision.

### Server hardening

- [ ] loopback binding is default;
- [ ] request and queue limits exist;
- [ ] model access is serialized/bounded;
- [ ] temporary files are cleaned;
- [ ] readiness exists;
- [ ] debug/host-play endpoints are disabled by default;
- [ ] cache volume is mounted and verified;
- [ ] dependencies/model initialization are pinned and fail-closed.

### Quality

- [ ] strict typecheck is a CI gate;
- [ ] CI uses a supported Node version;
- [ ] extension build fails closed without the CRX plugin;
- [ ] extension, server, Chromium, and manual validation pass;
- [ ] obsolete code and documentation are cleaned up;
- [ ] the final exact SHA and evidence are recorded.

---

## 5. Recommended commit sequence

Use focused commits similar to:

1. `Add collision reproduction and baseline tests`
2. `Prevent duplicate test-speech playback`
3. `Migrate legacy host-play TTS settings`
4. `Add shared playback protocol`
5. `Introduce offscreen playback coordinator`
6. `Add robust text segmentation and chunk packing`
7. `Move synthesis queue into offscreen coordinator`
8. `Route all UI playback through coordinator`
9. `Make playback restart-safe`
10. `Harden local Coqui service lifecycle and limits`
11. `Remove obsolete playback implementations`
12. `Add Chromium playback and restart tests`
13. `Harden CI typing and extension build`
14. `Finalize documentation and validation evidence`

Do not combine unrelated Docker, UI, queue, and CI changes into one unreviewable commit unless a temporary intermediate state would otherwise be invalid.

---

## 6. Implementation priority

### P0 — User-visible correctness

- Block 1: immediate true-overlap containment;
- Block 2: coordinator foundation;
- Block 3: segmentation, packing, pacing;
- Block 4: authoritative queue;
- Block 5: unified user-facing playback;
- Block 6: restart safety.

### P1 — Reliability and security

- Block 7: Docker hardening;
- Block 8: obsolete path removal;
- Block 9: typing/build/CI.

### P2 — Proof and release readiness

- Block 10: Chromium tests;
- Block 11: real Docker/listening validation;
- Block 12: documentation and final evidence.

P0 is not complete without the real Chromium single-player test. P1 is not complete without server tests and effective Compose validation. The overall project is not complete without Block 12’s clean-SHA evidence.
