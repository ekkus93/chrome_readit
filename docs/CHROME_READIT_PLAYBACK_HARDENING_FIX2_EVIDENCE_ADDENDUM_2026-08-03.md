# Chrome Read It Playback Hardening FIX2 Evidence Addendum

**Status:** `PARTIAL — automated and real-model gates verified; human listening remains release-blocking`

## Exact candidate

- SHA `31702133a5afd326902aa8f5bdfb6e2afe5dfe28`
- CI `30854518356`, attempt 1, job `91822266603`, success
- Real Coqui `30854518366`, attempt 1, success

## Artifacts

- JUnit `8871921734`: 213 tests, 0 failures, 0 errors
- Chromium `8871945713`: maximum active-player count 1; no cleanup/invariant failure
- Real Coqui `8872045367`: `sha256:48022304418b783e7d553c70bbce42fd487554718835a41d0c5df1d546824279`
- Runtime image `sha256:c09634d6df082265846c9cd8ba7a326ea3303915981e0f91854e818e07bc38f5`

The browser matrix covered canonical text integrity, rates 0.5/1/2/4/10, replacement, fault injection, worker restart, commands, offscreen destruction/recovery, and foreground popup/Options workflows. The runtime matrix covered VCTK `p225`, valid WAV, 400/413/429/504 envelopes, saturation-aware readiness, loopback-only publication, non-root one-worker execution, tempfile lifecycle, bounded shutdown, and cache reuse.

## Remaining gate

`docs/CHROME_READIT_FIX2_LISTENING_EVIDENCE_TEMPLATE_2026-08-02.md` is still `NOT RUN`. FIX2 remains `PARTIAL` until listening passes and final exact-SHA CI plus real-Coqui validation pass afterward.
