# Chrome Read It Playback Hardening FIX2 Evidence Addendum

**Date:** 2026-08-03  
**Status:** `PARTIAL — automated gates verified; real model and human listening remain release-blocking`  
**Governing TODO:** `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_TODO_2026-08-02.md`  
**Implementation report:** `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_IMPLEMENTATION_REPORT_2026-08-02.md`

---

## 1. Verified automated candidate

The automated FIX2 candidate was verified on:

```text
SHA:      4986fae5dbf15b137ba7ebb38eb2f6af34cd67b3
CI run:   30804860232
Attempt:  1
Job:      91657730801
Result:   success
```

The hosted status publisher recorded that exact SHA, run, attempt, and successful conclusion in issue `#2`.

### Retained artifacts

| Artifact | ID | Digest |
| --- | ---: | --- |
| `vitest-junit-30804860232` | `8852321178` | `sha256:63da66d7a21c301f07007e078add104d775b57707fb2354bdc4ab4ab4e0ed199` |
| `chromium-e2e-30804860232` | `8852338751` | `sha256:77e27dc1fbc7281dd82eaef1bcf2d5fc2f2672bbcaee4c2d8ea7c317a6173ffe` |

---

## 2. JUnit evidence review

The retained JUnit document reports:

```text
tests:     190
failures:  0
errors:    0
```

The same run enforced minimum aggregate coverage thresholds:

```text
lines:       80%
functions:   80%
statements:  80%
branches:    70%
```

The coverage gate and Codecov upload both completed successfully.

---

## 3. Chromium evidence review

The retained Chromium diagnostic record reports:

```json
{
  "ok": true,
  "synthesizedRequests": 48,
  "player": {
    "activePlayerCount": 0,
    "maxActivePlayerCount": 1,
    "playAttemptCount": 43,
    "successfulPlayStartCount": 42,
    "settlementCount": 43,
    "cleanupFailureCount": 0,
    "lastCleanupFailureStage": null,
    "invariantViolationCount": 0
  }
}
```

The browser run directly verified:

- canonical collision fixture consumption;
- semantic text integrity;
- rate matrix `0.5`, `1`, `2`, `4`, and `10`;
- continuation, sentence, and paragraph pacing;
- direct active-player instrumentation;
- mixed-source rapid replacement;
- invalid-audio terminal failure;
- service-worker restart with offscreen continuation;
- popup status restoration after restart;
- Pause, Resume, and Cancel through the recreated worker.

This is direct player-ownership evidence, not inference from request acceptance events.

---

## 4. Other automated evidence on the same SHA

The following gates completed successfully:

- normal `npm ci` without `--legacy-peer-deps`;
- ESLint;
- strict TypeScript project build;
- permanent FIX2 hygiene scan;
- non-disclosing full-Git-history secret-pattern scan;
- production extension build;
- manifest and asset validation;
- diagnostic extension build;
- Coqui service test suite;
- Compose loopback and persistent-volume security assertions;
- immutable GitHub Action revisions;
- CI status publisher run-attempt freshness checks.

No temporary FIX2 patch workflow remains in the active tree.

---

## 5. Runtime evidence candidate

The real-model workflow now supports an exact-SHA request through:

```text
docs/CHROME_READIT_FIX2_REAL_COQUI_VALIDATION_REQUEST.md
```

A change to that durable request file triggers both ordinary CI and the dedicated `Real Coqui Validation` workflow on the same commit. The runtime workflow must prove a clean no-cache image build, real model initialization, endpoint behavior, WAV synthesis, loopback publication, temporary-file cleanup, container recreation, and model-cache persistence.

**Runtime result:** pending until a retained artifact is reviewed.

---

## 6. Human listening evidence

The structured listening matrix remains unexecuted:

```text
docs/CHROME_READIT_FIX2_LISTENING_EVIDENCE_TEMPLATE_2026-08-02.md
```

Automated completion, timing, and player-count evidence cannot establish audible clipping, pronunciation quality, naturalness, omissions, repetitions, or perceptible seam quality.

---

## 7. Current disposition

```text
PARTIAL — implementation and automated evidence are verified. Real Coqui/model/cache evidence and signed human listening evidence remain release-blocking.
```

Do not mark FIX2 `COMPLETE` until both remaining evidence blocks pass and the governing TODO is reconciled against their exact final SHA.
