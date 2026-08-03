# Chrome Read It FIX2 Real Coqui Validation Request

**Requested:** 2026-08-03  
**Request sequence:** 3  
**Purpose:** Trigger the durable `Real Coqui Validation` workflow on this exact commit.  
**Ordinary CI:** The same commit must also pass `.github/workflows/ci.yml`.  
**Runtime status:** GitHub issue `#3` is overwritten at workflow start and completion.

The runtime workflow must retain evidence for:

- clean no-cache image build;
- actual Coqui VCTK model initialization;
- `/api/ping`, `/api/ready`, and `/api/voices`;
- non-empty structurally valid WAV synthesis;
- empty, oversized, and invalid-voice failure envelopes;
- loopback-only host publication;
- temporary-file cleanup after synthesis;
- container recreation with persistent model-cache reuse;
- candidate image and volume metadata.

This request file is a durable validation entry point, not proof that the workflow passed. Record the resulting exact SHA, run ID, attempt, job, artifact ID, image identity, and runtime result in the FIX2 evidence addendum before changing the overall disposition.
