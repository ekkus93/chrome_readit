# Chrome Read It FIX2 Real Coqui Validation Request

**Requested:** 2026-08-03  
**Request sequence:** 14  
**Purpose:** Validate the complete Chromium Block 13 fault, restart, pacing, command-registration, global-control, and offscreen-recovery matrix together with the real-Coqui evidence matrix on one exact final candidate.  
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

- direct active-player instrumentation with a maximum count of one;
- canonical fixture and rate-matrix playback;
- rejected and synchronously thrown `audio.play()` calls;
- media-error and duplicate-ended settlement;
- fail-closed cleanup-failure injection and recovery;
- TTS HTTP failure, timeout, and oversized streamed-response handling;
- invalid offscreen response rejection;
- service-worker restart during synthesis, paused playback, and transition waits;
- pause/resume preservation of the remaining transition delay;
- Chrome registration of the playback command names and exact manifest shortcut suggestions;
- recording of active runtime shortcut assignment, including a valid unassigned result caused by collision or environment state;
- session-global pause, resume, and cancel routing without an expected session ID;
- offscreen destruction, interruption classification, and unique-session recovery;
- real foreground popup and Options interactions;
- selection → popup → Options → selection → selection replacement;
- explicit terminal `SESSION_SUPERSEDED` event normalization on Popup and Options;
- popup and Options supersession recovery while the superseded surface is foregrounded;
- popup and Options pause/resume/cancel controls;
- retained, fail-closed Chromium and JUnit artifacts.

This request file is a durable validation entry point, not proof that the workflow passed. Record the resulting exact SHA, run IDs, attempts, job IDs, artifact IDs/digests, configured image reference, immutable image ID, browser result, and runtime result in the FIX2 evidence addendum before changing the overall disposition.
