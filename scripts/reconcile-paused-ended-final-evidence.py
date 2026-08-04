from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TODO = ROOT / "docs/CHROME_READIT_TEST_COVERAGE_HARDENING_TODO_2026-08-03.md"
REPORT = ROOT / "docs/CHROME_READIT_TEST_COVERAGE_HARDENING_IMPLEMENTATION_REPORT_2026-08-03.md"
INDEX = ROOT / "docs/CHROME_READIT_FIX2_EVIDENCE_INDEX_2026-08-02.md"
README = ROOT / "README.md"
PATHS = [TODO, REPORT, INDEX, README]

replacements = {
    "48add9a93e73c0e867763b08daa4e745a3c4bdbd": "50c823c8c01b8ec4d556f21b9849aca3a77e59f4",
    "30875845758": "30877657282",
    "91887032415": "91892294226",
    "8879508312": "8880113346",
    "sha256:6e9efa1329b7c2d72717f11e503606c477e59fb45ad7aec682a9128e05d974a6": "sha256:4fa6f1882180aa3fe0163db63d70ce0f62e8ac85face3bb1ed545e77e1b22941",
    "8879508449": "8880113636",
    "sha256:500f751a987c7ae594a1f6381415c0328b0cb6f0ad860eb2a1a3dae97b110a67": "sha256:8d496ff17425ba89a6c5a0f02778295ef11e9f35657dfa8849651ff3fc7e6300",
    "8879522956": "8880128677",
    "sha256:b74f01497c74f28cece77569cbe2d65add9ae415e1d6746be4620d3a42e49e90": "sha256:8f90eee82e2219d73a9dd60c53742bf541e972015c339a315c46499aaf9170df",
    "8879525536": "8880131864",
    "sha256:f0a9b1c4dde72359554d0ef7a546db9eda65d000ee23d8e2381496d8040447b6": "sha256:13d4c5a2d307a08f8cd34773c5539cf26560e88fed51b8f1610dba30bcdab8c7",
    "all 292 TypeScript tests": "all 293 TypeScript tests",
    "292 clean TypeScript tests": "293 clean TypeScript tests",
    "all 292 TypeScript tests and thresholds": "all 293 TypeScript tests and thresholds",
    "TypeScript test count: 292": "TypeScript test count: 293",
    "| TypeScript | 292 |": "| TypeScript | 293 |",
    "87.92%": "87.88%",
    "96.36%": "96.37%",
    "86.12%": "85.82%",
    "81.34%": "81.48%",
}

texts = {path: path.read_text(encoding="utf-8") for path in PATHS}
combined = "\n".join(texts.values())
for old in replacements:
    if old not in combined:
        raise SystemExit(f"Expected evidence token missing: {old}")
for path, text in texts.items():
    for old, new in replacements.items():
        text = text.replace(old, new)
    texts[path] = text

# The coordinator repair changed extension code after sequence 26 real-Coqui succeeded.
# Keep that runtime evidence as history, but delegate final same-SHA proof to sequence 27.
old_todo_block16 = "| 16 — Real Coqui | COMPLETE | Run `30875845769`, attempt 1, job `91887025434` on the same SHA |"
new_todo_block16 = "| 16 — Real Coqui | COMPLETE via final external status | Sequence 26 run `30877268439` passed before the coordinator repair; request sequence 27 and issue `#3` provide final same-SHA proof |"
if old_todo_block16 not in texts[TODO]:
    raise SystemExit("TODO Block 16 row did not match")
texts[TODO] = texts[TODO].replace(old_todo_block16, new_todo_block16)

old_todo_record = """Final exact SHA: 50c823c8c01b8ec4d556f21b9849aca3a77e59f4
Hosted CI run/attempt: 30877657282 / 1
Real-Coqui run/attempt: 30875845769 / 1
TypeScript test count: 293"""
new_todo_record = """Validated implementation SHA: 50c823c8c01b8ec4d556f21b9849aca3a77e59f4
Hosted CI run/attempt: 30877657282 / 1
Final repository-validation request: sequence 27; exact SHA/run/attempt are maintained by issues #2 and #3
TypeScript test count: 293"""
if old_todo_record not in texts[TODO]:
    raise SystemExit("TODO final record did not match")
texts[TODO] = texts[TODO].replace(old_todo_record, new_todo_record)

old_todo_matrix = """**Validated implementation SHA:** `50c823c8c01b8ec4d556f21b9849aca3a77e59f4`  
**Permanent CI:** run `30877657282`, attempt 1, job `91892294226`, success  
**Real-Coqui:** run `30875845769`, attempt 1, job `91887025434`, success"""
new_todo_matrix = """**Validated implementation SHA:** `50c823c8c01b8ec4d556f21b9849aca3a77e59f4`  
**Permanent CI:** run `30877657282`, attempt 1, job `91892294226`, success  
**Final repository validation:** request sequence 27; issues `#2` and `#3` are authoritative for the exact final SHA and attempt-specific artifacts  
**Prior real-Coqui proof:** sequence 26 run `30877268439`, attempt 1, artifact `8880052635`, success before the coordinator-only repair"""
if old_todo_matrix not in texts[TODO]:
    raise SystemExit("TODO evidence matrix header did not match")
texts[TODO] = texts[TODO].replace(old_todo_matrix, new_todo_matrix)

old_todo_real_artifact = "| Real Coqui | `8879576839` | `sha256:b12b6b89faa66372a372e54ef99c57394cf758a521107ab9e0b8d95993bbf4d3` |"
new_todo_real_artifact = "| Prior sequence-26 Real Coqui | `8880052635` | `sha256:65a7ac2f50ebb2835dcc70dee0c30420745cc5fe45453927cd6d5264f6800c18` |"
if old_todo_real_artifact not in texts[TODO]:
    raise SystemExit("TODO real-Coqui artifact row did not match")
texts[TODO] = texts[TODO].replace(old_todo_real_artifact, new_todo_real_artifact)

failure6 = "6. CI `30877268445` exposed a real paused-audio settlement race: Pause returned `{ok: true, state: \"paused\"}`, but a late `ended` callback let the coordinator emit `completed` before the service-worker restart assertion observed `paused`. The run loop now executes a post-play `waitWhilePaused()` barrier before `chunk-ended` or `completed`; a deterministic regression test proves that a late ended callback cannot complete until Resume. Permanent CI `30877657282` passed all 293 tests and the full Chromium matrix on attempt 1."
old_todo_failure_tail = """5. CI `30875551199` caught the remaining stale consolidated contract string for the old replacement sequence. That assertion was updated, and permanent CI `30875639074` passed the entire matrix before the final exact-SHA runtime request.

None of these failures were hidden by a blind rerun."""
new_todo_failure_tail = """5. CI `30875551199` caught the remaining stale consolidated contract string for the old replacement sequence. That assertion was updated, and permanent CI `30875639074` passed the entire matrix before the final exact-SHA runtime request.
%s

None of these failures were hidden by a blind rerun.""" % failure6
if old_todo_failure_tail not in texts[TODO]:
    raise SystemExit("TODO failure-history tail did not match")
texts[TODO] = texts[TODO].replace(old_todo_failure_tail, new_todo_failure_tail)

# Implementation report: exact implementation evidence plus final external same-SHA validation contract.
old_report_gate = """| Permanent CI | `30877657282` | 1 | `91892294226` | success |
| Real-Coqui | `30875845769` | 1 | `91887025434` | success |

The validated implementation SHA is `50c823c8c01b8ec4d556f21b9849aca3a77e59f4`. Permanent CI passed"""
new_report_gate = """| Permanent CI | `30877657282` | 1 | `91892294226` | success |
| Prior real-Coqui proof | `30877268439` | 1 | `91891167170` | success before coordinator-only repair |
| Final repository validation | request sequence 27 | authoritative issues `#2` / `#3` | same-SHA result maintained externally |

The validated implementation SHA is `50c823c8c01b8ec4d556f21b9849aca3a77e59f4`. Permanent CI passed"""
if old_report_gate not in texts[REPORT]:
    raise SystemExit("Report hosted-validation table did not match")
texts[REPORT] = texts[REPORT].replace(old_report_gate, new_report_gate)

old_report_artifact = "| Real Coqui | `8879576839` | `sha256:b12b6b89faa66372a372e54ef99c57394cf758a521107ab9e0b8d95993bbf4d3` |"
new_report_artifact = "| Prior sequence-26 Real Coqui | `8880052635` | `sha256:65a7ac2f50ebb2835dcc70dee0c30420745cc5fe45453927cd6d5264f6800c18` |"
if old_report_artifact not in texts[REPORT]:
    raise SystemExit("Report real-Coqui artifact row did not match")
texts[REPORT] = texts[REPORT].replace(old_report_artifact, new_report_artifact)

report_failure = "- CI `30877268445` exposed a coordinator race in which a late audio `ended` callback could overwrite a successfully returned paused state with completion before the worker-restart poll observed it. The run loop now waits behind `waitWhilePaused()` after audio settlement, and a regression test proves completion remains blocked until Resume. Permanent CI `30877657282` passed all 293 tests and all Chromium matrices on attempt 1."
old_report_failure_tail = """- CI `30875551199` caught a stale consolidated source-state assertion that still required the old selection-selection replacement label. The assertion now matches the decoupled selection-popup replacement contract; permanent CI `30875639074` then passed the complete 292-test, Chromium, Python, build, security, and upload matrix.

None of these failures were converted into success through a blind rerun."""
new_report_failure_tail = """- CI `30875551199` caught a stale consolidated source-state assertion that still required the old selection-selection replacement label. The assertion now matches the decoupled selection-popup replacement contract; permanent CI `30875639074` then passed the complete 292-test, Chromium, Python, build, security, and upload matrix.
%s

None of these failures were converted into success through a blind rerun.""" % report_failure
if old_report_failure_tail not in texts[REPORT]:
    raise SystemExit("Report failure-history tail did not match")
texts[REPORT] = texts[REPORT].replace(old_report_failure_tail, new_report_failure_tail)

# Evidence index and README must not imply that the pre-repair real-Coqui run shares the repaired SHA.
old_index_runtime = """- Real-Coqui: run `30875845769`, attempt 1, job `91887025434`
"""
new_index_runtime = """- Prior real-Coqui proof: run `30877268439`, attempt 1, artifact `8880052635`, before the coordinator-only repair
- Final repository validation: request sequence 27; issues `#2` and `#3` carry the exact same-SHA result
"""
if old_index_runtime not in texts[INDEX]:
    raise SystemExit("Evidence-index runtime line did not match")
texts[INDEX] = texts[INDEX].replace(old_index_runtime, new_index_runtime)
old_index_artifact = "| Real Coqui | `8879576839` | `sha256:b12b6b89faa66372a372e54ef99c57394cf758a521107ab9e0b8d95993bbf4d3` |"
new_index_artifact = "| Prior sequence-26 Real Coqui | `8880052635` | `sha256:65a7ac2f50ebb2835dcc70dee0c30420745cc5fe45453927cd6d5264f6800c18` |"
if old_index_artifact not in texts[INDEX]:
    raise SystemExit("Evidence-index runtime artifact did not match")
texts[INDEX] = texts[INDEX].replace(old_index_artifact, new_index_artifact)

# README contains a compact current-evidence sentence; keep it exact without embedding a stale final runtime ID.
old_readme = "Automated coverage hardening passed CI `30877657282` and real-Coqui `30875845769`, both attempt 1 on exact SHA `50c823c8c01b8ec4d556f21b9849aca3a77e59f4`. The retained evidence contains 293 clean TypeScript tests, 57 clean Python tests, all three Chromium matrices, and real VCTK synthesis/cache/tempfile validation. Human listening remains `NOT RUN`, so the broader FIX2 release is still `PARTIAL`."
new_readme = "Automated coverage hardening passed permanent CI `30877657282`, attempt 1, on implementation SHA `50c823c8c01b8ec4d556f21b9849aca3a77e59f4`, with 293 clean TypeScript tests, 57 clean Python tests, and all three Chromium matrices. Final same-SHA CI plus real-Coqui proof is maintained by issues `#2` and `#3` for request sequence 27. Human listening remains `NOT RUN`, so the broader FIX2 release is still `PARTIAL`."
if old_readme not in texts[README]:
    raise SystemExit("README automated-evidence sentence did not match")
texts[README] = texts[README].replace(old_readme, new_readme)

# Reject stale final implementation evidence, while preserving intentionally historical run IDs in failure narratives.
for path, text in texts.items():
    if "TypeScript test count: 292" in text or "| TypeScript | 292 |" in text:
        raise SystemExit(f"Stale final TypeScript count remains in {path}")
    path.write_text(text, encoding="utf-8")

Path(__file__).unlink()
