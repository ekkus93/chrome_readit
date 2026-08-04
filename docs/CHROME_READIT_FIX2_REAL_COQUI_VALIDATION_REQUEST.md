# Chrome Read It FIX2 Real Coqui Validation Request

**Requested:** 2026-08-03  
**Request sequence:** 28  
**Purpose:** Validate the final clean, documentation-reconciled coverage-hardening head after the offscreen sender-routing repair, including all 294 TypeScript tests, all 57 Python tests, global and critical-file coverage gates, the complete hosted Chromium matrix, and the real-Coqui runtime matrix.  
**Ordinary CI:** The same commit must also pass `.github/workflows/ci.yml`.  
**Runtime status:** GitHub issue `#3` is overwritten at workflow start and completion.

The workflow must retain the established FIX2 evidence contract: actual VCTK model load and WAV synthesis with voice `p225`; readiness, voices, queue-full, timeout, cleanup, recreation, cache reuse, loopback-only publication, non-root identity, one Uvicorn worker, removed host-play/debug endpoints, immutable image ID, and attempt-specific artifact identity.

The same exact clean head must pass lint, typecheck, coverage-surface integrity, hygiene, full-history secret scanning, all TypeScript and Python tests and thresholds, production and diagnostic builds, manifest validation, the core/Block-13/UI Chromium matrices, Compose security validation, and both Codecov uploads.

This request is a trigger, not proof of success. GitHub issues `#2` and `#3` remain the authoritative current-run records. Permanent CI `30879304676` established the repaired implementation evidence on `740a86e2912615ba1b1868feb9709d82d78aafd6`; sequence 28 verifies the final repository after ordered evidence reconciliation, artifact reconciliation, self-cleaning helper removal, and restoration of the permanent read-only CI and FIX2 hygiene workflows.
