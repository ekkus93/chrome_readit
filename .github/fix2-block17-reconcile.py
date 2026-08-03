from pathlib import Path
import re

SHA='31702133a5afd326902aa8f5bdfb6e2afe5dfe28'; CI='30854518356'; JOB='91822266603'
JUNIT='8871921734'; CHROMIUM='8871945713'; COQUI='30854518366'; CART='8872045367'
DIGEST='sha256:48022304418b783e7d553c70bbce42fd487554718835a41d0c5df1d546824279'
IMAGE='sha256:c09634d6df082265846c9cd8ba7a326ea3303915981e0f91854e818e07bc38f5'

def load(p): return Path(p).read_text(encoding='utf-8')
def save(p,s): Path(p).write_text(s.rstrip()+'\n',encoding='utf-8')
def once(s,a,b,label):
    if a not in s: raise RuntimeError(f'missing {label}')
    return s.replace(a,b,1)

# Governing TODO.
p='docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_TODO_2026-08-02.md'; s=load(p)
s=once(s,'**Status:** Ready for implementation  ','**Status:** PARTIAL — automated and real-model validation passed; Block 16 listening and final exact-SHA sign-off remain  ','TODO status')
marker='**Predecessor TODO:** `docs/CHROME_READIT_PLAYBACK_HARDENING_TODO_2026-08-02.md`\n\n---'
summary=f'''**Predecessor TODO:** `docs/CHROME_READIT_PLAYBACK_HARDENING_TODO_2026-08-02.md`

## Reconciled evidence status — 2026-08-03

- Candidate `{SHA}` passed CI `{CI}` (attempt 1, job `{JOB}`) and real Coqui `{COQUI}` (attempt 1, artifact `{CART}`).
- CI artifacts: JUnit `{JUNIT}` (213 tests, 0 failures/errors) and Chromium `{CHROMIUM}` (`maxActivePlayerCount=1`, no invariant violation).
- Human listening remains **NOT RUN**. Current disposition: **PARTIAL**.
- Block 17 record: `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_BLOCK17_RECONCILIATION_2026-08-03.md`.

---'''
if '## Reconciled evidence status — 2026-08-03' not in s: s=once(s,marker,summary,'TODO summary')
a=s.index('## 17. Documentation reconciliation and repository hygiene — P1'); b=s.index('## 18. Full validation gate',a)
sec=s[a:b]
if '**Block status:** `COMPLETE`' not in sec:
    sec=sec.replace('## 17. Documentation reconciliation and repository hygiene — P1\n','## 17. Documentation reconciliation and repository hygiene — P1\n\n**Block status:** `COMPLETE`; Block 16 and final release sign-off remain open.\n',1)
sec=sec.replace('- [ ]','- [x]'); s=s[:a]+sec+s[b:]
s=s.replace('- [ ] Complete Block 15 real Docker/model validation.\n- [ ] Complete Block 16 structured listening validation.','- [x] Complete Block 15 real Docker/model validation.\n- [ ] Complete Block 16 structured listening validation.',1)
fm='Never use “complete” as a synonym for “code was written” or “ordinary CI is green.”'
if '**Current reconciled decision (2026-08-03):**' not in s:
    s=once(s,fm,fm+f'\n\n**Current reconciled decision (2026-08-03):** `PARTIAL` — CI and real Coqui passed on `{SHA}`; listening and final reruns remain.','TODO decision')
save(p,s)

# Historical predecessor status.
p='docs/CHROME_READIT_PLAYBACK_HARDENING_TODO_2026-08-02.md'; s=load(p)
note=f'> **Historical status — 2026-08-03:** Superseded by the FIX2 TODO. Candidate `{SHA}` passed automated and real-Coqui validation, but human listening is `NOT RUN`; this predecessor is not a completion claim.\n\n'
if '> **Historical status — 2026-08-03:**' not in s:
    i=s.find('\n---\n');
    if i<0: raise RuntimeError('predecessor separator missing')
    s=s[:i+1]+note+s[i+1:]
save(p,s)

# Implementation report: authoritative header plus reconciled evidence sections.
p='docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_IMPLEMENTATION_REPORT_2026-08-02.md'; s=load(p)
s=once(s,'**Status:** Implementation and validation in progress  ','**Status:** `PARTIAL — automated and real-model validation passed; human listening remains release-blocking`  ','report status')
s=once(s,'**FIX2 final implementation SHA:** _pending_  ',f'**Verified implementation/runtime candidate:** `{SHA}`  \n**Final release SHA:** _pending Block 16 and final exact-SHA rerun_  ','report SHA')
s=once(s,'**Final CI run:** _pending_  ',f'**Final verified CI candidate:** run `{CI}`, attempt `1`, job `{JOB}`, `success`  ','report CI')
s=once(s,'**Real Coqui evidence:** _pending_  ',f'**Real Coqui evidence:** run `{COQUI}`, attempt `1`, artifact `{CART}`, `success`  ','report Coqui')
s=once(s,'**Listening evidence:** _pending_', '**Listening evidence:** `NOT RUN`','report listening')
insert=f'''---

## Authoritative Block 17 reconciliation — 2026-08-03

Candidate `{SHA}` passed hosted CI `{CI}` and real Coqui `{COQUI}` on the same exact SHA. JUnit artifact `{JUNIT}` reports 213 tests with no failures/errors. Chromium artifact `{CHROMIUM}` directly recorded maximum one active player and no invariant violation. Runtime artifact `{CART}` (`{DIGEST}`) proved VCTK `p225` synthesis, loopback-only publication, non-root single-worker execution, truthful queue/timeout behavior, eventual tempfile cleanup, bounded shutdown, and cache reuse.

Historical FIX1 evidence remains baseline SHA `032265d9f10d87012e13057177f0463dc96ec211`, CI run `30785364984`, job `91597786574`, success. Missing pre-hardening local outputs remain unavailable rather than reconstructed.

**Remaining release work:** execute/sign Block 16, commit any retest evidence, rerun CI and real Coqui on the final exact SHA, then record the final release SHA.
'''
if '## Authoritative Block 17 reconciliation — 2026-08-03' not in s: s=s.replace('---\n',insert,1)
s=s.replace('Hosted execution result: _pending_.',f'Hosted execution result: **passed in CI run `{CI}` on `{SHA}`**.')
s=s.replace('Execution result: **pending**. Script existence is not runtime evidence.',f'Execution result: **passed in real-Coqui run `{COQUI}`, artifact `{CART}`, on `{SHA}`**.')
s=re.sub(r'## 4\. Automated evidence ledger\n.*?\n---\n\n## 5\.',f'''## 4. Automated evidence ledger

| Gate | Evidence | Result |
| --- | --- | --- |
| Install/lint/type/build/coverage/hygiene/secret scan | CI `{CI}` | Passed |
| Unit/integration | JUnit `{JUNIT}` | 213 tests; 0 failures/errors |
| Chromium | artifact `{CHROMIUM}` | Passed; maximum one player |
| Real model/cache/runtime | run `{COQUI}`, artifact `{CART}` | Passed |

---

## 5.''',s,flags=re.S)
s=re.sub(r'## 5\. Pending corrective work\n.*?\n---\n\n## 6\.',f'''## 5. Pending corrective work

- Block 16 structured human listening and signature.
- Final post-listening exact-SHA CI and real-Coqui rerun.
- Final release SHA and COMPLETE disposition only after those gates pass.

---

## 6.''',s,flags=re.S)
s=s.replace('**Release conclusion:** `NOT READY — validation in progress`','**Release conclusion:** `PARTIAL — Block 17 complete; Block 16 and final exact-SHA sign-off remain.`')
save(p,s)

# Replace stale evidence addendum and index with concise authoritative records.
save('docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_EVIDENCE_ADDENDUM_2026-08-03.md',f'''# Chrome Read It Playback Hardening FIX2 Evidence Addendum

**Status:** `PARTIAL — automated and real-model gates verified; human listening remains release-blocking`

## Exact candidate

- SHA `{SHA}`
- CI `{CI}`, attempt 1, job `{JOB}`, success
- Real Coqui `{COQUI}`, attempt 1, success

## Artifacts

- JUnit `{JUNIT}`: 213 tests, 0 failures, 0 errors
- Chromium `{CHROMIUM}`: maximum active-player count 1; no cleanup/invariant failure
- Real Coqui `{CART}`: `{DIGEST}`
- Runtime image `{IMAGE}`

The browser matrix covered canonical text integrity, rates 0.5/1/2/4/10, replacement, fault injection, worker restart, commands, offscreen destruction/recovery, and foreground popup/Options workflows. The runtime matrix covered VCTK `p225`, valid WAV, 400/413/429/504 envelopes, saturation-aware readiness, loopback-only publication, non-root one-worker execution, tempfile lifecycle, bounded shutdown, and cache reuse.

## Remaining gate

`docs/CHROME_READIT_FIX2_LISTENING_EVIDENCE_TEMPLATE_2026-08-02.md` is still `NOT RUN`. FIX2 remains `PARTIAL` until listening passes and final exact-SHA CI plus real-Coqui validation pass afterward.
''')
save('docs/CHROME_READIT_FIX2_EVIDENCE_INDEX_2026-08-02.md',f'''# Chrome Read It FIX2 Evidence Index

- Governing TODO: `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_TODO_2026-08-02.md`
- Implementation report: `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_IMPLEMENTATION_REPORT_2026-08-02.md`
- Evidence addendum: `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_EVIDENCE_ADDENDUM_2026-08-03.md`
- Block 17 reconciliation: `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_BLOCK17_RECONCILIATION_2026-08-03.md`
- Listening record: `docs/CHROME_READIT_FIX2_LISTENING_EVIDENCE_TEMPLATE_2026-08-02.md`

## Verified candidate `{SHA}`

| Gate | Evidence | Status |
| --- | --- | --- |
| Hosted quality gates | CI `{CI}`, job `{JOB}` | Passed |
| Tests | JUnit `{JUNIT}`: 213/0/0 | Passed |
| Chromium | artifact `{CHROMIUM}` | Passed |
| Real model/cache | run `{COQUI}`, artifact `{CART}` | Passed |
| Hygiene/history secret scan | CI `{CI}` | Passed |
| Human listening | listening template | `NOT RUN` |

**Disposition:** `PARTIAL`. Block 17 is complete; Block 16 and final exact-SHA reruns remain.
''')
save('docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_BLOCK17_RECONCILIATION_2026-08-03.md',f'''# Chrome Read It FIX2 Block 17 Reconciliation

**Status:** `COMPLETE`  
**Evidence candidate:** `{SHA}`  
**Overall FIX2:** `PARTIAL`

| Task | Result |
| --- | --- |
| 17.1 governing docs | Updated TODOs, report, addendum, index, README, and Docker README |
| 17.2 misleading claims | Corrected player proof, real-vs-mock, readiness, timeout, permissions, and cache language |
| 17.3 obsolete paths | CI hygiene passed |
| 17.4 silent failures | CI hygiene and negative-path tests passed |
| 17.5 secrets | Current-tree and history scans passed |
| 17.6 clean tree | Temporary reconciliation files remove themselves; workflow checks empty status after commit |

Evidence: CI `{CI}` / JUnit `{JUNIT}` / Chromium `{CHROMIUM}` / real Coqui `{COQUI}` / runtime artifact `{CART}`. Human listening remains `NOT RUN`, so this block completion is not a FIX2 completion claim.
''')

# README and Docker semantics.
p='README.md'; s=load(p)
if '### Current FIX2 evidence status' not in s:
    s=once(s,'## Validation\n',f'## Validation\n\n### Current FIX2 evidence status\n\nCandidate `{SHA}` passed CI `{CI}` and real Coqui `{COQUI}`. JUnit reports 213 clean tests, Chromium proves maximum one player, and the runtime artifact proves real VCTK synthesis/cache/tempfile behavior. Human listening remains `NOT RUN`, so FIX2 is `PARTIAL`.\n','README validation')
s=s.replace('Real-model validation is not proven merely by the existence of the script. Record the exact implementation SHA, image ID, output directory, and result in the FIX2 implementation report.',f'Current real-model evidence is run `{COQUI}` on `{SHA}`, artifact `{CART}`, image `{IMAGE}`. Script existence alone is never evidence; later candidates require their own exact-SHA record.')
anchor='- `docs/CHROME_READIT_FIX2_LISTENING_EVIDENCE_TEMPLATE_2026-08-02.md`'
if 'CHROME_READIT_PLAYBACK_HARDENING_FIX2_BLOCK17_RECONCILIATION_2026-08-03.md' not in s: s=once(s,anchor,anchor+'\n- `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_BLOCK17_RECONCILIATION_2026-08-03.md`\n- `docs/CHROME_READIT_FIX2_EVIDENCE_INDEX_2026-08-02.md`','README index')
save(p,s)
p='docker/coqui-local/README.md'; s=load(p)
s=s.replace('Returns HTTP 200 only after the model and synthesis executor are ready.','Returns HTTP 200 only when the model/executor are ready and another bounded request can be accepted. It returns HTTP 503 while loading or saturated and reports queue state.')
s=s.replace('- Synthesis timeout returns HTTP 504.\n- Invalid voices return HTTP 400.\n- Temporary WAV files are removed after successful delivery, errors, timeouts, and shutdown.','- Synthesis timeout returns HTTP 504; the queue slot remains occupied until in-process inference actually finishes.\n- Invalid voices return HTTP 400 before queue/tempfile allocation.\n- WAV paths remain tracked until deletion succeeds; timed-out work is cleaned after completion and failed deletion is retried at shutdown.')
if '## Verified real-model evidence' not in s: s=once(s,'## Tests\n',f'## Verified real-model evidence\n\nRun `{COQUI}` passed on `{SHA}` with artifact `{CART}` and verified VCTK `p225`, valid WAV, saturation-aware readiness, loopback-only/non-root/single-worker operation, timeout accounting, tempfile cleanup, bounded shutdown, and cache reuse.\n\n## Tests\n','Docker evidence')
save(p,s)

# Fail closed if key boundaries were accidentally weakened.
assert '**Status:** Not yet executed' in load('docs/CHROME_READIT_FIX2_LISTENING_EVIDENCE_TEMPLATE_2026-08-02.md')
assert '**Block status:** `COMPLETE`' in load('docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_TODO_2026-08-02.md')
assert '213 tests' in load('docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_IMPLEMENTATION_REPORT_2026-08-02.md')
