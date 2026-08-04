from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TODO = ROOT / 'docs/CHROME_READIT_TEST_COVERAGE_HARDENING_TODO_2026-08-03.md'
REPORT = ROOT / 'docs/CHROME_READIT_TEST_COVERAGE_HARDENING_IMPLEMENTATION_REPORT_2026-08-03.md'
INDEX = ROOT / 'docs/CHROME_READIT_FIX2_EVIDENCE_INDEX_2026-08-02.md'
README = ROOT / 'README.md'
PATHS = [TODO, REPORT, INDEX, README]
texts = {path: path.read_text(encoding='utf-8') for path in PATHS}

common = {
    '50c823c8c01b8ec4d556f21b9849aca3a77e59f4': '740a86e2912615ba1b1868feb9709d82d78aafd6',
    '30877657282': '30879304676',
    '91892294226': '91897029491',
    '8880113346': '8880674994',
    'sha256:4fa6f1882180aa3fe0163db63d70ce0f62e8ac85face3bb1ed545e77e1b22941': 'sha256:13d8e9dfbb4b73b092d5b2ef50d38de94d27758232fe801517cb4527c8163933',
    '8880113636': '8880675234',
    'sha256:8d496ff17425ba89a6c5a0f02778295ef11e9f35657dfa8849651ff3fc7e6300': 'sha256:3618dc22ae92fac0ac89d0a855610198db71cf6d414ccb2912b211c387a43008',
    '8880128677': '8880691561',
    'sha256:8f90eee82e2219d73a9dd60c53742bf541e972015c339a315c46499aaf9170df': 'sha256:cbe8adc1e657fa106b96475ffdc3cbac3acafef8d9b7740fc86d987745297133',
    '8880131864': '8880694881',
    'sha256:13d4c5a2d307a08f8cd34773c5539cf26560e88fed51b8f1610dba30bcdab8c7': 'sha256:1b0f3fa351988b303f0710771dff15e7fef6af3a8480059f54af516c21d70336',
}
combined = '\n'.join(texts.values())
for old in common:
    if old not in combined:
        raise SystemExit(f'missing common evidence token: {old}')
for path, text in texts.items():
    for old, new in common.items():
        text = text.replace(old, new)
    texts[path] = text

# Current final metrics only. Historical failed-run counts remain unchanged.
metric_pairs = {
    'TypeScript test count: 293': 'TypeScript test count: 294',
    '| TypeScript | 293 | 95.59% | 87.88% | 96.14% |': '| TypeScript | 294 | 95.52% | 87.61% | 96.15% |',
    'TypeScript global coverage: 95.59% statements, 87.88% branches, 96.14% functions, 95.59% lines': 'TypeScript global coverage: 95.52% statements, 87.61% branches, 96.15% functions, 95.52% lines',
    '| Statements | 95.59% |': '| Statements | 95.52% |',
    '| Branches | 87.88% |': '| Branches | 87.61% |',
    '| Functions | 96.14% |': '| Functions | 96.15% |',
    '| Lines | 95.59% |': '| Lines | 95.52% |',
    'TypeScript coverage was 95.59% statements/lines, 87.88% branches, and 96.14% functions.': 'TypeScript coverage was 95.52% statements/lines, 87.61% branches, and 96.15% functions.',
    '| `src/offscreen.ts` | 98.52% | 96.15% |': '| `src/offscreen.ts` | 96.62% | 83.87% |',
    '| 6 — Offscreen adapter | COMPLETE | 98.52% lines / 96.15% branches |': '| 6 — Offscreen adapter | COMPLETE | 96.62% lines / 83.87% branches |',
}
for old, new in metric_pairs.items():
    found = False
    for path in PATHS:
        if old in texts[path]:
            texts[path] = texts[path].replace(old, new)
            found = True
    if not found:
        raise SystemExit(f'missing final metric token: {old}')

old_todo_block16 = '| 16 — Real Coqui | COMPLETE via final external status | Sequence 26 run `30877268439` passed before the coordinator repair; request sequence 27 and issue `#3` provide final same-SHA proof |'
new_todo_block16 = '| 16 — Real Coqui | COMPLETE via final external status | Sequence 27 run `30878123712` passed before the sender-routing repair; request sequence 28 and issue `#3` provide final same-SHA proof |'
if old_todo_block16 not in texts[TODO]:
    raise SystemExit('TODO Block 16 row mismatch')
texts[TODO] = texts[TODO].replace(old_todo_block16, new_todo_block16)

old_todo_request = 'Final repository-validation request: sequence 27; exact SHA/run/attempt are maintained by issues #2 and #3'
new_todo_request = 'Final repository-validation request: sequence 28; exact SHA/run/attempt are maintained by issues #2 and #3'
if texts[TODO].count(old_todo_request) != 1:
    raise SystemExit('TODO request record mismatch')
texts[TODO] = texts[TODO].replace(old_todo_request, new_todo_request)

old_todo_matrix = """**Final repository validation:** request sequence 27; issues `#2` and `#3` are authoritative for the exact final SHA and attempt-specific artifacts  
**Prior real-Coqui proof:** sequence 26 run `30877268439`, attempt 1, artifact `8880052635`, success before the coordinator-only repair"""
new_todo_matrix = """**Final repository validation:** request sequence 28; issues `#2` and `#3` are authoritative for the exact final SHA and attempt-specific artifacts  
**Prior real-Coqui proof:** sequence 27 run `30878123712`, attempt 1, artifact `8880334638`, success before the sender-routing repair"""
if old_todo_matrix not in texts[TODO]:
    raise SystemExit('TODO final matrix header mismatch')
texts[TODO] = texts[TODO].replace(old_todo_matrix, new_todo_matrix)
old_todo_real = '| Prior sequence-26 Real Coqui | `8880052635` | `sha256:65a7ac2f50ebb2835dcc70dee0c30420745cc5fe45453927cd6d5264f6800c18` |'
new_todo_real = '| Prior sequence-27 Real Coqui | `8880334638` | `sha256:164dbf11a39b91a682c0e5519b67db1bb0786dec3689cf9868844feeba0b5254` |'
if old_todo_real not in texts[TODO]:
    raise SystemExit('TODO prior runtime artifact mismatch')
texts[TODO] = texts[TODO].replace(old_todo_real, new_todo_real)

failure_tail = """6. CI `30877268445` exposed a real paused-audio settlement race: Pause returned `{ok: true, state: \"paused\"}`, but a late `ended` callback let the coordinator emit `completed` before the service-worker restart assertion observed `paused`. The run loop now executes a post-play `waitWhilePaused()` barrier before `chunk-ended` or `completed`; a deterministic regression test proves that a late ended callback cannot complete until Resume. Permanent CI `30877657282` passed all 293 tests and the full Chromium matrix on attempt 1.

None of these failures were hidden by a blind rerun."""
new_failure_tail = """6. CI `30877268445` exposed a real paused-audio settlement race: Pause returned `{ok: true, state: \"paused\"}`, but a late `ended` callback let the coordinator emit `completed` before the service-worker restart assertion observed `paused`. The run loop now executes a post-play `waitWhilePaused()` barrier before `chunk-ended` or `completed`; a deterministic regression test proves that a late ended callback cannot complete until Resume. Permanent CI `30877657282` passed all 293 tests and the full Chromium matrix on attempt 1.
7. CI `30878123726` proved the coordinator stayed paused but exposed competing runtime responders: a document-originated `PLAYBACK_STATUS` broadcast could be answered by the offscreen document with an idle state before the service worker returned authoritative session state. The offscreen listener now rejects document-originated start, control, and status messages using `MessageSender.documentId`, leaving the service worker as the single owner of those requests.
8. CI `30879229362` caught that the repository's installed Chrome type definitions do not expose the runtime `documentId` field. The sender guard now uses a structural `isRecord` check while preserving the runtime string check. Permanent CI `30879304676` then passed all 294 TypeScript tests, all three Chromium matrices, 57 Python tests, security validation, and both coverage uploads on attempt 1.

None of these failures were hidden by a blind rerun."""
if failure_tail not in texts[TODO]:
    raise SystemExit('TODO failure tail mismatch')
texts[TODO] = texts[TODO].replace(failure_tail, new_failure_tail)

# Implementation report current validation and prior runtime references.
old_report_table = """| Permanent CI | `30879304676` | 1 | `91897029491` | success |
| Prior real-Coqui proof | `30877268439` | 1 | `91891167170` | success before coordinator-only repair |
| Final repository validation | request sequence 27 | authoritative issues `#2` / `#3` | same-SHA result maintained externally |"""
new_report_table = """| Permanent CI | `30879304676` | 1 | `91897029491` | success |
| Prior real-Coqui proof | `30878123712` | 1 | `91893596715` | success before sender-routing repair |
| Final repository validation | request sequence 28 | authoritative issues `#2` / `#3` | same-SHA result maintained externally |"""
if old_report_table not in texts[REPORT]:
    raise SystemExit('report validation table mismatch')
texts[REPORT] = texts[REPORT].replace(old_report_table, new_report_table)
texts[REPORT] = texts[REPORT].replace('all 293 TypeScript tests and thresholds', 'all 294 TypeScript tests and thresholds')
old_report_real = '| Prior sequence-26 Real Coqui | `8880052635` | `sha256:65a7ac2f50ebb2835dcc70dee0c30420745cc5fe45453927cd6d5264f6800c18` |'
new_report_real = '| Prior sequence-27 Real Coqui | `8880334638` | `sha256:164dbf11a39b91a682c0e5519b67db1bb0786dec3689cf9868844feeba0b5254` |'
if old_report_real not in texts[REPORT]:
    raise SystemExit('report prior runtime artifact mismatch')
texts[REPORT] = texts[REPORT].replace(old_report_real, new_report_real)
old_report_failure = """- CI `30877268445` exposed a coordinator race in which a late audio `ended` callback could overwrite a successfully returned paused state with completion before the worker-restart poll observed it. The run loop now waits behind `waitWhilePaused()` after audio settlement, and a regression test proves completion remains blocked until Resume. Permanent CI `30877657282` passed all 293 tests and all Chromium matrices on attempt 1.

None of these failures were converted into success through a blind rerun."""
new_report_failure = """- CI `30877268445` exposed a coordinator race in which a late audio `ended` callback could overwrite a successfully returned paused state with completion before the worker-restart poll observed it. The run loop now waits behind `waitWhilePaused()` after audio settlement, and a regression test proves completion remains blocked until Resume. Permanent CI `30877657282` passed all 293 tests and all Chromium matrices on attempt 1.
- CI `30878123726` showed that document-originated status broadcasts could be claimed by both the service worker and offscreen document, returning a competing idle response after a successful Pause. The offscreen listener now rejects document-originated playback requests by inspecting the runtime sender's `documentId`, making the service worker the single request owner.
- CI `30879229362` caught type-definition lag for `MessageSender.documentId`. The implementation now uses a structural record check plus the same runtime string predicate. Permanent CI `30879304676` passed all 294 TypeScript tests and the complete hosted matrix on attempt 1.

None of these failures were converted into success through a blind rerun."""
if old_report_failure not in texts[REPORT]:
    raise SystemExit('report failure tail mismatch')
texts[REPORT] = texts[REPORT].replace(old_report_failure, new_report_failure)

# Evidence index.
old_index_runtime = """- Prior real-Coqui proof: run `30877268439`, attempt 1, artifact `8880052635`, before the coordinator-only repair
- Final repository validation: request sequence 27; issues `#2` and `#3` carry the exact same-SHA result"""
new_index_runtime = """- Prior real-Coqui proof: run `30878123712`, attempt 1, artifact `8880334638`, before the sender-routing repair
- Final repository validation: request sequence 28; issues `#2` and `#3` carry the exact same-SHA result"""
if old_index_runtime not in texts[INDEX]:
    raise SystemExit('index runtime block mismatch')
texts[INDEX] = texts[INDEX].replace(old_index_runtime, new_index_runtime)
old_index_real = '| Prior sequence-26 Real Coqui | `8880052635` | `sha256:65a7ac2f50ebb2835dcc70dee0c30420745cc5fe45453927cd6d5264f6800c18` |'
new_index_real = '| Prior sequence-27 Real Coqui | `8880334638` | `sha256:164dbf11a39b91a682c0e5519b67db1bb0786dec3689cf9868844feeba0b5254` |'
if old_index_real not in texts[INDEX]:
    raise SystemExit('index real artifact mismatch')
texts[INDEX] = texts[INDEX].replace(old_index_real, new_index_real)

# README compact status and runtime history.
old_readme_status = 'Automated coverage hardening passed permanent CI `30879304676`, attempt 1, on implementation SHA `740a86e2912615ba1b1868feb9709d82d78aafd6`, with 293 clean TypeScript tests, 57 clean Python tests, and all three Chromium matrices. Final same-SHA CI plus real-Coqui proof is maintained by issues `#2` and `#3` for request sequence 27. Human listening remains `NOT RUN`, so the broader FIX2 release is still `PARTIAL`.'
new_readme_status = 'Automated coverage hardening passed permanent CI `30879304676`, attempt 1, on implementation SHA `740a86e2912615ba1b1868feb9709d82d78aafd6`, with 294 clean TypeScript tests, 57 clean Python tests, and all three Chromium matrices. Final same-SHA CI plus real-Coqui proof is maintained by issues `#2` and `#3` for request sequence 28. Human listening remains `NOT RUN`, so the broader FIX2 release is still `PARTIAL`.'
if old_readme_status not in texts[README]:
    raise SystemExit('README current status mismatch')
texts[README] = texts[README].replace(old_readme_status, new_readme_status)
old_readme_real = 'Current real-model evidence is run `30875845769`, attempt 1, on exact SHA `740a86e2912615ba1b1868feb9709d82d78aafd6`, artifact `8879576839`, image `sha256:e01444f5125b441789da72f9e465f11604d22878c7337b95fa732c8c0e57ebaa`. Script existence alone is never evidence; later candidates require their own exact-SHA record.'
new_readme_real = 'Prior real-model evidence is run `30878123712`, attempt 1, on SHA `c8ded4193054a2bd19161debd4c485c49285f8a3`, artifact `8880334638`, image `sha256:e01444f5125b441789da72f9e465f11604d22878c7337b95fa732c8c0e57ebaa`. Final same-SHA runtime evidence for the sender-routing candidate is maintained by issue `#3` for request sequence 28. Script existence alone is never evidence.'
if old_readme_real not in texts[README]:
    raise SystemExit('README real-model paragraph mismatch')
texts[README] = texts[README].replace(old_readme_real, new_readme_real)

# Disposition wording must not falsely claim final same-SHA runtime before sequence 28.
old_disposition = 'The coverage-hardening implementation is complete. All deterministic local unit, static-analysis, build, coverage, and repetition gates passed, and permanent hosted CI plus real-Coqui validation passed on exact SHA `740a86e2912615ba1b1868feb9709d82d78aafd6`.'
new_disposition = 'The coverage-hardening implementation is complete. All deterministic local unit, static-analysis, build, coverage, and repetition gates passed, and permanent hosted CI passed on implementation SHA `740a86e2912615ba1b1868feb9709d82d78aafd6`. Final same-SHA CI plus real-Coqui validation is delegated to request sequence 28 and authoritative issues `#2` and `#3`.'
if old_disposition not in texts[REPORT]:
    raise SystemExit('report disposition mismatch')
texts[REPORT] = texts[REPORT].replace(old_disposition, new_disposition)

for path, text in texts.items():
    path.write_text(text, encoding='utf-8')

Path(__file__).unlink()
