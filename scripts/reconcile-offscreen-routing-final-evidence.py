from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
TODO = ROOT / 'docs/CHROME_READIT_TEST_COVERAGE_HARDENING_TODO_2026-08-03.md'
REPORT = ROOT / 'docs/CHROME_READIT_TEST_COVERAGE_HARDENING_IMPLEMENTATION_REPORT_2026-08-03.md'
INDEX = ROOT / 'docs/CHROME_READIT_FIX2_EVIDENCE_INDEX_2026-08-02.md'
README = ROOT / 'README.md'
TRIGGER = ROOT / 'scripts/final-evidence-reconciliation-trigger.txt'


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.MULTILINE | re.DOTALL)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    return updated


todo = TODO.read_text(encoding='utf-8')
report = REPORT.read_text(encoding='utf-8')
index = INDEX.read_text(encoding='utf-8')
readme = README.read_text(encoding='utf-8')

# Governing TODO: current implementation evidence only; historical failures remain intact.
todo = replace_once(todo,
    '**Validated implementation SHA:** `50c823c8c01b8ec4d556f21b9849aca3a77e59f4`',
    '**Validated implementation SHA:** `740a86e2912615ba1b1868feb9709d82d78aafd6`',
    'TODO top SHA')
todo = replace_once(todo,
    '| 6 — Offscreen adapter | COMPLETE | 98.52% lines / 96.15% branches |',
    '| 6 — Offscreen adapter | COMPLETE | 96.62% lines / 83.87% branches |',
    'TODO Block 6')
todo = replace_once(todo,
    '| 15 — Hosted CI | COMPLETE | Run `30877657282`, attempt 1, job `91892294226` |',
    '| 15 — Hosted CI | COMPLETE | Run `30879304676`, attempt 1, job `91897029491` |',
    'TODO Block 15')
todo = replace_once(todo,
    '| 16 — Real Coqui | COMPLETE via final external status | Sequence 26 run `30877268439` passed before the coordinator repair; request sequence 27 and issue `#3` provide final same-SHA proof |',
    '| 16 — Real Coqui | COMPLETE via final external status | Sequence 27 run `30878123712` passed before the sender-routing repair; request sequence 28 and issue `#3` provide final same-SHA proof |',
    'TODO Block 16')
todo = replace_once(todo,
    'Validated implementation SHA: 50c823c8c01b8ec4d556f21b9849aca3a77e59f4\nHosted CI run/attempt: 30877657282 / 1\nFinal repository-validation request: sequence 27; exact SHA/run/attempt are maintained by issues #2 and #3\nTypeScript test count: 293\nPython test count: 57\nTypeScript global coverage: 95.59% statements, 87.88% branches, 96.14% functions, 95.59% lines',
    'Validated implementation SHA: 740a86e2912615ba1b1868feb9709d82d78aafd6\nHosted CI run/attempt: 30879304676 / 1\nFinal repository-validation request: sequence 28; exact SHA/run/attempt are maintained by issues #2 and #3\nTypeScript test count: 294\nPython test count: 57\nTypeScript global coverage: 95.52% statements, 87.61% branches, 96.15% functions, 95.52% lines',
    'TODO final record')
todo = replace_once(todo,
    '**Validated implementation SHA:** `50c823c8c01b8ec4d556f21b9849aca3a77e59f4`  \n**Permanent CI:** run `30877657282`, attempt 1, job `91892294226`, success  \n**Final repository validation:** request sequence 27; issues `#2` and `#3` are authoritative for the exact final SHA and attempt-specific artifacts  \n**Prior real-Coqui proof:** sequence 26 run `30877268439`, attempt 1, artifact `8880052635`, success before the coordinator-only repair',
    '**Validated implementation SHA:** `740a86e2912615ba1b1868feb9709d82d78aafd6`  \n**Permanent CI:** run `30879304676`, attempt 1, job `91897029491`, success  \n**Final repository validation:** request sequence 28; issues `#2` and `#3` are authoritative for the exact final SHA and attempt-specific artifacts  \n**Prior real-Coqui proof:** sequence 27 run `30878123712`, attempt 1, artifact `8880334638`, success before the sender-routing repair',
    'TODO evidence header')
todo = replace_once(todo,
    '| TypeScript | 293 | 95.59% | 87.88% | 96.14% |',
    '| TypeScript | 294 | 95.52% | 87.61% | 96.15% |',
    'TODO totals')
todo = replace_once(todo,
    '| `src/offscreen.ts` | 98.52% | 96.15% |',
    '| `src/offscreen.ts` | 96.62% | 83.87% |',
    'TODO offscreen coverage')
artifact_pairs = [
    ('8880113346', '8880674994'),
    ('sha256:4fa6f1882180aa3fe0163db63d70ce0f62e8ac85face3bb1ed545e77e1b22941', 'sha256:13d8e9dfbb4b73b092d5b2ef50d38de94d27758232fe801517cb4527c8163933'),
    ('8880113636', '8880675234'),
    ('sha256:8d496ff17425ba89a6c5a0f02778295ef11e9f35657dfa8849651ff3fc7e6300', 'sha256:3618dc22ae92fac0ac89d0a855610198db71cf6d414ccb2912b211c387a43008'),
    ('8880128677', '8880691561'),
    ('sha256:8f90eee82e2219d73a9dd60c53742bf541e972015c339a315c46499aaf9170df', 'sha256:cbe8adc1e657fa106b96475ffdc3cbac3acafef8d9b7740fc86d987745297133'),
    ('8880131864', '8880694881'),
    ('sha256:13d4c5a2d307a08f8cd34773c5539cf26560e88fed51b8f1610dba30bcdab8c7', 'sha256:1b0f3fa351988b303f0710771dff15e7fef6af3a8480059f54af516c21d70336'),
]
for old, new in artifact_pairs:
    todo = replace_once(todo, old, new, f'TODO artifact {old}')
todo = replace_once(todo,
    '| Prior sequence-26 Real Coqui | `8880052635` | `sha256:65a7ac2f50ebb2835dcc70dee0c30420745cc5fe45453927cd6d5264f6800c18` |',
    '| Prior sequence-27 Real Coqui | `8880334638` | `sha256:164dbf11a39b91a682c0e5519b67db1bb0786dec3689cf9868844feeba0b5254` |',
    'TODO prior Coqui')
if '7. CI `30878123726`' not in todo:
    todo = replace_once(todo,
        '\nNone of these failures were hidden by a blind rerun. Each received a bounded fix and complete revalidation.',
        '\n7. CI `30878123726` proved the coordinator stayed paused but exposed competing runtime responders: a document-originated `PLAYBACK_STATUS` broadcast could be answered by the offscreen document with an idle state before the service worker returned authoritative session state. The offscreen listener now rejects document-originated start, control, and status messages using the runtime sender `documentId`, leaving the service worker as the single request owner.\n8. CI `30879229362` caught that the installed Chrome type definitions do not expose `MessageSender.documentId`. The guard now uses a structural record check while preserving the runtime string predicate. Permanent CI `30879304676` then passed all 294 TypeScript tests, all Chromium matrices, 57 Python tests, security validation, and both coverage uploads on attempt 1.\n\nNone of these failures were hidden by a blind rerun. Each received a bounded fix and complete revalidation.',
        'TODO failures')

# Implementation report.
report = replace_once(report,
    '**Validated implementation SHA:** `50c823c8c01b8ec4d556f21b9849aca3a77e59f4`',
    '**Validated implementation SHA:** `740a86e2912615ba1b1868feb9709d82d78aafd6`',
    'report SHA')
report = regex_once(report,
    r'The coverage-hardening implementation is complete\. All deterministic local unit, static-analysis, build, coverage, and repetition gates passed, and permanent hosted CI plus real-Coqui validation passed on exact SHA `50c823c8c01b8ec4d556f21b9849aca3a77e59f4`\.',
    'The coverage-hardening implementation is complete. All deterministic local unit, static-analysis, build, coverage, and repetition gates passed, and permanent hosted CI passed on implementation SHA `740a86e2912615ba1b1868feb9709d82d78aafd6`. Final same-SHA CI plus real-Coqui validation is delegated to request sequence 28 and authoritative issues `#2` and `#3`.',
    'report disposition')
for old, new, label in [
    ('| Statements | 95.59% |', '| Statements | 95.52% |', 'report statements'),
    ('| Branches | 87.88% |', '| Branches | 87.61% |', 'report branches'),
    ('| Functions | 96.14% |', '| Functions | 96.15% |', 'report functions'),
    ('| Lines | 95.59% |', '| Lines | 95.52% |', 'report lines'),
    ('| `src/offscreen.ts` | 98.52% | 96.15% |', '| `src/offscreen.ts` | 96.62% | 83.87% |', 'report offscreen'),
]:
    report = replace_once(report, old, new, label)
report = replace_once(report,
    '| Permanent CI | `30877657282` | 1 | `91892294226` | success |\n| Prior real-Coqui proof | `30877268439` | 1 | `91891167170` | success before coordinator-only repair |\n| Final repository validation | request sequence 27 | authoritative issues `#2` / `#3` | same-SHA result maintained externally |',
    '| Permanent CI | `30879304676` | 1 | `91897029491` | success |\n| Prior real-Coqui proof | `30878123712` | 1 | `91893596715` | success before sender-routing repair |\n| Final repository validation | request sequence 28 | authoritative issues `#2` / `#3` | same-SHA result maintained externally |',
    'report validation table')
report = replace_once(report,
    'The validated implementation SHA is `50c823c8c01b8ec4d556f21b9849aca3a77e59f4`. Permanent CI passed lint, typecheck, coverage-surface integrity, FIX2 hygiene, full-history secret scanning, release-script syntax, all 293 TypeScript tests and thresholds,',
    'The validated implementation SHA is `740a86e2912615ba1b1868feb9709d82d78aafd6`. Permanent CI passed lint, typecheck, coverage-surface integrity, FIX2 hygiene, full-history secret scanning, release-script syntax, all 294 TypeScript tests and thresholds,',
    'report validation paragraph')
report = replace_once(report,
    'TypeScript coverage was 95.59% statements/lines, 87.88% branches, and 96.14% functions.',
    'TypeScript coverage was 95.52% statements/lines, 87.61% branches, and 96.15% functions.',
    'report coverage sentence')
for old, new in artifact_pairs:
    report = replace_once(report, old, new, f'report artifact {old}')
report = replace_once(report,
    '| Prior sequence-26 Real Coqui | `8880052635` | `sha256:65a7ac2f50ebb2835dcc70dee0c30420745cc5fe45453927cd6d5264f6800c18` |',
    '| Prior sequence-27 Real Coqui | `8880334638` | `sha256:164dbf11a39b91a682c0e5519b67db1bb0786dec3689cf9868844feeba0b5254` |',
    'report prior Coqui')
if '- CI `30878123726`' not in report:
    report = replace_once(report,
        '\nNone of these failures were converted into success through a blind rerun. Each received a root-cause fix and complete revalidation.',
        '\n- CI `30878123726` showed that document-originated status broadcasts could be claimed by both the service worker and offscreen document, returning a competing idle response after a successful Pause. The offscreen listener now rejects document-originated playback requests by inspecting the runtime sender `documentId`, making the service worker the single request owner.\n- CI `30879229362` caught type-definition lag for `MessageSender.documentId`. The implementation now uses a structural record check plus the same runtime string predicate. Permanent CI `30879304676` passed all 294 TypeScript tests and the complete hosted matrix on attempt 1.\n\nNone of these failures were converted into success through a blind rerun. Each received a root-cause fix and complete revalidation.',
        'report failures')

# Evidence index.
index = replace_once(index,
    '- Validated implementation SHA: `50c823c8c01b8ec4d556f21b9849aca3a77e59f4`\n- Permanent CI: run `30877657282`, attempt 1, job `91892294226`\n- Prior real-Coqui proof: run `30877268439`, attempt 1, artifact `8880052635`, before the coordinator-only repair\n- Final repository validation: request sequence 27; issues `#2` and `#3` carry the exact same-SHA result',
    '- Validated implementation SHA: `740a86e2912615ba1b1868feb9709d82d78aafd6`\n- Permanent CI: run `30879304676`, attempt 1, job `91897029491`\n- Prior real-Coqui proof: run `30878123712`, attempt 1, artifact `8880334638`, before the sender-routing repair\n- Final repository validation: request sequence 28; issues `#2` and `#3` carry the exact same-SHA result',
    'index summary')
for old, new in artifact_pairs:
    index = replace_once(index, old, new, f'index artifact {old}')
index = replace_once(index,
    '| Prior sequence-26 Real Coqui | `8880052635` | `sha256:65a7ac2f50ebb2835dcc70dee0c30420745cc5fe45453927cd6d5264f6800c18` |',
    '| Prior sequence-27 Real Coqui | `8880334638` | `sha256:164dbf11a39b91a682c0e5519b67db1bb0786dec3689cf9868844feeba0b5254` |',
    'index prior Coqui')

# README.
readme = replace_once(readme,
    'Automated coverage hardening passed permanent CI `30877657282`, attempt 1, on implementation SHA `50c823c8c01b8ec4d556f21b9849aca3a77e59f4`, with 293 clean TypeScript tests, 57 clean Python tests, and all three Chromium matrices. Final same-SHA CI plus real-Coqui proof is maintained by issues `#2` and `#3` for request sequence 27. Human listening remains `NOT RUN`, so the broader FIX2 release is still `PARTIAL`.',
    'Automated coverage hardening passed permanent CI `30879304676`, attempt 1, on implementation SHA `740a86e2912615ba1b1868feb9709d82d78aafd6`, with 294 clean TypeScript tests, 57 clean Python tests, and all three Chromium matrices. Final same-SHA CI plus real-Coqui proof is maintained by issues `#2` and `#3` for request sequence 28. Human listening remains `NOT RUN`, so the broader FIX2 release is still `PARTIAL`.',
    'README status')
readme = replace_once(readme,
    'Current real-model evidence is run `30875845769`, attempt 1, on exact SHA `50c823c8c01b8ec4d556f21b9849aca3a77e59f4`, artifact `8879576839`, image `sha256:e01444f5125b441789da72f9e465f11604d22878c7337b95fa732c8c0e57ebaa`. Script existence alone is never evidence; later candidates require their own exact-SHA record.',
    'Prior real-model evidence is run `30878123712`, attempt 1, on SHA `c8ded4193054a2bd19161debd4c485c49285f8a3`, artifact `8880334638`, image `sha256:e01444f5125b441789da72f9e465f11604d22878c7337b95fa732c8c0e57ebaa`. Final same-SHA runtime evidence for the sender-routing candidate is maintained by issue `#3` for request sequence 28. Script existence alone is never evidence.',
    'README real model')

for path, text in ((TODO, todo), (REPORT, report), (INDEX, index), (README, readme)):
    path.write_text(text, encoding='utf-8')

for required in (
    '740a86e2912615ba1b1868feb9709d82d78aafd6',
    '30879304676',
    'TypeScript test count: 294',
    'request sequence 28',
):
    if required not in todo + report + index + readme:
        raise SystemExit(f'missing final postcondition: {required}')

if TRIGGER.exists():
    TRIGGER.unlink()
Path(__file__).unlink()
