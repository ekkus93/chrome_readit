# Chrome Read It FIX2 Real Coqui Validation Request

**Requested:** 2026-08-03  
**Request sequence:** 20  
**Purpose:** Validate the comprehensive test-coverage hardening implementation, the stale Popup/Options playback-control session-race fix, the deterministic ten-second paused-worker-restart fixture, all 291 TypeScript tests, all 57 Python tests, expanded TypeScript and Python branch-coverage gates, permanent attempt-specific evidence artifacts, complete Chromium Block 13 matrix, and real-Coqui runtime matrix together on one exact final candidate.  
**Ordinary CI:** The same commit must also pass `.github/workflows/ci.yml`.  
**Runtime status:** GitHub issue `#3` is overwritten at workflow start and completion.

The runtime workflow must retain evidence for:

- cold model-volume reset and clean no-cache image build;
- deterministic configured image reference and immutable candidate image ID;
- non-root container identity and single Uvicorn worker;
- actual Coqui VCTK model initialization;
- `/api/ping`, `/api/ready`, and `/api/voices`;
- non-empty structurally valid WAV synthesis using the configured VCTK voice `p225`;
- empty, oversized, invalid-voice, queue-full, and synthesis-timeout failure envelopes;
- structured Compose and host-socket proof of loopback-only publication;
- removed host-play/debug endpoints returning 404;
- temporary-file state before, during, and after synthesis, saturation, and timeout;
- container recreation with persistent model-cache manifest reuse;
- bounded normal and timeout-probe shutdown;
- candidate image, volume, duration, process, socket, and container-log metadata.

The same exact candidate must validate:

- the complete intended TypeScript production coverage surface and exact approved exclusions;
- all 291 TypeScript tests and all 57 Python tests;
- global TypeScript statement, line, function, and branch thresholds;
- critical-file TypeScript line and branch floors;
- Python statement and branch thresholds for the Coqui service and healthcheck;
- attempt-specific TypeScript, Python, JUnit, and Chromium evidence artifacts;
- direct active-player instrumentation with a maximum count of one;
- canonical fixture and rate-matrix playback;
- rejected and synchronously thrown `audio.play()` calls;
- media-error and duplicate-ended settlement;
- fail-closed cleanup-failure injection and recovery;
- TTS HTTP failure, timeout, and oversized streamed-response handling;
- invalid offscreen response rejection;
- service-worker restart during synthesis, paused playback, and transition waits;
- the paused-worker-restart scenario retaining an observable paused state through a dedicated ten-second audio fixture before the worker is terminated;
- pause/resume preservation of the remaining transition delay;
- Chrome registration of the playback command names and exact manifest shortcut suggestions;
- recording of active runtime shortcut assignment, including a valid unassigned result caused by collision or environment state;
- direct `activePlayerCount === 1` evidence before session-global control and offscreen-destruction operations;
- session-global pause, resume, and cancel routing without an expected session ID;
- offscreen destruction, interruption classification, and unique-session recovery;
- real foreground popup and Options interactions;
- selection → popup → Options → selection → selection replacement;
- explicit terminal `SESSION_SUPERSEDED` event normalization on Popup and Options;
- popup and Options supersession recovery while the superseded surface is foregrounded;
- Popup and Options refreshing authoritative playback status before Pause, Resume, or Cancel so controls cannot target a superseded session;
- popup and Options pause/resume/cancel controls;
- one bounded retry when a Chrome profile cleanup race masks the harness verdict, with no conversion of an unverified run into success;
- retained, fail-closed Chromium and JUnit artifacts.

This request file is a durable validation entry point, not proof that the workflow passed. Record the resulting exact SHA, run IDs, attempts, job IDs, artifact IDs/digests, configured image reference, immutable image ID, browser result, coverage results, and runtime result in the coverage-hardening implementation report and the authoritative status issues before changing the overall disposition.
