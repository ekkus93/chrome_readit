# Chrome Read It Playback Hardening Specification

**Document:** `docs/CHROME_READIT_PLAYBACK_HARDENING_SPEC_2026-08-02.md`  
**Status:** Implementation specification  
**Date:** 2026-08-02  
**Repository:** `ekkus93/chrome_readit`  
**Baseline reviewed:** `564de25e3eb885000bb9fd9fd870d8e54d3854e8` (`master`)  
**Companion implementation plan:** `docs/CHROME_READIT_PLAYBACK_HARDENING_TODO_2026-08-02.md`

---

## 1. Purpose

This specification defines the target architecture and correctness requirements for Chrome Read It’s text-to-speech pipeline.

The primary objective is to eliminate all cases where speech overlaps, doubles, collides, stalls, or loses its natural sentence and paragraph pacing. The work also hardens the local Docker TTS service, removes obsolete playback paths, makes playback resilient to Manifest V3 service-worker restarts, and establishes testable contracts for every playback transition.

This document distinguishes four separate failure classes because they require different fixes:

1. **True simultaneous playback** — two audible players or server-side processes are active at once.
2. **Perceptual sentence collision** — chunks technically play sequentially, but the handoff gap is so short that sentences sound fused together.
3. **Queue/session failure** — a stale event, worker restart, cancellation race, or token collision causes a missing, repeated, or stalled chunk.
4. **Server lifecycle failure** — temporary-file leaks, concurrent model access, exposed endpoints, or unbounded input degrade or destabilize synthesis.

The implementation is not complete until all four classes are addressed and validated independently.

---

## 2. Current-state summary

The reviewed code already contains several valuable hardening measures:

- an explicit active playback session;
- abortable TTS fetches;
- one-chunk-ahead prefetching;
- playback-completion acknowledgements;
- stale-session checks;
- offscreen-document playback;
- duplicate-token filtering;
- explicit sentence and paragraph transition metadata;
- structured user-visible errors;
- unit and integration tests for several session races.

However, playback ownership remains fragmented across multiple implementations:

- production selection playback in `src/offscreen.ts`;
- popup-local test playback in `src/popup/Popup.tsx`;
- options-local test playback in `src/options/Options.tsx`;
- the older `PlaybackController` in `src/content/playback.ts`;
- the older player page in `src/player/index.ts`;
- optional host playback through `/api/tts/play`.

The main production queue normally waits for chunk completion before dispatching the next chunk. The reported collision can still occur because:

- popup and options test players do not stop an existing local player before starting another;
- test audio and normal offscreen audio can play at the same time;
- old settings can still point at `/api/tts/play`;
- `/api/tts/play` can spawn multiple host audio processes;
- every sentence is synthesized as an independent file;
- the 75 ms sentence gap is divided linearly by playback rate and becomes nearly zero at high rates;
- service-worker session IDs restart from `1` while the offscreen document can retain previous tokens;
- queue state is owned by the restart-prone service worker rather than the offscreen playback context.

---

## 3. Goals

### 3.1 Playback correctness

The system shall guarantee:

- no more than one audible Chrome Read It audio source at any time;
- no more than one active logical playback session at any time;
- a new read atomically supersedes and stops the previous read;
- test speech uses the same playback coordinator as normal reading;
- pause, resume, and cancel apply to whichever Chrome Read It session is audible;
- a chunk never advances until the authoritative player reports completion;
- stale, duplicate, reordered, or late events never advance the current queue;
- service-worker suspension or restart does not orphan an active queue;
- normal extension operation never invokes host-side audio playback.

### 3.2 Natural speech pacing

The system shall:

- preserve complete sentences whenever practical;
- pack multiple short sentences into one synthesis request;
- preserve paragraph boundaries explicitly;
- avoid treating semicolons as sentence boundaries;
- avoid splitting decimals, versions, domains, URLs, abbreviations, initials, and ellipses incorrectly;
- use bounded transition delays that remain audible at high playback rates;
- avoid manufacturing all sentence prosody through tiny inter-file delays.

### 3.3 Server reliability and safety

The Docker TTS service shall:

- bind to loopback by default;
- return audio only for the extension’s normal endpoint;
- disable host playback by default and make it unavailable unless explicitly enabled for debugging;
- serialize or strictly bound access to the shared model;
- enforce request-size and concurrency limits;
- clean up every temporary file;
- expose a useful health/readiness contract;
- use reproducible dependency and model configuration;
- persist its model cache correctly.

### 3.4 Maintainability

The repository shall have:

- one production playback coordinator;
- one set of playback message types;
- one settings source of truth;
- one text segmentation/chunk-packing implementation;
- no dead player implementation that can accidentally be revived;
- strict TypeScript checking in CI;
- real Chromium extension coverage for the single-player invariant.

---

## 4. Non-goals

This work does not require:

- cloud-hosted TTS;
- account management;
- synchronization between browsers;
- streaming synthesis from Coqui;
- word-level highlighting;
- automatic language detection;
- replacing the current Coqui model solely for voice-quality reasons;
- supporting `/api/tts/play` as part of the extension’s normal workflow;
- preserving obsolete internal playback APIs that have no active callers.

Streaming synthesis, sentence highlighting, and multilingual segmentation may be added later, but must not weaken the invariants in this specification.

---

## 5. Terminology

### Playback request

A user action that asks Chrome Read It to read selected or supplied text.

### Playback session

The complete lifecycle of one accepted playback request, including normalized text, chunks, synthesis requests, current audio, state, controls, and terminal result.

### Session ID

A globally unique identifier generated using `crypto.randomUUID()`. It must not be derived only from a process-local counter.

### Chunk

A unit sent to the TTS server and returned as one audio payload. A chunk may contain multiple complete sentences.

### Transition

The semantic boundary after a chunk:

- `continuation` — a forced split inside one unusually long sentence;
- `sentence` — a boundary between sentences that could not be packed together;
- `paragraph` — a paragraph boundary;
- `end` — the end of the session.

### Playback coordinator

The single authoritative component that owns the queue and the only production audio element/source.

---

## 6. Mandatory invariants

These invariants are release-blocking.

### INV-1: Single audible source

At any moment, Chrome Read It may own no more than one audible `HTMLAudioElement`, `AudioBufferSourceNode`, browser speech-synthesis utterance, or host playback process.

### INV-2: Single active session

At most one session may be in `starting`, `synthesizing`, `playing`, `paused`, or `stopping` state.

### INV-3: Stop-before-replace

A replacement session must not start audible playback until the prior session’s player has been synchronously neutralized:

- paused;
- source cleared or stopped;
- event handlers detached or made stale-safe;
- object URL revoked when safe;
- active token invalidated.

### INV-4: One authoritative completion signal

Queue advancement must be driven only by the playback coordinator’s completion event for the exact active session and chunk ID.

A dispatch acknowledgement means only that a command was accepted. It must never mean that playback finished.

### INV-5: Globally unique identifiers

Session and chunk IDs must remain unique across service-worker restarts, offscreen-document lifetimes, extension reloads, and multiple Chrome windows.

### INV-6: Offscreen queue ownership

Once a session is accepted, its queue, current chunk, state, and player lifecycle must be owned by the offscreen document. The service worker must not be required to remain alive for the next chunk to start.

### INV-7: Client-side playback only

The extension’s normal workflow must call an endpoint that returns audio. It must never call an endpoint that plays audio on the Docker host.

### INV-8: Bounded pacing

No playback-rate transformation may reduce sentence or paragraph gaps below their configured minimum.

### INV-9: Bounded server work

Text size, synthesis concurrency, queued requests, and request duration must have explicit limits.

### INV-10: No silent failure

Every terminal failure must produce a structured reason available to the popup/options status UI and diagnostic logs.

---

## 7. Target architecture

```text
Popup / Options / Keyboard / Context Menu
                  |
                  | READ_SELECTION / READ_TEXT / TEST_SPEECH
                  v
        Manifest V3 Service Worker
        - capture selection
        - load/migrate settings
        - validate request
        - ensure offscreen document
        - forward command
        - expose status to UI
                  |
                  | START_SESSION / CONTROL / QUERY_STATUS
                  v
        Offscreen Playback Coordinator
        - owns active session
        - normalizes and segments text
        - packs chunks
        - performs one-ahead synthesis prefetch
        - owns AbortControllers
        - owns the only production audio player
        - enforces pause/resume/cancel/replace
        - emits status and terminal events
                  |
                  | POST /api/tts
                  v
          Local Docker TTS Service
        - synthesis only
        - bounded request queue
        - serialized model access
        - temporary-file cleanup
        - no host playback by default
```

Selection capture may continue to use `chrome.scripting.executeScript()` because it extracts text only. It must not inject an ad-hoc audio player into the page.

---

## 8. Component responsibilities

## 8.1 Service worker

The service worker shall be a command router, not the long-lived queue owner.

Responsibilities:

- identify the active supported tab;
- capture selected text;
- load canonical settings;
- migrate obsolete settings;
- validate text and endpoint configuration;
- ensure the offscreen document exists;
- send start/control/status messages;
- return structured responses to popup/options callers;
- recreate the offscreen document if it is absent;
- query current status after the worker restarts.

The service worker shall not:

- own the next-chunk loop;
- keep the only copy of active session state;
- play audio;
- maintain process-local numeric IDs as globally meaningful tokens;
- infer completion from `sendMessage()` returning successfully.

## 8.2 Offscreen playback coordinator

The offscreen document shall own:

- active session state;
- session and chunk IDs;
- text normalization;
- paragraph and sentence segmentation;
- chunk packing;
- synthesis scheduling;
- one-chunk-ahead prefetch;
- synthesis AbortControllers;
- the current object URL;
- the current audio element or exclusive fallback source;
- pause/resume/cancel state;
- status reporting;
- completion and error transitions;
- a bounded diagnostic event history.

The coordinator must be idempotently initialized. Re-importing or reloading its module must never register duplicate listeners inside the same document.

## 8.3 Popup and Options

Popup and Options shall not construct their own `Audio` elements for TTS playback.

Normal reading and test speech must use the coordinator. Test speech is a normal playback session with a source such as `popup-test` or `options-test`.

Controls must operate on the active session regardless of its source.

## 8.4 Docker TTS service

The service performs synthesis and returns an audio response. It does not own browser playback timing.

The normal endpoint is:

```text
POST /api/tts
```

The normal response must have an `audio/*` content type and non-empty audio bytes.

---

## 9. Playback protocol

Message types shall be centralized in a shared module such as `src/lib/playback-protocol.ts`.

## 9.1 Start request

```ts
export type StartPlaybackRequest = {
  kind: 'START_PLAYBACK'
  requestId: string
  source: 'selection' | 'popup-test' | 'options-test' | 'debug-fixture'
  text: string
  settings: {
    voice: string
    rate: number
    ttsUrl: string
  }
}
```

`requestId` must be created with `crypto.randomUUID()` by the caller. The coordinator creates its own `sessionId` when accepting the request.

## 9.2 Start response

```ts
export type StartPlaybackResponse =
  | { ok: true; sessionId: string; state: PlaybackState }
  | { ok: false; error: PlaybackError }
```

The response means the session was accepted or rejected. It does not wait for the whole reading to finish.

This is important: the current UI should not keep a runtime message channel open for the duration of a long article.

## 9.3 Controls

```ts
export type PlaybackControlRequest = {
  kind: 'PLAYBACK_CONTROL'
  command: 'pause' | 'resume' | 'cancel'
  expectedSessionId?: string
}
```

If `expectedSessionId` is present and does not match the active session, the command must return a stale-session result without affecting the current session.

## 9.4 Status

```ts
export type PlaybackStatus = {
  state: 'idle' | 'starting' | 'synthesizing' | 'playing' | 'paused' | 'stopping' | 'completed' | 'failed'
  sessionId: string | null
  source: string | null
  currentChunk: number
  totalChunks: number
  currentParagraph: number
  totalParagraphs: number
  error?: PlaybackError
}
```

Popup and Options may query status when opened and subscribe to status events while alive.

## 9.5 Internal chunk identity

```ts
export type ChunkId = `${string}:${number}`
```

The string prefix is the UUID session ID. No recent-token cache is needed to compensate for process-local counter reuse. Duplicate commands for an existing chunk remain idempotent.

---

## 10. Session state machine

Valid states:

```text
idle
  -> starting
  -> synthesizing
  -> playing
  -> paused
  -> playing
  -> stopping
  -> idle

playing/synthesizing
  -> completed
  -> idle

starting/synthesizing/playing/paused
  -> failed
  -> idle
```

Rules:

1. A new start request atomically marks the previous session as superseded.
2. The coordinator immediately aborts old synthesis requests.
3. The current audio source is neutralized before the new session can play.
4. Late callbacks must compare both session ID and chunk ID.
5. A stale callback may clean up its own resources but may not mutate active state.
6. Cancel is terminal for the target session.
7. Pause during synthesis records paused state; fetched audio must not start until resumed.
8. Pause during an inter-chunk gap freezes the remaining gap rather than discarding it.
9. Resume must be idempotent.
10. Repeated cancel must be safe.

---

## 11. Text normalization

Before segmentation, the coordinator shall:

- normalize CRLF and CR to `\n`;
- replace non-breaking spaces with normal spaces where appropriate;
- collapse runs of horizontal whitespace without destroying paragraph boundaries;
- trim leading and trailing whitespace;
- preserve meaningful punctuation;
- reject text that is empty after normalization;
- enforce a configured maximum text length.

Recommended default maximum selected text length:

```text
50,000 Unicode code points
```

If a lower server request limit is used, the coordinator’s chunks must always remain under that limit.

### Paragraph recognition

Canonical paragraph boundaries:

- two or more newline-separated blank-line boundaries;
- multiple block separators preserved by future structured extraction;
- explicit debug-fixture paragraph markers.

Single newlines in plain selected text should normally become spaces because browser selection often inserts line wrapping as single newlines. Exceptions may be added for recognizable list items, headings, or block markers, but must be tested.

---

## 12. Sentence segmentation

Use `Intl.Segmenter` with `granularity: 'sentence'` when available. The implementation must still have a deterministic tested fallback.

Post-processing must protect at least:

- decimal numbers such as `3.14`;
- version strings such as `1.2.3`;
- domains such as `example.com`;
- URLs and email addresses;
- dotted initials and initialisms such as `U.S.` and `A.I.`;
- titles and abbreviations such as `Dr.`, `Mr.`, `Ms.`, `Prof.`;
- suffixes such as `Jr.` and `Sr.`;
- time abbreviations such as `a.m.` and `p.m.`;
- common Latin abbreviations such as `e.g.` and `i.e.`;
- ellipses;
- closing quotes and brackets after terminal punctuation.

A semicolon is not a sentence terminator for chunking purposes.

The fallback must not use a blanket rule that every `St.`, `Jr.`, or `Sr.` always continues. Context-sensitive tests are required for both continuation and true sentence-ending cases.

---

## 13. Chunk packing

The current one-sentence-per-request behavior shall be replaced with sentence packing.

Recommended defaults:

```ts
const TARGET_CHUNK_CHARS = 280
const SOFT_MAX_CHUNK_CHARS = 400
const HARD_MAX_CHUNK_CHARS = 500
```

Algorithm:

1. Segment a paragraph into sentence units.
2. Start an empty chunk.
3. Append the next complete sentence if the result is no larger than `SOFT_MAX_CHUNK_CHARS`.
4. Prefer ending a chunk at or after `TARGET_CHUNK_CHARS` when another sentence would exceed the soft maximum.
5. Never cross a paragraph boundary.
6. If one sentence exceeds `HARD_MAX_CHUNK_CHARS`, split it at a ranked boundary:
   - clause punctuation such as comma, colon, or em dash;
   - whitespace;
   - hard character cut only as a last resort.
7. Mark forced within-sentence splits with `transitionAfter: 'continuation'`.
8. Preserve punctuation in the emitted text.

Example:

```text
Input:
"First short sentence. Second short sentence. Third short sentence."

Preferred output:
one chunk containing all three sentences, not three audio files.
```

This lets the TTS model generate natural sentence pauses and intonation.

---

## 14. Pacing model

Pacing supplements model-generated pauses. It must not replace them.

Recommended initial constants:

```ts
const BASE_CONTINUATION_GAP_MS = 60
const BASE_SENTENCE_GAP_MS = 180
const BASE_PARAGRAPH_GAP_MS = 550

const MIN_CONTINUATION_GAP_MS = 35
const MIN_SENTENCE_GAP_MS = 120
const MIN_PARAGRAPH_GAP_MS = 350
```

Rate scaling shall be bounded and sublinear. A recommended formula is:

```ts
scaled = Math.round(base / Math.sqrt(rate))
result = Math.max(minimum, scaled)
```

The exact constants may be tuned through listening tests, but the minimums are mandatory until evidence supports changing them.

Rules:

- `continuation`: short gap because the text is one sentence split for size;
- `sentence`: used only when adjacent sentences could not be packed together;
- `paragraph`: clearly longer pause;
- `end`: no trailing queue delay;
- pause freezes an in-progress gap;
- cancel interrupts an in-progress gap immediately.

---

## 15. Synthesis scheduling

The coordinator may prefetch exactly one chunk ahead.

Requirements:

- at most one current synthesis and one prefetched synthesis may exist;
- each fetch has an `AbortController` tied to the session;
- cancel or supersede aborts all session fetches;
- failed current synthesis fails the session;
- failed prefetch may be retried once when it becomes current if the error is transient;
- HTTP non-success is a structured synthesis error;
- an empty response is rejected;
- a non-`audio/*` response is rejected before player creation;
- response size must be bounded;
- no chunk is played out of order.

The coordinator must not base queue advancement on fetch completion. Playback completion remains authoritative.

---

## 16. Audio-player lifecycle

The coordinator shall own one player abstraction.

Minimum HTMLAudio behavior:

1. Stop the current player before replacement.
2. Create one object URL for the new audio payload.
3. Create or reuse one `HTMLAudioElement`.
4. Apply clamped playback rate.
5. Attach token-aware `ended`, `error`, and rejected-`play()` handlers.
6. Start playback once.
7. On completion or failure:
   - detach handlers;
   - pause if needed;
   - clear `src`;
   - call `load()` if required to release the resource;
   - revoke the object URL exactly once;
   - clear active references;
   - emit the authoritative result.

### Optional WebAudio fallback

A WebAudio fallback is permitted only if all of the following are true:

- HTMLAudio is fully neutralized before fallback starts;
- fallback startup is idempotent;
- only one source can be audible;
- pause/resume/cancel work consistently;
- the `AudioContext` is closed on completion and stop;
- tests prove simultaneous HTMLAudio and WebAudio output is impossible.

Removing the fallback is preferable to retaining an unproven dual-player path.

---

## 17. Test speech behavior

Popup and Options test speech shall call the same start-session protocol as selection reading.

Starting test speech while normal reading is active shall follow the standard replacement rule: the active session is stopped and the test session becomes active.

Starting normal reading while test speech is active shall likewise stop test speech first.

There must be no UI-local audio object and no separate test-audio control path.

---

## 18. Service-worker restart behavior

The offscreen coordinator owns active playback state, so worker restart must not interrupt normal queue advancement.

After startup, the worker shall:

1. prime settings;
2. detect whether an offscreen document exists;
3. query coordinator status when needed;
4. route controls to the currently active coordinator session;
5. avoid resetting or inventing the active session from local defaults.

The UI may reopen after a worker restart and must be able to retrieve current progress.

If the offscreen document itself is destroyed, playback may terminate, but the next status query must return a clear interrupted-session result rather than hanging.

---

## 19. Settings and migration

`src/lib/storage.ts` remains the canonical settings source.

Required migration:

- detect any stored TTS URL whose path ends in `/api/tts/play`;
- replace it with the sibling `/api/tts` endpoint;
- persist the corrected value once;
- record a development diagnostic event;
- never send normal extension requests to `/api/tts/play`.

Rate must be clamped consistently in one shared helper. Voice and endpoint validation must be shared by normal and test speech.

Recommended production rate range:

```text
0.5 to 4.0
```

The current 10× maximum may remain temporarily for compatibility, but the UI and tests must account for intelligibility and minimum-gap behavior. Product review should decide whether rates above 4× are useful.

---

## 20. Docker TTS API contract

## 20.1 `POST /api/tts`

Request:

```json
{
  "text": "Text to synthesize",
  "voice": "p225"
}
```

Validation:

- `text` is required;
- text must be non-empty after trimming;
- maximum text length must be enforced;
- voice must be from the discovered speaker set when the model is multi-speaker;
- unsupported voice returns HTTP 400;
- overloaded queue returns HTTP 429 or 503;
- synthesis timeout returns HTTP 504 or a documented 503 class.

Response:

- HTTP 200;
- `Content-Type: audio/wav` or another explicit audio type;
- non-empty bytes;
- no server-side playback side effect.

## 20.2 `GET /api/voices`

Returns a deterministic unique list of supported voices.

## 20.3 `GET /api/ping`

Liveness only. It may return success before the model is ready.

## 20.4 `GET /api/ready`

Readiness endpoint that confirms:

- model initialized;
- inference queue available;
- service capable of accepting synthesis.

## 20.5 Debug endpoints

`/api/debug`, `/api/tts/play`, `/api/playing`, and `/api/tts/cancel` must be removed from the normal image or gated behind an explicit environment variable such as:

```text
ENABLE_DEBUG_ENDPOINTS=1
```

The default is disabled.

`PLAY_ON_HOST=0` must have real enforcement if host playback code remains.

---

## 21. Server implementation requirements

### 21.1 Loopback binding

Docker Compose shall publish:

```yaml
ports:
  - "127.0.0.1:5002:5002"
```

Remote binding requires an explicit user override.

### 21.2 Model access

The shared Coqui model must be protected by either:

- a single inference lock; or
- a bounded single-consumer work queue.

A queue is preferred because it enables explicit overload handling and metrics.

### 21.3 Temporary files

Every generated temporary file must be deleted:

- after `FileResponse` completes;
- after debug host playback exits;
- after a synthesis exception;
- during best-effort shutdown cleanup.

### 21.4 Limits

Recommended initial limits:

```text
Maximum request text: 1,000 characters per chunk
Maximum queued synthesis jobs: 4
Concurrent model inference: 1
Request timeout: model-dependent, initially 120 seconds
Maximum returned audio bytes: explicit bounded value
```

These values may be tuned, but must remain explicit and tested.

### 21.5 Model cache

The declared Docker volume must actually be mounted to the model cache directory.

### 21.6 Reproducibility

- pin a tested Coqui TTS package version;
- pin FastAPI and Uvicorn compatibly;
- document the tested Python version;
- fail the Docker build or startup if the selected model cannot initialize;
- do not swallow model pre-download failures and continue as though the image is valid.

---

## 22. Error model

Use stable machine-readable codes with user-facing messages.

Suggested codes:

```ts
type PlaybackErrorCode =
  | 'NO_TEXT'
  | 'UNSUPPORTED_PAGE'
  | 'SELECTION_CAPTURE_FAILED'
  | 'NO_TTS_URL'
  | 'INVALID_TTS_URL'
  | 'TTS_UNAVAILABLE'
  | 'TTS_OVERLOADED'
  | 'TTS_TIMEOUT'
  | 'TTS_HTTP_ERROR'
  | 'TTS_NON_AUDIO_RESPONSE'
  | 'TTS_EMPTY_RESPONSE'
  | 'AUDIO_PLAY_REJECTED'
  | 'AUDIO_DECODE_FAILED'
  | 'SESSION_SUPERSEDED'
  | 'SESSION_CANCELLED'
  | 'OFFSCREEN_UNAVAILABLE'
  | 'OFFSCREEN_INTERRUPTED'
  | 'INTERNAL_ERROR'
```

Errors must contain:

- code;
- concise user message;
- optional diagnostic detail safe for local logs;
- session ID when one exists;
- chunk index when relevant.

Do not expose selected text in normal logs.

---

## 23. Observability

Development builds shall maintain a bounded event log containing events such as:

- session accepted;
- previous session superseded;
- text normalized;
- paragraph/sentence/chunk counts;
- synthesis started/completed/aborted;
- playback started/paused/resumed/ended/stopped;
- transition gap started/completed/interrupted;
- stale callback ignored;
- session completed/failed.

Each event includes:

- timestamp;
- session ID;
- chunk ID or index;
- state transition;
- duration where relevant;
- no full selected text.

Production logging should be limited to warnings and actionable failures.

---

## 24. Security and privacy

- Default TTS traffic remains local to `127.0.0.1`.
- The extension must clearly treat a user-configured remote TTS URL as sending selected text to that remote service.
- `<all_urls>` permission remains a separate publishing review item, but playback hardening must not broaden permissions further.
- Debug endpoints must not be remotely exposed by default.
- Input and output sizes must be bounded.
- No API keys, selected text, or audio payloads may be written to repository logs or diagnostic documents.
- `.env`, keys, and certificates remain ignored.

---

## 25. Testing requirements

## 25.1 Pure unit tests

Cover:

- normalization;
- paragraph handling;
- `Intl.Segmenter` adapter and fallback;
- decimals, domains, URLs, versions, abbreviations, suffixes, initials, ellipses, quotes;
- semicolon behavior;
- chunk packing;
- forced long-sentence splitting;
- transition metadata;
- bounded pacing formula;
- settings URL migration;
- protocol guards;
- stale ID rejection.

## 25.2 Coordinator tests

Using mocked audio and fetch:

- one player at a time;
- stop-before-replace ordering;
- test speech supersedes normal speech and vice versa;
- one authoritative completion event;
- duplicate start is idempotent;
- stale ended/error callback ignored;
- pause during playback;
- pause during synthesis;
- pause during gap;
- cancel during playback;
- cancel during synthesis;
- cancel during gap;
- one-ahead prefetch only;
- failed prefetch retry policy;
- empty and non-audio responses;
- object URL cleanup;
- optional fallback exclusivity.

## 25.3 Service-worker tests

Cover:

- selection capture;
- unsupported page;
- settings migration;
- offscreen creation races;
- start request returns promptly after acceptance;
- status recovery after worker module reinitialization;
- controls after worker restart;
- no process-local token assumptions.

## 25.4 Server tests

Cover:

- request validation;
- unsupported voice;
- non-empty audio response;
- temp file cleanup on success and failure;
- inference serialization;
- queue overload;
- readiness behavior;
- debug endpoints disabled by default;
- loopback Compose configuration;
- model-cache mount.

Model-heavy tests may mock Coqui for normal CI. A separate manual or scheduled smoke test may use the real model.

## 25.5 Real Chromium extension tests

Use Playwright or an equivalent Chromium harness to load the unpacked extension and a deterministic local test page.

Required scenarios:

1. Read a multi-paragraph fixture.
2. Assert chunk start N+1 occurs only after chunk N ends plus the expected bounded gap.
3. Start a second read during the first and prove the first player is stopped before the second begins.
4. Start popup/options test speech during normal reading and prove there is still one active source.
5. Exercise pause/resume/cancel.
6. simulate or force service-worker termination between chunks and prove playback continues from the offscreen queue.
7. reopen the popup and verify status recovery.

The test harness shall instrument active audio elements/sources and fail if the count exceeds one.

---

## 26. CI and build requirements

CI shall use a Node version supported by the locked Vite release. For the reviewed Vite 7 dependency, use Node 22 unless dependencies are deliberately changed.

Required CI gates:

```text
npm ci
npm run lint
npm run typecheck
npm test -- --run
npm run build
manifest asset validation
server unit tests
Docker configuration validation
```

The Vite configuration must fail closed if `@crxjs/vite-plugin` cannot load. A build without the extension plugin must not be reported as a successful extension build.

Coverage thresholds should be introduced for the new protocol, segmentation, packing, pacing, and coordinator modules.

---

## 27. Expected file changes

Likely new files:

- `src/lib/playback-protocol.ts`
- `src/lib/text-segmentation.ts`
- `src/lib/chunk-packing.ts`
- `src/lib/playback-pacing.ts`
- `src/offscreen/playback-coordinator.ts` or an equivalent module path
- focused unit tests for each module
- server tests under `docker/coqui-local/tests/`
- a Chromium extension test harness

Likely modified files:

- `src/background/service-worker.ts`
- `src/offscreen.ts`
- `src/lib/offscreen-messaging.ts` or its replacement
- `src/lib/storage.ts`
- `src/popup/Popup.tsx`
- `src/options/Options.tsx`
- `src/manifest.ts`
- `docker/coqui-local/app.py`
- `docker/coqui-local/Dockerfile`
- `docker/coqui-local/requirements.txt`
- `docker/docker-compose.yml`
- `.github/workflows/ci.yml`
- `package.json`
- `README.md`

Likely removable after confirming no active references:

- `src/player/index.ts` and its page assets;
- `src/content/playback.ts` if not adopted as the shared coordinator player;
- other obsolete content-player helpers and tests;
- legacy Docker host-playback code not retained behind a debug gate.

Deletion must follow reference searches and build/test proof.

---

## 28. Compatibility and migration

- Existing voice, rate, and valid `/api/tts` settings remain compatible.
- Stored `/api/tts/play` values are migrated automatically.
- No backward compatibility is required for obsolete internal message formats once all repository callers are migrated in the same change series.
- The user-facing keyboard shortcuts remain unchanged.
- The local server remains on port 5002 by default.
- The UI may display a brief migration notice only if correction of an obsolete URL affects a failed request; silent safe migration is otherwise acceptable.

---

## 29. Release acceptance criteria

The hardening work is complete only when all of the following are true:

### Playback

- [ ] Normal reading, popup test speech, and options test speech all use one coordinator.
- [ ] No UI creates an independent TTS `Audio` element.
- [ ] A new session stops the prior source before starting.
- [ ] No extension path calls `/api/tts/play`.
- [ ] Service-worker restart does not stop queue progression.
- [ ] Session and chunk IDs cannot collide after restart.
- [ ] Stale events cannot advance the active queue.
- [ ] Pause/resume/cancel work during synthesis, playback, and gaps.

### Pacing and segmentation

- [ ] Multiple short sentences are packed into a single chunk.
- [ ] Semicolons do not force sentence chunks.
- [ ] Decimals, URLs, domains, versions, abbreviations, initials, suffixes, and ellipses have regression coverage.
- [ ] Sentence and paragraph gaps have enforced minimums.
- [ ] A multi-paragraph listening test no longer sounds collided at supported rates.

### Server

- [ ] Docker binds to `127.0.0.1` by default.
- [ ] Host playback and debug endpoints are disabled by default.
- [ ] Model inference is serialized or bounded.
- [ ] Queue overload is explicit.
- [ ] Temporary files are deleted on every path.
- [ ] The model cache volume is mounted.
- [ ] Dependency/model initialization is reproducible and fail-closed.

### Quality gates

- [ ] Lint passes.
- [ ] Strict TypeScript typecheck passes.
- [ ] Unit and integration tests pass.
- [ ] Server tests pass.
- [ ] Extension build passes using a supported Node version.
- [ ] Real Chromium single-player and worker-restart tests pass.
- [ ] Manual Docker/Chrome validation evidence is recorded.
- [ ] Obsolete playback paths are removed or explicitly justified.

---

## 30. Final architectural decision

The authoritative design is:

```text
Service worker captures and routes.
Offscreen document owns the durable queue and the only player.
Docker synthesizes and returns audio only.
Every UI uses the same session protocol.
```

This design directly addresses true overlap, perceptual sentence collision, service-worker restart stalls, and server-side playback conflicts while simplifying the codebase enough to make future regressions testable.