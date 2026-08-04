# Chrome Read It FIX2 Evidence Index

- Governing TODO: `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_TODO_2026-08-02.md`
- Implementation report: `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_IMPLEMENTATION_REPORT_2026-08-02.md`
- Evidence addendum: `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_EVIDENCE_ADDENDUM_2026-08-03.md`
- Block 17 reconciliation: `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_BLOCK17_RECONCILIATION_2026-08-03.md`
- Listening record: `docs/CHROME_READIT_FIX2_LISTENING_EVIDENCE_TEMPLATE_2026-08-02.md`

## Verified candidate `31702133a5afd326902aa8f5bdfb6e2afe5dfe28`

| Gate | Evidence | Status |
| --- | --- | --- |
| Hosted quality gates | CI `30854518356`, job `91822266603` | Passed |
| Tests | JUnit `8871921734`: 213/0/0 | Passed |
| Chromium | artifact `8871945713` | Passed |
| Real model/cache | run `30854518366`, artifact `8872045367` | Passed |
| Hygiene/history secret scan | CI `30854518356` | Passed |
| Human listening | listening template | `NOT RUN` |

**Disposition:** `PARTIAL`. Block 17 is complete; Block 16 and final exact-SHA reruns remain.


## Automated test-coverage hardening

- Specification: `docs/CHROME_READIT_TEST_COVERAGE_HARDENING_SPEC_2026-08-03.md`
- Governing TODO: `docs/CHROME_READIT_TEST_COVERAGE_HARDENING_TODO_2026-08-03.md`
- Implementation report: `docs/CHROME_READIT_TEST_COVERAGE_HARDENING_IMPLEMENTATION_REPORT_2026-08-03.md`
- Validated implementation SHA: `48add9a93e73c0e867763b08daa4e745a3c4bdbd`
- Permanent CI: run `30875845758`, attempt 1, job `91887032415`
- Real-Coqui: run `30875845769`, attempt 1, job `91887025434`

| Evidence | Artifact ID | Digest |
|---|---:|---|
| Vitest JUnit | `8879508312` | `sha256:6e9efa1329b7c2d72717f11e503606c477e59fb45ad7aec682a9128e05d974a6` |
| TypeScript coverage | `8879508449` | `sha256:500f751a987c7ae594a1f6381415c0328b0cb6f0ad860eb2a1a3dae97b110a67` |
| Chromium E2E | `8879522956` | `sha256:b74f01497c74f28cece77569cbe2d65add9ae415e1d6746be4620d3a42e49e90` |
| Python coverage/JUnit | `8879525536` | `sha256:f0a9b1c4dde72359554d0ef7a546db9eda65d000ee23d8e2381496d8040447b6` |
| Real Coqui | `8879576839` | `sha256:b12b6b89faa66372a372e54ef99c57394cf758a521107ab9e0b8d95993bbf4d3` |

The automated workstream is complete. FIX2 human listening remains **Not yet executed** and is not replaced by these artifacts.
