# Read It — Chrome text-to-speech extension

[![CI](https://github.com/ekkus93/chrome_readit/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/ekkus93/chrome_readit/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/ekkus93/chrome_readit/branch/master/graph/badge.svg)](https://codecov.io/gh/ekkus93/chrome_readit)

Read It is a Manifest V3 Chrome extension that reads selected text through a local or user-configured synthesis endpoint. It provides keyboard-accessible controls, configurable voices and rates, sentence-aware chunking, and explicit paragraph pacing.

## Automated coverage-hardening status

The automated coverage-hardening workstream passed permanent CI and real-Coqui validation on implementation SHA `50c823c8c01b8ec4d556f21b9849aca3a77e59f4`. The suite contains **292 TypeScript tests** and **57 Python tests**. TypeScript coverage is **95.59% statements/lines**, **87.88% branches**, and **96.14% functions** across 17 measured production files. Python coverage is **97.44% statements** and **89.19% branches**.

Only `src/manifest.ts` and `src/options/main.tsx` are excluded because they are declarative/trivial bootstrap entrypoints whose behavior is covered by manifest, build, and Chromium validation. Global TypeScript floors are 85% statements/lines/functions and 75% branches, with higher critical-file floors. Python floors are 85% statements and 75% branches.

Automated coverage does not establish audible quality. The separate FIX2 human listening gate remains **Not yet executed**, so the broader FIX2 disposition remains `PARTIAL`.


## Architecture

Read It has one production playback owner:

```text
Popup / Options / keyboard / context menu
                    │
                    ▼
        Manifest V3 service worker
       selection capture + typed routing
                    │
                    ▼
        Extension offscreen document
     normalization → segmentation → packing
       bounded synthesis → one Audio element
                    │
                    ▼
       Local Coqui FastAPI service
```

### Extension responsibilities

- `src/background/service-worker.ts`
  - captures the active-page selection;
  - loads and repairs validated settings;
  - ensures a supported offscreen document exists;
  - routes typed start, status, pause, resume, and cancel requests;
  - serializes restart-safe status persistence;
  - does **not** own the playback queue or fetch audio.
- `src/offscreen/playback-coordinator.ts`
  - owns the active session and queue;
  - synthesizes the current chunk and at most one prefetched chunk;
  - uses one persistent `HTMLAudioElement`;
  - fails closed when the old source cannot be proven stopped and neutralized;
  - continues queue progression independently of service-worker memory;
  - emits typed status, supersession, failure, and diagnostic events;
  - maintains direct test-build counters for active players, starts, settlements, and invariant violations.
- `src/lib/text-normalization.ts`
  - normalizes line endings, whitespace, and paragraph boundaries;
  - enforces the selected-text length limit.
- `src/lib/text-segmentation.ts`
  - handles decimals, versions, domains, URLs, email addresses, abbreviations, quotes, ellipses, sentence punctuation, and tested uppercase/non-ASCII continuation cases;
  - does not treat semicolons as sentence endings.
- `src/lib/chunk-packing.ts`
  - packs adjacent complete sentences instead of making one request per sentence;
  - never crosses paragraph boundaries;
  - uses 280/400/500-character target, soft, and hard limits.
- `src/lib/playback-pacing.ts`
  - preserves bounded continuation, sentence, and paragraph pauses at high rates.
- `src/lib/playback-protocol.ts`
  - defines and validates cross-context messages, monotonic status sequences, structured failures, and cleanup stages.
- `src/lib/tts-client.ts`
  - reads audio as a bounded stream;
  - enforces declared and actual response limits;
  - distinguishes timeout, cancellation, HTTP, MIME, empty-body, and playback failures.

Popup test speech, Options test speech, selection reading, keyboard commands, and context-menu reading all use the same offscreen coordinator. There is no UI-local, content-script, WebAudio, browser-speech, or host-audio fallback.

## Requirements

- Chrome 116 or newer
- Node.js 22.12 or newer
- npm
- Docker with the Compose plugin for the bundled Coqui service

The tested Node version is recorded in `.nvmrc`. The extension manifest declares Chrome 116 as its minimum version because the playback router depends on the supported offscreen/context APIs instead of process-local existence guesses.

## Start the local TTS service

From the repository root:

```bash
docker compose -f docker/docker-compose.yml up --build
```

The default Compose configuration:

- publishes the API only on `127.0.0.1:5002`;
- uses `tts_models/en/vctk/vits` unless overridden;
- persists the Coqui model cache in the `coqui_models` volume;
- runs one inference worker behind a bounded active-plus-queued capacity;
- rejects empty, oversized, overloaded, invalid-voice, and timed-out requests;
- keeps timed-out inference visible until the underlying in-process work actually ends;
- retains failed tempfile cleanup for retry and diagnostics;
- runs as a non-root container user;
- exposes no host-audio playback or debug endpoint.

The first startup may take several minutes while the configured model is downloaded into the persistent volume.

### Service endpoints

- `GET /api/ping` — process liveness
- `GET /api/ready` — model readiness and current ability to accept another bounded request
- `GET /api/voices` — voices exposed by the active model
- `POST /api/tts` — synthesize one bounded text chunk and return `audio/wav`

`/api/ready` returns `503` while the model is unavailable or the configured queue is full. Normal extension playback uses only `POST /api/tts`. Legacy stored URLs ending in `/api/tts/play` are migrated to `/api/tts`; the host-play endpoint does not exist.

### Service configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `COQUI_PORT` | `5002` | Host loopback port |
| `COQUI_MODEL` | `tts_models/en/vctk/vits` | Coqui model identifier |
| `COQUI_VOICES` | empty | Optional comma-separated voice override |
| `MAX_TEXT_CHARS` | `500` | Maximum characters per synthesis request |
| `SYNTH_QUEUE_CAPACITY` | `4` | Active plus queued synthesis jobs |
| `SYNTH_TIMEOUT_SECONDS` | `120` | HTTP wait limit for one request |

Invalid numeric or empty model configuration fails startup instead of silently clamping to another value.

To expose the service beyond the local machine, edit the Compose port binding explicitly and add appropriate authentication, TLS, firewall, and threat controls. Remote exposure is not the default security posture.

## Build and load the extension

```bash
npm ci
npm run build
```

Then:

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this repository's `dist/` directory.

## Use the extension

- Select text and press `Alt+Shift+R`.
- Right-click selected text and choose **Read selection aloud**.
- Use the popup or Options page to choose a voice and playback rate.
- Pause with `Alt+Shift+P`.
- Resume with `Alt+Shift+U`.
- Cancel with `Alt+Shift+C`.

A new read or test request supersedes the active session only after old audio cleanup succeeds. If pause, source clearing, object-URL revocation, or player accounting is uncertain, the replacement is rejected with a structured error rather than risking overlapping speech.

Popup and Options controls include the displayed session ID. A stale UI therefore cannot accidentally control a newer replacement session. Global keyboard commands intentionally target the current global session.

## Settings behavior

Stored settings are treated as untrusted data:

- malformed voices, rates, and URLs are repaired to safe values;
- rates are finite and clamped to the supported range;
- endpoints must be HTTP or HTTPS;
- legacy host-play URLs are migrated;
- repairs are reported to the UI;
- a failed save remains visible and is not marked persisted optimistically;
- the Options endpoint field is a draft until **Save endpoint** succeeds.

Voice discovery returns structured errors. An empty voice list from a valid single-speaker model is distinct from a network, timeout, HTTP, JSON, or schema failure.

## Validation

### Current FIX2 evidence status

Automated coverage hardening passed permanent CI `30879304676`, attempt 1, on implementation SHA `740a86e2912615ba1b1868feb9709d82d78aafd6`, with 294 clean TypeScript tests, 57 clean Python tests, and all three Chromium matrices. Final same-SHA CI plus real-Coqui proof is maintained by issues `#2` and `#3` for request sequence 28. Human listening remains `NOT RUN`, so the broader FIX2 release is still `PARTIAL`.

### Extension gates

```bash
npm run lint
npm run typecheck
npm test -- --run --coverage
npm run build
```

Hosted CI also enforces coverage floors, validates the generated manifest/assets, builds a diagnostic bundle, and executes the extension in real Chromium.

### Coqui service tests

```bash
python -m pip install -r docker/coqui-local/requirements-test.txt
python -m pytest -q docker/coqui-local/tests
docker compose -f docker/docker-compose.yml config
```

The normal server tests use deterministic fake backends and injected failures; they do not download the real Coqui model.

### Real Chromium topology test

```bash
npm run build:e2e
CHROME_PATH=/path/to/chrome xvfb-run -a npm run test:chromium
```

The harness uses Chrome DevTools Protocol, the canonical `fixtures/playback-collision.txt`, and a deterministic local WAV server. It validates:

- exact semantic text preservation;
- short-sentence packing and semicolon preservation;
- continuation, sentence, and paragraph pacing at rates `0.5`, `1`, `2`, `4`, and `10`;
- direct production active-player counters with maximum `1` and terminal count `0`;
- rapid mixed-source replacement and explicit supersession;
- invalid-audio terminal failure;
- offscreen continuation after forced service-worker termination;
- popup status recovery after worker restart;
- Pause, Resume, and Cancel through the restarted worker.

### Real Coqui model validation

Run the real container harness from the repository root:

```bash
bash scripts/validate-real-coqui.sh
```

Evidence is written under `reports/real-coqui/` by default. This is intentionally separate from fake-backend CI because it downloads and initializes the real model, synthesizes WAV audio, inspects loopback publication and temporary files, recreates the service, and verifies that the persistent model volume remains populated.

Prior real-model evidence is run `30878123712`, attempt 1, on SHA `c8ded4193054a2bd19161debd4c485c49285f8a3`, artifact `8880334638`, image `sha256:e01444f5125b441789da72f9e465f11604d22878c7337b95fa732c8c0e57ebaa`. Final same-SHA runtime evidence for the sender-routing candidate is maintained by issue `#3` for request sequence 28. Script existence alone is never evidence.

### Structured listening validation

Use:

```text
docs/CHROME_READIT_FIX2_LISTENING_EVIDENCE_TEMPLATE_2026-08-02.md
```

Human listening remains a separate release gate. Automated completion and timing evidence cannot establish naturalness, audible seams, clipping, omissions, or repetition.

## Troubleshooting

### The popup says the server is unavailable

```bash
docker compose -f docker/docker-compose.yml ps
docker compose -f docker/docker-compose.yml logs coqui-local
curl --fail http://127.0.0.1:5002/api/ready
```

`/api/ping` can succeed while the model is still loading. `/api/ready` can also return `503` when every bounded queue slot is occupied.

### A voice cannot be loaded or is rejected

```bash
curl http://127.0.0.1:5002/api/voices
```

The UI now distinguishes discovery failure from a valid empty list. Voice availability depends on `COQUI_MODEL`; a single-speaker model may legitimately expose no selectable voices.

### Playback reports cleanup failure

A cleanup failure is fail-closed. Start requests remain rejected until the old source can be proven paused, cleared, and released. Record the cleanup stage and diagnostic counters rather than repeatedly clicking Start.

### The model downloads again

Confirm the effective Compose configuration includes:

```text
source: coqui_models
target: /home/readit/.local/share/tts
```

Then run `scripts/validate-real-coqui.sh` and preserve both startup logs.

### Chrome cannot load the bundle

Run `npm run build` again. The build fails if the CRXJS extension plugin is unavailable, and CI verifies the generated background, popup, Options, and offscreen entries plus the declared minimum Chrome version.

## Security and privacy

Selected text is sent only to the configured synthesis endpoint. The default endpoint is loopback-only. Read It does not intentionally log selected text or audio payloads, and user-visible errors do not include URL credentials, raw response bodies, local paths, or stack traces.

The extension currently declares `<all_urls>` because users may configure arbitrary HTTP(S) synthesis endpoints. Selection capture itself is user-invoked through `activeTab`. Converting endpoint access to optional host permissions remains recommended before Chrome Web Store publication.

## Design and implementation documents

- `docs/CHROME_READIT_PLAYBACK_HARDENING_SPEC_2026-08-02.md`
- `docs/CHROME_READIT_PLAYBACK_HARDENING_TODO_2026-08-02.md`
- `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_SPEC_2026-08-02.md`
- `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_TODO_2026-08-02.md`
- `docs/CHROME_READIT_FIX2_LISTENING_EVIDENCE_TEMPLATE_2026-08-02.md`
- `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_BLOCK17_RECONCILIATION_2026-08-03.md`
- `docs/CHROME_READIT_FIX2_EVIDENCE_INDEX_2026-08-02.md`
