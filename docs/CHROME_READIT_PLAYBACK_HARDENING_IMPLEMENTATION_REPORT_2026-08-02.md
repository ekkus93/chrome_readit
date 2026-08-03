# Chrome Read It Playback Hardening Implementation Report

**Document:** `docs/CHROME_READIT_PLAYBACK_HARDENING_IMPLEMENTATION_REPORT_2026-08-02.md`  
**Date:** 2026-08-02  
**Repository:** `ekkus93/chrome_readit`  
**Branch:** `master`  
**Implementation snapshot before this report:** `beba00ed06d29ccb37ffc7f8b0b81b5967d0a164`  
**Governing specification:** `docs/CHROME_READIT_PLAYBACK_HARDENING_SPEC_2026-08-02.md`  
**Governing TODO:** `docs/CHROME_READIT_PLAYBACK_HARDENING_TODO_2026-08-02.md`  
**Overall status:** Implementation substantially complete; clean runtime validation and structured listening evidence remain pending.

---

## 1. Executive summary

The playback architecture has been replaced rather than incrementally patched.

The repository now has:

- one production playback coordinator in the offscreen document;
- one persistent browser `HTMLAudioElement`;
- one authoritative synthesis and playback queue owned by the offscreen document;
- UUID request and session identities that do not reset with the service worker;
- typed and runtime-guarded playback messages;
- immutable settings snapshots per accepted session;
- sentence-aware normalization, segmentation, packing, and bounded pacing;
- shared selection, popup-test, Options-test, keyboard, and context-menu playback;
- no UI-local, content-script, standalone-page, or server-host audio player;
- a loopback-only, bounded, serialized, non-root Coqui service;
- explicit liveness and readiness endpoints;
- temporary-file cleanup and stable server errors;
- Node 22, strict TypeScript, fail-closed extension builds, server tests, Compose assertions, and a real unpacked-Chromium test harness in CI.

The originally reported symptom had multiple possible causes. The implementation addresses each independently:

| Failure class | Implemented correction |
| --- | --- |
| True simultaneous browser playback | All user-facing paths use one offscreen coordinator and one audio element; stop-before-replace is atomic. |
| Sentences sounding fused | Adjacent sentences are packed, semicolons remain inside sentences, and sentence/paragraph gaps have rate-independent minimums. |
| Worker restart stalls/token collisions | Queue ownership moved out of the worker; IDs use `crypto.randomUUID()`; the worker is only a router. |
| Browser plus server-host double playback | `/api/tts/play`, host-play scripts, and the legacy Docker service were removed. |
| Server instability and leaks | Shared model access is serialized behind a bounded queue; inputs, timeouts, errors, and temporary files are controlled. |

No final release claim is made in this report because the current execution environment could not clone GitHub or retrieve push-triggered GitHub Actions job results. The complete validation commands and CI workflow are committed, but their successful execution still requires evidence.

---

## 2. Block-by-block implementation state

### Block 0 — Baseline, reproduction, and evidence harness

**Implementation state:** Partial; fixture and diagnostics implemented, original clean baseline command output not recovered.

Implemented:

- comprehensive deterministic collision fixture in `src/lib/debug-fixtures.ts`;
- fixture covers short sentences, semicolon clauses, paragraphs, decimals, versions, domains, URLs, email, titles, dotted initialisms, time abbreviations, contextual `St.`, `Jr.`, `Sr.`, quotes, ellipses, and an oversized sentence;
- bounded coordinator diagnostic history records session, chunk, transition, state, and monotonic timestamps without logging selected text or audio bytes;
- test-build-only `PLAYBACK_DIAGNOSTICS` request;
- real Chromium harness consumes the diagnostics and fake TTS request log.

Still pending:

- exact pre-change local tool versions and baseline command output;
- a captured clean execution of the final gate set.

### Block 1 — Immediate true-overlap containment

**Implementation state:** Implemented through final coordinator unification rather than temporary local-player containment.

Implemented:

- popup test speech routes through `READ_TEXT` with source `popup-test`;
- Options test speech routes through `READ_TEXT` with source `options-test`;
- no popup or Options `Audio()` construction remains;
- duplicate test clicks are disabled while the test session is active;
- stored `/api/tts/play` URLs migrate to `/api/tts` exactly once;
- prefixed paths, queries, trailing slashes, malformed URLs, and normal URLs have tests;
- normal synthesis rejects host-play URLs;
- central TTS client requires successful status, `audio/*`, non-empty bytes, and bounded response size;
- stable client error codes distinguish HTTP, non-audio, empty, oversized, invalid URL, host-play, cancellation, and fetch failures.

### Block 2 — Shared playback protocol and offscreen coordinator foundation

**Implementation state:** Implemented.

Implemented:

- `src/lib/playback-protocol.ts` defines start, control, status, event, error, state, source, and settings-snapshot contracts;
- runtime guards cover requests, responses, statuses, events, errors, sources, and controls;
- dispatch acceptance is distinct from playback completion;
- request and session IDs are strings;
- coordinator is initialized idempotently in persistent offscreen global state;
- one runtime listener is registered;
- start returns acceptance and UUID promptly;
- pause, resume, cancel, status, status events, queue state, fetches, prefetch, transition delays, diagnostics, and audio lifecycle are coordinator-owned;
- replacement ordering aborts old fetches and stops/cleans old audio before starting the new source;
- stale callbacks cannot complete or advance a replacement session;
- object URLs and handlers are cleaned idempotently;
- no WebAudio fallback remains.

### Block 3 — Text segmentation, packing, and pacing

**Implementation state:** Implemented with pure modules and focused tests.

Implemented:

- line-ending, non-breaking-space, horizontal-whitespace, single-line-wrap, and paragraph normalization;
- Unicode code-point length accounting and selected-text limit;
- `Intl.Segmenter` use with deterministic fallback protection;
- decimal, version, domain, URL, email, title, initialism, time, suffix, quote, bracket, ellipsis, and semicolon regression cases;
- contextual `St.`, `Jr.`, and `Sr.` handling;
- 280/400/500 target, soft, and hard chunk limits;
- target-aware sentence packing that prefers the closer complete-sentence boundary;
- paragraph boundaries never crossed;
- oversized sentence splitting at punctuation, whitespace, and finally hard code-point boundaries;
- continuation, sentence, paragraph, and end transition metadata;
- bounded square-root rate scaling with minimum gaps of 35 ms continuation, 120 ms sentence, and 350 ms paragraph;
- pause during in-flight synthesis prevents fetched audio from starting until resume;
- cancel and supersede interrupt transition waits.

### Block 4 — Synthesis queue and authoritative completion

**Implementation state:** Implemented.

Implemented:

- worker no longer fetches audio;
- coordinator owns one current and at most one prefetched synthesis request;
- every request is tied to a session AbortController;
- cancellation and replacement abort session requests;
- TTS URL, voice, and rate are immutable per session;
- only the active audio element's `ended` path completes a chunk;
- stale and duplicate callbacks are ignored by active object/session identity;
- command dispatch does not advance the queue;
- old global acknowledgement promise and timeout architecture was deleted;
- start callers receive acceptance rather than holding a message channel for the entire reading;
- popup closure has no effect on offscreen queue progression;
- unexpected synthesis failures are classified as `TTS_FETCH_FAILED`.

### Block 5 — Unify all user-facing playback

**Implementation state:** Implemented.

Implemented:

- selection reading captures text and sends one coordinator start request;
- service worker is a short-lived router;
- popup and Options contain no audio decoding, sniffing, object URL, or player logic;
- keyboard and UI controls route to the same coordinator;
- popup and Options listen to shared events;
- popup and Options query current status when opened and restore state/progress;
- status includes active source, session, chunk count, and paragraph count;
- server health testing uses readiness rather than synthesizing health-check speech.

### Block 6 — Restart safety and offscreen lifecycle

**Implementation state:** Implemented in code and covered by the committed real-browser harness; execution evidence pending.

Implemented:

- UUID request and session IDs;
- chunk identity derived from session plus global chunk index in diagnostic events;
- numeric worker-local session counters and recent-token workaround removed;
- queue progress is independent of worker promises or callbacks;
- status and controls can be routed through a restarted worker;
- failed offscreen routing returns structured `OFFSCREEN_INTERRUPTED` errors;
- subsequent requests recreate the offscreen document;
- no unsupported claim of automatic mid-chunk recovery after destruction of the offscreen document;
- Chromium harness force-closes the service-worker target during a multi-paragraph reading and checks continuation and post-restart IDs.

### Block 7 — Docker TTS service hardening

**Implementation state:** Implemented with fake-backend tests and Compose assertions; real image/model/cache smoke evidence pending.

Implemented:

- Compose publishes `127.0.0.1:${COQUI_PORT:-5002}:5002`;
- model cache volume is mounted at `/home/readit/.local/share/tts` with matching `TTS_HOME` and `XDG_DATA_HOME`;
- trimmed non-empty text and 500-character default request limit;
- multi-speaker voice validation;
- bounded active-plus-queued capacity, default four;
- one `ThreadPoolExecutor` inference worker;
- queue overflow returns 429;
- timeout returns 504;
- model readiness failures return 503;
- stable JSON error payloads do not expose stack traces;
- temporary WAV files are tracked and cleaned after success, failure, timeout completion, and shutdown;
- `/api/ping` and `/api/ready` are distinct;
- `/api/tts/play`, `/api/playing`, `/api/tts/cancel`, and `/api/debug` do not exist;
- obsolete `scripts/tts-server.js` and all of `docker/legacy/` were deleted;
- runtime dependencies are pinned;
- Docker image uses Python 3.11, a build stage, a minimal runtime stage, a non-root user, one Uvicorn worker, and readiness health check;
- model import and initialization fail startup rather than being swallowed;
- fake-backend tests cover successful WAV, readiness, voices, empty/oversized input, invalid voice, synthesis failure, queue full, maximum active inference one, timeout cleanup, and absent debug endpoints.

Still pending:

- clean real Docker image build with `TTS==0.22.0`;
- real VCTK model initialization and readiness;
- model cache persistence across container recreation;
- repeated real synthesis temporary-file observation;
- real voice and overload smoke commands.

### Block 8 — Remove obsolete playback implementations

**Implementation state:** Implemented.

Removed:

- content-script `PlaybackController` and tests;
- content audio helpers and tests;
- standalone player implementation;
- old offscreen message protocol;
- background base64 audio transport and tests;
- background queue/session/acknowledgement tests and helpers tied only to deleted behavior;
- popup and Options local players;
- Vite starter application, entry, styles, and assets;
- host-audio Node server;
- legacy host-play Docker application, proxy, startup script, Dockerfile, and requirements.

Current intentional player:

- `new Audio()` exists only in `createBrowserPlaybackCoordinator()`.

Historical documents may still quote removed identifiers. `docs/README.md` marks those documents as historical.

### Block 9 — Build, typing, and CI hardening

**Implementation state:** Implemented; run result pending.

Implemented:

- `npm run typecheck` uses `tsc -b`;
- build precondition runs lint and typecheck;
- Node engine and `.nvmrc` require 22.12.0 or newer;
- CI uses Node 22.12.0;
- CRXJS is statically imported and the build fails if it is unavailable;
- manifest uses CRXJS `defineManifest` rather than an undeclared transitive type package;
- Vite paths are ESM-safe;
- generated manifest/background/popup/Options/offscreen assets are asserted;
- extension coverage, server tests, Compose assertions, and Chromium E2E are CI jobs;
- Node globals are declared for the CDP harness;
- Codecov points to the produced V8 coverage file.

### Block 10 — Real Chromium extension testing

**Implementation state:** Harness implemented and wired into CI; successful run evidence pending.

`scripts/chromium-e2e.mjs`:

- starts a deterministic loopback fake TTS service;
- emits valid silent WAV files of known duration;
- launches the unpacked diagnostic extension in Chrome;
- discovers the extension ID dynamically;
- configures the extension through `chrome.storage.sync`;
- verifies short-sentence packing and semicolon preservation from observed HTTP requests;
- records chunk timing through coordinator diagnostics;
- asserts no overlapping active chunk intervals;
- asserts bounded paragraph pacing at rate 10;
- tests replacement and proves the superseded session does not complete;
- force-terminates the service-worker target during a three-paragraph session;
- checks offscreen continuation, status after worker recreation, and unique post-restart session IDs.

The browser process is launched with a dedicated temporary profile, unpacked extension flags, autoplay permission, Xvfb in CI, and no dependency on the heavy Coqui model.

### Block 11 — Real Docker and listening validation

**Implementation state:** Pending runtime environment.

Not yet evidenced:

- clean image build and start;
- real endpoint smoke set;
- loopback socket inspection;
- real model cache reuse;
- real temporary-file observation;
- structured listening tests at supported rates;
- subjective confirmation that sentence seams no longer sound collided;
- subjective confirmation of distinct paragraph pauses.

### Block 12 — Documentation, cleanup, and release evidence

**Implementation state:** Documentation and static cleanup implemented; final clean-SHA runtime evidence pending.

Implemented:

- root README documents the current architecture, service defaults, commands, Chromium harness, troubleshooting, and security posture;
- Docker README documents endpoints, queue, cleanup, limits, tests, and loopback binding;
- docs index identifies current versus historical documents;
- obsolete code and assets removed;
- repository search found no obvious committed API key, bearer token, private key, or `sk-` credential pattern;
- implementation report records exact remaining limitations.

Pending:

- complete clean-checkout command transcript;
- CI job URLs/logs or equivalent local output;
- real Docker smoke transcript;
- structured listening record;
- final exact validated SHA.

---

## 3. Key source files

### Authoritative extension implementation

- `src/background/service-worker.ts`
- `src/offscreen.ts`
- `src/offscreen/playback-coordinator.ts`
- `src/lib/playback-protocol.ts`
- `src/lib/text-normalization.ts`
- `src/lib/text-segmentation.ts`
- `src/lib/chunk-packing.ts`
- `src/lib/playback-pacing.ts`
- `src/lib/tts-client.ts`
- `src/lib/storage.ts`
- `src/popup/Popup.tsx`
- `src/options/Options.tsx`

### Authoritative service implementation

- `docker/coqui-local/app.py`
- `docker/coqui-local/Dockerfile`
- `docker/coqui-local/requirements.txt`
- `docker/docker-compose.yml`

### High-value regression tests

- `src/offscreen/playback-coordinator.test.ts`
- `src/lib/text-segmentation.test.ts`
- `src/lib/chunk-packing.test.ts`
- `src/lib/playback-pacing.test.ts`
- `src/lib/tts-client.test.ts`
- `src/lib/playback-protocol.test.ts`
- `src/background/service-worker.test.ts`
- `src/popup/Popup.test-speech.test.tsx`
- `src/options/Options.test-speech.int.test.tsx`
- `docker/coqui-local/tests/test_app.py`
- `scripts/chromium-e2e.mjs`

---

## 4. Required validation commands

The following commands are now the authoritative clean-checkout gate:

```bash
npm ci --legacy-peer-deps
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

Real Docker/model validation must additionally run:

```bash
docker compose -f docker/docker-compose.yml build --no-cache
docker compose -f docker/docker-compose.yml up -d
curl --fail http://127.0.0.1:5002/api/ping
curl --fail http://127.0.0.1:5002/api/ready
curl --fail http://127.0.0.1:5002/api/voices
```

A valid `/api/tts` smoke request must verify:

- HTTP 200;
- `Content-Type` begins with `audio/`;
- non-empty WAV bytes;
- invalid voice returns 400;
- oversized text returns 413;
- default debug/host-play endpoints return 404;
- repeated requests do not accumulate temporary WAV files;
- container recreation reuses the model cache.

---

## 5. Validation limitations encountered

Two independent evidence paths were attempted but were unavailable:

1. A disposable local clone failed because the execution container could not resolve `github.com`.
2. The connected GitHub tool can read and write repository contents but does not expose push-triggered Actions runs or check-suite logs for these direct `master` commits. Its combined-status endpoint returned no legacy status contexts, which is not proof of either success or failure.

Therefore:

- no lint, typecheck, test, build, Chromium, Docker, or listening command is marked passed in this report;
- committed tests and CI configuration are implementation evidence, not execution evidence;
- the project must not be declared fully complete until the commands above run successfully at one exact SHA and the report is updated with their output.

---

## 6. Remaining completion sequence

1. Run the full extension and server gate from a clean checkout.
2. Fix every reported lint, type, unit, server, build, or browser failure without weakening assertions.
3. Run the real Docker image/model smoke sequence.
4. Conduct structured listening tests using `DEBUG_COLLISION_FIXTURE` at rates 0.5, 1, 2, 4, and 10.
5. Record actual chunk counts, transition timestamps, observed active source count, voice, rate, and subjective seam quality.
6. Update the governing TODO and this report with the exact validated SHA and command output.
7. Only then change the overall status to complete.

---

## 7. Current conclusion

The repository architecture and implementation now satisfy the intended hardening design at the source-code level. The original background-owned queue, duplicate browser players, host-play endpoints, and legacy server paths have been removed rather than hidden. Sentence collision has been addressed through both larger natural chunks and bounded transition timing.

The remaining work is validation, not another architectural redesign. Until that validation is captured, the correct project status is:

> **Implementation substantially complete; final runtime, Docker, and listening sign-off pending.**
