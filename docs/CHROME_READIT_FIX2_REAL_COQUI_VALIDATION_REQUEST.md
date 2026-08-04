# Chrome Read It FIX2 Real Coqui Validation Request

**Requested:** 2026-08-03  
**Request sequence:** 26  
**Purpose:** Validate the final clean, documentation-reconciled coverage-hardening head after removal of all temporary workflows and helper scripts, including all 292 TypeScript tests, all 57 Python tests, global and critical-file coverage gates, the complete hosted Chromium matrix, and the real-Coqui runtime matrix.  
**Ordinary CI:** The same commit must also pass `.github/workflows/ci.yml`.  
**Runtime status:** GitHub issue `#3` is overwritten at workflow start and completion.

The workflow must retain the established FIX2 evidence contract: actual VCTK model load and WAV synthesis with voice `p225`; readiness, voices, queue-full, timeout, cleanup, recreation, cache reuse, loopback-only publication, non-root identity, one Uvicorn worker, removed host-play/debug endpoints, immutable image ID, and attempt-specific artifact identity.

The same exact clean head must pass lint, typecheck, coverage-surface integrity, hygiene, full-history secret scanning, all TypeScript and Python tests and thresholds, production and diagnostic builds, manifest validation, the core/Block-13/UI Chromium matrices, Compose security validation, and both Codecov uploads.

This request is a trigger, not proof of success. GitHub issues `#2` and `#3` remain the authoritative current-run records. Sequence 25 established the implementation evidence on `48add9a93e73c0e867763b08daa4e745a3c4bdbd`; sequence 26 verifies the repository after final TODO, implementation-report, evidence-index, README, and workflow-hygiene reconciliation.
