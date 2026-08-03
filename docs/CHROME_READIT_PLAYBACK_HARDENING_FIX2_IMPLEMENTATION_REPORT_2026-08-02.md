# Chrome Read It Playback Hardening FIX2 Implementation Report

**Status:** Implementation and validation in progress  
**Governing specification:** `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_SPEC_2026-08-02.md`  
**Governing TODO:** `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_TODO_2026-08-02.md`  
**Reviewed baseline:** `032265d9f10d87012e13057177f0463dc96ec211`  
**FIX2 final implementation SHA:** _pending_  
**Final CI run:** _pending_  
**Real Coqui evidence:** _pending_  
**Listening evidence:** _pending_

---

## 1. Completion rule

This report distinguishes:

1. code implemented;
2. automated evidence passing on an exact SHA;
3. environment-dependent evidence executed;
4. historical evidence that cannot be reconstructed.

Code presence is not acceptance evidence. Items remain pending until the corresponding gate is executed and recorded.

---

## 2. Implemented corrective architecture

### 2.1 Fail-closed audio ownership

Implemented in `src/offscreen/playback-coordinator.ts`:

- direct production/test-build player counters;
- active and maximum active-player counts;
- play-attempt, successful-start, and settlement counts;
- cleanup failure stage and invariant-violation counts;
- one persistent `HTMLAudioElement`;
- explicit `AUDIO_CLEANUP_FAILED` and cleanup-stage metadata;
- explicit `AUDIO_PLAYBACK_FAILED` classification;
- superseded terminal events before replacement acceptance;
- retention of source/object-URL handles after uncertain pause cleanup;
- rejection of every subsequent start until cleanup is proven successful;
- stale callback identity checks;
- signal-driven pause-aware timing rather than 25 ms polling.

Primary tests:

- `src/offscreen/playback-coordinator.test.ts`
- `scripts/chromium-e2e.mjs`

### 2.2 Strict playback protocol

Implemented in `src/lib/playback-protocol.ts`:

- validated error codes and cleanup stages;
- monotonic status sequence;
- persistence-degraded state;
- strict chunk ID and transition validation;
- progress and identity consistency rules;
- terminal state/error consistency;
- explicit supersession event.

Primary test:

- `src/lib/playback-protocol.test.ts`

### 2.3 Typed UI runtime client and visible failures

Implemented in:

- `src/lib/playback-runtime-client.ts`
- `src/popup/Popup.tsx`
- `src/options/Options.tsx`

Behavior:

- start, control, and status responses are runtime-validated;
- popup and Options controls carry `expectedSessionId`;
- buttons are gated by authoritative state;
- structured control/start/status failures are visible;
- test-speech UIs track accepted session IDs;
- supersession clears disabled/sending state;
- status-persistence degradation is visible;
- Options uses an explicit endpoint draft and Save action.

Primary tests:

- `src/lib/playback-runtime-client.test.ts`
- `src/popup/Popup.test-speech.test.tsx`
- `src/popup/Popup.ui.test.tsx`
- `src/options/Options.test-speech.int.test.tsx`
- `src/options/Options.ui.test.tsx`

### 2.4 Restart-safe status persistence

Implemented in `src/background/service-worker.ts`:

- serialized status writes;
- monotonic acceptance rules;
- stale cross-session terminal rejection;
- explicit storage degradation;
- explicit unsupported-offscreen failure;
- no process-local offscreen-existence fallback;
- shared typed start/control/status routing;
- bounded readiness probe.

Primary test:

- `src/background/service-worker.test.ts`

### 2.5 Untrusted settings and endpoint handling

Implemented in:

- `src/lib/storage.ts`
- `src/lib/tts-endpoints.ts`
- `src/lib/voices.ts`

Behavior:

- runtime validation and repair of stored settings;
- finite/clamped rates;
- HTTP(S)-only synthesis endpoints;
- trimmed non-empty voices;
- legacy host-play URL migration;
- repair warnings exposed to the UI;
- persistence references updated only after successful writes;
- one canonical sibling-endpoint derivation helper;
- credential/query/fragment redaction for display;
- structured voice discovery success, empty-list, timeout, network, HTTP, JSON, and schema results.

Primary tests:

- `src/lib/storage.test.ts`
- `src/lib/tts-endpoints.test.ts`
- `src/lib/voices.test.ts`

### 2.6 Bounded TTS client

Implemented in `src/lib/tts-client.ts`:

- bounded streamed body reads;
- declared and actual byte limits;
- stream cancellation at the cap;
- no unbounded `arrayBuffer()` fallback;
- request/body timeout;
- external cancellation distinguished from timeout;
- no raw endpoint, response body, credentials, or internal error exposure.

Primary test:

- `src/lib/tts-client.test.ts`

### 2.7 Text segmentation and canonical fixture

Implemented in:

- `fixtures/playback-collision.txt`
- `src/lib/debug-fixtures.ts`
- `src/lib/text-segmentation.ts`
- `src/lib/chunk-packing.ts`

Additional regressions include:

- uppercase initialism continuations such as `The U.S. Army`;
- weekday continuations after `p.m.`;
- non-ASCII title/name boundaries;
- numeric street-address continuations;
- URL query boundaries with and without whitespace;
- exact canonical-fixture semantic reconstruction;
- paragraph, size, forced-split, and transition invariants.

Primary tests:

- `src/lib/text-segmentation.test.ts`
- `src/lib/chunk-packing.test.ts`

### 2.8 Coqui runtime lifecycle

Implemented in `docker/coqui-local/app.py`:

- fail-fast environment parsing;
- cached and deduplicated voices;
- invalid voice rejection before queue/tempfile allocation;
- exception-safe semaphore ownership;
- explicit active, queued, timed-out, capacity, tempfile, and cleanup metrics;
- truthful readiness under saturation;
- timed-out work retained as capacity until actual completion;
- cleanup failure retention and retry;
- active path protection during shutdown;
- prompt shutdown handler return without pretending in-process inference was cancelled;
- generic unexpected-error envelope.

Primary test:

- `docker/coqui-local/tests/test_app.py`

### 2.9 Real Chromium validation harness

Implemented in `scripts/chromium-e2e.mjs`:

- canonical fixture consumption;
- exact synthesized semantic text comparison;
- rates `0.5`, `1`, `2`, `4`, and `10`;
- continuation, sentence, and paragraph gap measurements;
- direct production player counters rather than event-only inference;
- no reset of active-player state on request acceptance;
- rapid mixed-source replacement;
- explicit supersession checks;
- invalid-audio terminal failure;
- worker termination with queue continuation;
- reopened popup status recovery;
- Pause, Resume, and Cancel through a restarted worker.

Hosted execution result: _pending_.

### 2.10 CI hardening

Implemented in `.github/workflows/ci.yml`:

- immutable action commit revisions;
- normal `npm ci` instead of the peer-dependency bypass;
- explicit coverage thresholds;
- required JUnit and Chromium artifacts;
- minimum Chrome version manifest validation;
- existing lint, strict typecheck, builds, real Chromium, fake Coqui, Compose, and Codecov gates retained.

Hosted execution result: _pending_.

---

## 3. Environment-dependent validation support

### 3.1 Real Coqui harness

Implemented:

```text
scripts/validate-real-coqui.sh
```

It is designed to record:

- clean no-cache build;
- real model readiness;
- ping, readiness, voices, and WAV synthesis;
- MIME and RIFF validation;
- empty, oversized, and invalid-voice failures;
- loopback publication;
- temporary-file cleanup;
- service recreation;
- persistent model-volume population.

Execution result: **pending**. Script existence is not runtime evidence.

### 3.2 Listening evidence

Implemented:

```text
docs/CHROME_READIT_FIX2_LISTENING_EVIDENCE_TEMPLATE_2026-08-02.md
```

Execution result: **pending**.

---

## 4. Automated evidence ledger

| Gate | Exact SHA | Run / job / artifact | Result |
| --- | --- | --- | --- |
| npm install | pending | pending | pending |
| lint | pending | pending | pending |
| strict TypeScript | pending | pending | pending |
| extension unit/integration tests | pending | pending | pending |
| coverage thresholds | pending | pending | pending |
| production extension build | pending | pending | pending |
| diagnostic extension build | pending | pending | pending |
| real Chromium matrix | pending | pending | pending |
| fake Coqui service tests | pending | pending | pending |
| Compose security assertions | pending | pending | pending |
| Codecov upload | pending | pending | pending |

Do not replace `pending` with a result from an older SHA.

---

## 5. Pending corrective work

The following items must remain open until verified or implemented:

- final current-SHA CI convergence;
- removal or explicit final disposition of any remaining legacy playback-message adapter;
- CI status publisher rerun-attempt freshness validation;
- dependency graph confirmation without `--legacy-peer-deps`;
- final repository search and credential/history scan;
- real Coqui container/model/cache execution;
- structured human listening matrix;
- exact final SHA and artifact reconciliation in the FIX2 TODO.

---

## 6. Historical evidence

The exact pre-first-hardening local tool versions and baseline command outputs were not captured before that implementation began. They cannot be reconstructed reliably and must remain documented as unavailable historical evidence rather than fabricated or rerun against current code.

---

## 7. Final sign-off

- [ ] Final exact implementation SHA recorded.
- [ ] Every automated gate passed on that SHA.
- [ ] Chromium diagnostic artifact reviewed.
- [ ] JUnit artifact reviewed.
- [ ] Real Coqui evidence executed and attached.
- [ ] Listening matrix executed and signed.
- [ ] No dangerous fallback or silent failure remains unclassified.
- [ ] FIX2 TODO reconciled task by task.
- [ ] Repository and history hygiene evidence recorded.

**Release conclusion:** `NOT READY — validation in progress`
