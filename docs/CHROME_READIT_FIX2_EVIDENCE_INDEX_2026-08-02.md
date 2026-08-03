# Chrome Read It FIX2 Evidence Index

**Governing specification:** `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_SPEC_2026-08-02.md`  
**Governing TODO:** `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_TODO_2026-08-02.md`  
**Implementation ledger:** `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_IMPLEMENTATION_REPORT_2026-08-02.md`  
**Verified evidence addendum:** `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_EVIDENCE_ADDENDUM_2026-08-03.md`

---

## Automated gates

Verified automated candidate:

```text
SHA:      4986fae5dbf15b137ba7ebb38eb2f6af34cd67b3
CI run:   30804860232
Attempt:  1
Job:      91657730801
Result:   success
```

| Evidence | Location | Verified result |
| --- | --- | --- |
| Hosted build, type, unit, Chromium, Python, Compose, and coverage | `.github/workflows/ci.yml` | Passed on the exact SHA above |
| Dangerous fallback and silent-failure rejection | `scripts/check-fix2-hygiene.sh` through CI | Passed |
| Full-history non-disclosing secret scan | `scripts/check-secret-patterns.sh` through CI | Passed |
| Normal dependency installation | `npm ci` through CI | Passed without peer-dependency bypass |
| Canonical collision input | `fixtures/playback-collision.txt` | Used by unit and Chromium tests |
| Chromium diagnostic matrix | `scripts/chromium-e2e.mjs` | Passed; artifact `8852338751` |
| JUnit results | `.github/workflows/ci.yml` | 190 tests, 0 failures, 0 errors; artifact `8852321178` |
| Codecov upload | `.github/workflows/ci.yml` | Passed |

### Artifact integrity

| Artifact | Digest |
| --- | --- |
| `vitest-junit-30804860232` | `sha256:63da66d7a21c301f07007e078add104d775b57707fb2354bdc4ab4ab4e0ed199` |
| `chromium-e2e-30804860232` | `sha256:77e27dc1fbc7281dd82eaef1bcf2d5fc2f2672bbcaee4c2d8ea7c317a6173ffe` |

The Chromium artifact records `activePlayerCount: 0`, `maxActivePlayerCount: 1`, `cleanupFailureCount: 0`, and `invariantViolationCount: 0` after 48 synthesis requests across the fixture, rate, replacement, invalid-audio, and worker-restart scenarios.

## Real-model gate

| Evidence | Location | Final status |
| --- | --- | --- |
| Real Coqui procedure | `scripts/validate-real-coqui.sh` | Ready for execution |
| Hosted real Coqui workflow | `.github/workflows/real-coqui-validation.yml` | Triggered by dispatch or durable request file |
| Exact-SHA request | `docs/CHROME_READIT_FIX2_REAL_COQUI_VALIDATION_REQUEST.md` | Change triggers runtime validation |
| Harness contract tests | `docker/coqui-local/tests/test_validation_harness.py` | Structural evidence passed |
| Queue-aware container healthcheck | `docker/coqui-local/healthcheck.py` | Unit and Dockerfile contract tests passed |

Script or workflow presence does not prove real model initialization, synthesis, cache reuse, or temporary-file cleanup. Record the exact SHA, workflow run, image ID/digest, and retained artifact before marking this gate complete.

## Human listening gate

| Evidence | Location | Final status |
| --- | --- | --- |
| Structured listening matrix | `docs/CHROME_READIT_FIX2_LISTENING_EVIDENCE_TEMPLATE_2026-08-02.md` | Pending human execution and signature |

Automated playback completion and timing evidence cannot establish naturalness, clipping, audible seams, omissions, or repetition.

## Final repository hygiene

| Evidence | Location | Verified status |
| --- | --- | --- |
| Fallback and silent-failure scan | `scripts/check-fix2-hygiene.sh` | Passed in run `30804860232` |
| Current-tree and full-history credential patterns | `scripts/check-secret-patterns.sh` | Passed in run `30804860232` |
| No surviving one-shot workflows | `src/no-temporary-workflows.test.ts` | Passed |
| Consolidated guarded source state | `src/fix2-consolidated-state.test.ts` | Passed |
| Workflow immutability and rerun freshness | `src/ci-workflows.test.ts` | Passed |

---

## Sign-off rule

FIX2 is complete only when:

1. every permanent automated workflow is green on the same exact `master` SHA;
2. the JUnit and Chromium artifacts from that SHA have been reviewed;
3. real Coqui validation has executed against the release candidate and its image/cache evidence is retained;
4. the listening matrix has executed against the release candidate;
5. the implementation ledger and governing TODO record the exact evidence without converting pending work into a claim of success.

**Current disposition:** `PARTIAL — automated gates verified; real-model and human-listening evidence remain release-blocking.`
