# Chrome Read It Playback Hardening Implementation Addendum

**Date:** 2026-08-02  
**Branch:** `master`  
**Base report:** `docs/CHROME_READIT_PLAYBACK_HARDENING_IMPLEMENTATION_REPORT_2026-08-02.md`  
**Status:** Source implementation complete enough for clean-gate validation; runtime sign-off remains pending.

## Changes completed after the base report snapshot

### Fail-visible offscreen interruption

The background router now persists the last valid `PlaybackStatus` in `chrome.storage.session` whenever the offscreen coordinator emits an event.

When a worker restart or later status/control request finds that:

- the durable status identifies a non-terminal active session; and
- the recreated offscreen document reports `idle` or `SESSION_NOT_FOUND`;

the router reports the original session as `failed` with the stable error code `OFFSCREEN_INTERRUPTED`. It preserves the last known session ID, request ID, source, chunk, paragraph, and total progress instead of silently converting an interrupted reading into an ordinary idle state.

A focused worker-router test now simulates an active durable session followed by a recreated idle offscreen document and requires both the returned and persisted status to contain `OFFSCREEN_INTERRUPTED`.

### Pause during synthesis

The coordinator now re-checks pause state after the current synthesis promise resolves and before it creates an object URL or calls `play()`. A deferred-fetch regression test proves that audio fetched while paused does not start until Resume.

### Error classification

Unexpected synthesis-client failures are normalized to `TTS_FETCH_FAILED` rather than being mislabeled as browser audio failures. Resume failures transition the current session to terminal `failed` state with `AUDIO_PLAYBACK_FAILED`.

### Target-aware packing

Sentence packing now uses the configured target size as an actual boundary heuristic. Once the current chunk has meaningful content, the packer chooses the complete-sentence boundary that is closer to the target instead of filling every chunk to the soft maximum. A focused regression test verifies the target preference.

### Reopened UI status

Popup and Options now query `SPEECH_STATUS` on mount, subscribe to shared events, and display current state and chunk/paragraph progress. Closing and reopening either UI no longer implies that playback is idle.

### Additional cleanup

The remaining obsolete host-audio Node server and the full legacy Docker service were removed. Current source searches should find only the intentional offscreen `new Audio()` construction; historical review documents may still quote removed identifiers and are explicitly classified as historical in `docs/README.md`.

## Validation state

No command is newly claimed as passed by this addendum. The authoritative clean-checkout validation remains:

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

Real Docker/model and structured listening validation remain required before final completion. The current environment still cannot provide a local checkout, and the available GitHub connector does not expose push-triggered Actions job logs. Therefore the correct status remains:

> **Source implementation substantially complete; exact-SHA runtime, Docker, and listening sign-off pending.**
