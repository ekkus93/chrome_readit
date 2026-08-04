# Chrome Read It FIX2 Real Coqui Validation Request

**Requested:** 2026-08-03  
**Request sequence:** 23  
**Purpose:** Validate the clean, documentation-reconciled coverage-hardening head after removal of all temporary workflows, including all 292 TypeScript tests, all 57 Python tests, global and critical-file coverage gates, the complete hosted Chromium matrix, and the real-Coqui runtime matrix.  
**Ordinary CI:** The same commit must also pass `.github/workflows/ci.yml`.  
**Runtime status:** GitHub issue `#3` is overwritten at workflow start and completion.

The workflow must retain the established FIX2 evidence contract: actual VCTK model load and WAV synthesis with voice `p225`; readiness, voices, queue-full, timeout, cleanup, recreation, cache reuse, loopback-only publication, non-root identity, one Uvicorn worker, removed host-play/debug endpoints, immutable image ID, and attempt-specific artifact identity.

The same exact clean head must pass lint, typecheck, coverage-surface integrity, hygiene, full-history secret scanning, all TypeScript and Python tests and thresholds, production and diagnostic builds, manifest validation, the core/Block-13/UI Chromium matrices, Compose security validation, and both Codecov uploads.

This request is a trigger, not proof of success. GitHub issues `#2` and `#3` remain the authoritative current-run records. The implementation report records the completed implementation evidence on `2cf59436edef86f05b691a9c21f05836d741d407`; sequence 23 verifies that the reconciled repository head remains clean and green.
