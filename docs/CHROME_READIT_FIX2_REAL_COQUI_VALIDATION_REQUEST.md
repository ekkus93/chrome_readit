# Chrome Read It FIX2 Real Coqui Validation Request

**Requested:** 2026-08-03  
**Request sequence:** 9  
**Purpose:** Trigger the durable `Real Coqui Validation` workflow on this exact commit.  
**Ordinary CI:** The same commit must also pass `.github/workflows/ci.yml`.  
**Runtime status:** GitHub issue `#3` is overwritten at workflow start and completion.

The runtime workflow must retain evidence for:

- cold model-volume reset and clean no-cache image build;
- exact candidate image identity, non-root container identity, and single Uvicorn worker;
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
- service-worker restart and control routing;
- real foreground popup and Options interactions;
- selection → popup → Options → selection → selection replacement;
- popup and Options supersession recovery even when a playback event is missed;
- popup and Options pause/resume/cancel controls;
- retained, fail-closed Chromium and JUnit artifacts.

This request file is a durable validation entry point, not proof that the workflow passed. Record the resulting exact SHA, run IDs, attempts, job IDs, artifact IDs/digests, image identity, browser result, and runtime result in the FIX2 evidence addendum before changing the overall disposition.
