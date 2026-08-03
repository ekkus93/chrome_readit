# Chrome Read It FIX2 Listening Evidence

**Status:** Not yet executed  
**Governing TODO:** `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_TODO_2026-08-02.md`  
**Exact implementation SHA:** _record before testing_  
**Extension build SHA:** _record before testing_  
**Chrome version:** _record_  
**Docker image ID:** _record_  
**Coqui model:** _record_  
**Host and audio device:** _record_  
**Tester:** _record_  
**Date/time:** _record_

---

## Rules

1. Use a real unpacked production extension build, not a fake WAV server.
2. Use the real Docker Coqui service and record its image ID.
3. Do not mark an entry passed merely because playback completed.
4. Listen for omitted words, duplicated words, overlap, clipped starts or ends, unnatural seams, and incorrect paragraph pauses.
5. Record an exact reproduction for every defect.
6. Attach the corresponding playback diagnostic export and Docker logs when a run fails.
7. Do not edit a failed result into a pass. Add a new retest row for a later SHA.

---

## Required text fixtures

### L1 — Canonical collision fixture

Use `fixtures/playback-collision.txt` without editing it.

### L2 — Ordinary prose

Use three paragraphs of ordinary prose containing short and medium sentences.

### L3 — Long sentences

Use at least two sentences over 500 Unicode code points, including commas, semicolons, colons, and em dashes.

### L4 — Abbreviations, numbers, domains, and URLs

Include at least:

```text
3.14
1.2.3
Dr. Élodie
The U.S. Army
5 p.m. Monday
123 Main St. near the park
example.com
person@example.com
https://example.com/path?x=1&y=2
```

### L5 — Rapid replacement and controls

Start normal selection playback, replace it with popup test speech, replace that with Options test speech, then exercise Pause, Resume, and Cancel.

---

## Required rates

Test every fixture at:

```text
0.5
1
2
4
10
```

A lower subset is not sufficient for final sign-off.

---

## Evidence table

Add one row for every fixture/rate/voice combination actually tested.

| Run | SHA | Fixture | Voice | Rate | Complete text | No repetition | No overlap | Starts/ends intact | Sentence seams acceptable | Paragraph pauses distinct | Controls correct | Result | Notes / artifact paths |
| --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 |  | L1 |  | 0.5 |  |  |  |  |  |  |  | NOT RUN |  |
| 2 |  | L1 |  | 1 |  |  |  |  |  |  |  | NOT RUN |  |
| 3 |  | L1 |  | 2 |  |  |  |  |  |  |  | NOT RUN |  |
| 4 |  | L1 |  | 4 |  |  |  |  |  |  |  | NOT RUN |  |
| 5 |  | L1 |  | 10 |  |  |  |  |  |  |  | NOT RUN |  |

Duplicate those rows for L2 through L5 and for every additional voice selected for validation.

---

## Timing and diagnostic review

For each rate, record representative measured gaps from playback diagnostics:

| Rate | Continuation gap | Sentence gap | Paragraph gap | Ordering correct | Notes |
| ---: | ---: | ---: | ---: | --- | --- |
| 0.5 |  |  |  |  |  |
| 1 |  |  |  |  |  |
| 2 |  |  |  |  |  |
| 4 |  |  |  |  |  |
| 10 |  |  |  |  |  |

Required ordering:

```text
paragraph > sentence > continuation
```

Do not substitute calculated configuration values for observed diagnostic timestamps.

---

## Failure record

For each failure, add a section in this form:

```text
Failure ID:
Exact SHA:
Fixture / voice / rate:
User workflow:
Expected:
Observed:
First incorrect word or transition:
Audible overlap present:
Omission or repetition present:
Playback session ID:
Diagnostic artifact:
Docker log artifact:
Reproduces consistently:
Corrective commit:
Retest row:
```

---

## Final listening sign-off

- [ ] Every required fixture was tested.
- [ ] Every required rate was tested.
- [ ] At least one multi-speaker-model voice was tested.
- [ ] No audible simultaneous playback occurred.
- [ ] No omitted or duplicated semantic text occurred.
- [ ] Sentence and paragraph transitions remained distinguishable at rate 10.
- [ ] Rapid mixed-source replacement behaved correctly.
- [ ] Pause, Resume, and Cancel behaved correctly.
- [ ] Every failure has a corrective commit and a recorded retest.
- [ ] Evidence references an exact implementation SHA and Docker image ID.

**Final result:** `NOT RUN`  
**Signer:** _pending_  
**Date:** _pending_
