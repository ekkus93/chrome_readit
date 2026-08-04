from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATHS = [
    ROOT / "docs/CHROME_READIT_TEST_COVERAGE_HARDENING_TODO_2026-08-03.md",
    ROOT / "docs/CHROME_READIT_TEST_COVERAGE_HARDENING_IMPLEMENTATION_REPORT_2026-08-03.md",
    ROOT / "docs/CHROME_READIT_FIX2_EVIDENCE_INDEX_2026-08-02.md",
    ROOT / "README.md",
]

replacements = {
    "2cf59436edef86f05b691a9c21f05836d741d407": "48add9a93e73c0e867763b08daa4e745a3c4bdbd",
    "30864233383": "30875845758",
    "30864233396": "30875845769",
    "91852510574": "91887032415",
    "91852500584": "91887025434",
    "8875497124": "8879508312",
    "sha256:4c1d6390889c3c881639b5eb3d86ca932926e7d5c43af12057331ed397d13727": "sha256:6e9efa1329b7c2d72717f11e503606c477e59fb45ad7aec682a9128e05d974a6",
    "8875497471": "8879508449",
    "sha256:e4b4678348c993aa3847ec117ead78a2fa095b175c1414aa66ce621afc860b62": "sha256:500f751a987c7ae594a1f6381415c0328b0cb6f0ad860eb2a1a3dae97b110a67",
    "8875515089": "8879522956",
    "sha256:007235ca2128a2de43bbedd1040d263cd59cdd0b13d83a09fcb78ac6b81aa750": "sha256:b74f01497c74f28cece77569cbe2d65add9ae415e1d6746be4620d3a42e49e90",
    "8875517836": "8879525536",
    "sha256:a6541ab76b72cdd0c0d20917797a3c661b2b497341be2158e0a85c49ccec566d": "sha256:f0a9b1c4dde72359554d0ef7a546db9eda65d000ee23d8e2381496d8040447b6",
    "8875590994": "8879576839",
    "sha256:bb84cdacc31e3c7b2fec15b3695b5f2669ed2e15a1bdfd1a5cb184da67981800": "sha256:b12b6b89faa66372a372e54ef99c57394cf758a521107ab9e0b8d95993bbf4d3",
    "87.93%": "87.92%",
    "96.37%": "96.36%",
    "80.59%": "80.58%",
    "98.53%": "98.52%",
    "99.17%": "99.16%",
    "98.99%": "98.98%",
    "93.94%": "93.93%",
    "91.11%": "91.10%",
    "76.67%": "76.66%",
    "Popup 91.11/76.67": "Popup 91.10/76.66",
    "Neither failure was hidden by a blind rerun.": "None of these failures were hidden by a blind rerun.",
    "Neither failure was converted into success through a blind rerun.": "None of these failures were converted into success through a blind rerun.",
}

texts = {path: path.read_text(encoding="utf-8") for path in PATHS}
combined = "\n".join(texts.values())
for old in replacements:
    if old not in combined:
        raise SystemExit(f"Expected evidence token is missing: {old}")

for path, text in texts.items():
    for old, new in replacements.items():
        text = text.replace(old, new)
    texts[path] = text

report = PATHS[1]
old_disposition = (
    "The coverage-hardening implementation is complete in the candidate tree and all deterministic local unit, static-analysis, build, coverage, and repetition gates pass. The permanent hosted Chrome job remains the authoritative browser gate because the local Debian Chromium binary could start headless DevTools but could not create `DevToolsActivePort` in the non-headless extension configuration required by the E2E harness.\n\n"
    "This is not a browser pass. The candidate remains `PARTIAL` until permanent hosted CI and real-Coqui validation pass on one exact SHA.\n\n"
    "This work does not complete FIX2 human listening Block 16. Human listening remains a separate release gate."
)
new_disposition = (
    "The coverage-hardening implementation is complete. All deterministic local unit, static-analysis, build, coverage, and repetition gates passed, and permanent hosted CI plus real-Coqui validation passed on exact SHA `48add9a93e73c0e867763b08daa4e745a3c4bdbd`. The permanent hosted Chrome job remains the authoritative browser gate because the local Debian Chromium binary could start headless DevTools but could not create `DevToolsActivePort` in the non-headless extension configuration required by the E2E harness.\n\n"
    "The automated coverage-hardening workstream is `COMPLETE`. This does not complete FIX2 human listening Block 16; human listening remains a separate release gate and is still **Not yet executed**."
)
if old_disposition not in texts[report]:
    raise SystemExit("Implementation-report disposition block did not match")
texts[report] = texts[report].replace(old_disposition, new_disposition)

readme = PATHS[3]
old_readme_status = (
    "Candidate `31702133a5afd326902aa8f5bdfb6e2afe5dfe28` passed CI `30854518356` and real Coqui `30854518366`. JUnit reports 213 clean tests, Chromium proves maximum one player, and the runtime artifact proves real VCTK synthesis/cache/tempfile behavior. Human listening remains `NOT RUN`, so FIX2 is `PARTIAL`."
)
new_readme_status = (
    "Automated coverage hardening passed CI `30875845758` and real-Coqui `30875845769`, both attempt 1 on exact SHA `48add9a93e73c0e867763b08daa4e745a3c4bdbd`. The retained evidence contains 292 clean TypeScript tests, 57 clean Python tests, all three Chromium matrices, and real VCTK synthesis/cache/tempfile validation. Human listening remains `NOT RUN`, so the broader FIX2 release is still `PARTIAL`."
)
if old_readme_status not in texts[readme]:
    raise SystemExit("README current-evidence paragraph did not match")
texts[readme] = texts[readme].replace(old_readme_status, new_readme_status)

old_real_model = (
    "Current real-model evidence is run `30854518366` on `31702133a5afd326902aa8f5bdfb6e2afe5dfe28`, artifact `8872045367`, image `sha256:c09634d6df082265846c9cd8ba7a326ea3303915981e0f91854e818e07bc38f5`. Script existence alone is never evidence; later candidates require their own exact-SHA record."
)
new_real_model = (
    "Current real-model evidence is run `30875845769`, attempt 1, on exact SHA `48add9a93e73c0e867763b08daa4e745a3c4bdbd`, artifact `8879576839`, image `sha256:e01444f5125b441789da72f9e465f11604d22878c7337b95fa732c8c0e57ebaa`. Script existence alone is never evidence; later candidates require their own exact-SHA record."
)
if old_real_model not in texts[readme]:
    raise SystemExit("README real-model paragraph did not match")
texts[readme] = texts[readme].replace(old_real_model, new_real_model)

for path, text in texts.items():
    path.write_text(text, encoding="utf-8")

Path(__file__).unlink()
