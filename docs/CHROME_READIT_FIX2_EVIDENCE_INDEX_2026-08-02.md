# Chrome Read It FIX2 Evidence Index

**Governing specification:** `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_SPEC_2026-08-02.md`  
**Governing TODO:** `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_TODO_2026-08-02.md`  
**Implementation ledger:** `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_IMPLEMENTATION_REPORT_2026-08-02.md`

---

## Automated gates

| Evidence | Location | Final status |
| --- | --- | --- |
| Hosted build, type, unit, Chromium, Python, Compose, and coverage | `.github/workflows/ci.yml` | Record exact final run in implementation ledger |
| Dangerous fallback and silent-failure rejection | `.github/workflows/fix2-hygiene.yml` | Record exact final run |
| Full-history non-disclosing secret scan | `.github/workflows/secret-pattern-scan.yml` | Record exact final run |
| Local fail-fast command order | `scripts/validate-fix2.sh` | Supporting procedure |
| Environment capture | `scripts/capture-fix2-environment.sh` | Attach to final evidence |
| Canonical collision input | `fixtures/playback-collision.txt` | Used by unit and Chromium tests |
| Chromium diagnostic matrix | `scripts/chromium-e2e.mjs` | Retain `chromium-e2e-*` artifact |
| JUnit results | `.github/workflows/ci.yml` | Retain `vitest-junit-*` artifact |

## Real-model gate

| Evidence | Location | Final status |
| --- | --- | --- |
| Local real Coqui procedure | `scripts/validate-real-coqui.sh` | Must be executed |
| Opt-in hosted real Coqui run | `.github/workflows/real-coqui-validation.yml` | Alternative execution surface |
| Harness contract tests | `docker/coqui-local/tests/test_validation_harness.py` | Automated structural evidence only |
| Queue-aware container healthcheck | `docker/coqui-local/healthcheck.py` | Unit and Dockerfile contract tests |

Script or workflow presence does not prove real model initialization, synthesis, cache reuse, or temporary-file cleanup. Record the exact implementation SHA, run ID, image ID, and retained artifact before marking this gate complete.

## Human listening gate

| Evidence | Location | Final status |
| --- | --- | --- |
| Structured listening matrix | `docs/CHROME_READIT_FIX2_LISTENING_EVIDENCE_TEMPLATE_2026-08-02.md` | Must be executed and signed |

Automated playback completion and timing evidence cannot establish naturalness, clipping, audible seams, omissions, or repetition.

## Final repository hygiene

| Evidence | Location | Final status |
| --- | --- | --- |
| Fallback and silent-failure scan | `scripts/check-fix2-hygiene.sh` | Required |
| Current-tree and full-history credential patterns | `scripts/check-secret-patterns.sh` | Required |
| No surviving one-shot workflows | `src/no-temporary-workflows.test.ts` | Required |
| Consolidated guarded source state | `src/fix2-consolidated-state.test.ts` | Required |
| Workflow immutability and rerun freshness | `src/ci-workflows.test.ts` | Required |

---

## Sign-off rule

FIX2 is complete only when:

1. every permanent automated workflow is green on the same exact `master` SHA;
2. the JUnit and Chromium artifacts from that SHA have been reviewed;
3. real Coqui validation has executed against that SHA and its image/cache evidence is retained;
4. the listening matrix has executed against that SHA;
5. the implementation ledger and governing TODO record the exact evidence without converting pending work into a claim of success.
