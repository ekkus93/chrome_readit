# Read It — Chrome text-to-speech extension

[![CI](https://github.com/ekkus93/chrome_readit/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/ekkus93/chrome_readit/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/ekkus93/chrome_readit/branch/master/graph/badge.svg)](https://codecov.io/gh/ekkus93/chrome_readit)

Read It is a Manifest V3 Chrome extension that reads selected text through a local Coqui TTS service. It provides keyboard-accessible playback controls, configurable voices and rates, sentence-aware chunking, and explicit paragraph pacing.

## Architecture

Read It has one production playback owner:

```text
Popup / Options / keyboard / context menu
                    │
                    ▼
        Manifest V3 service worker
        selection capture + routing only
                    │
                    ▼
        Extension offscreen document
     normalization → segmentation → packing
       synthesis queue → one Audio element
                    │
                    ▼
       Local Coqui FastAPI service
```

### Extension responsibilities

- `src/background/service-worker.ts`
  - captures the active page selection;
  - loads and migrates settings;
  - ensures the offscreen document exists;
  - routes start, status, pause, resume, and cancel requests;
  - does **not** own the playback queue or fetch audio.
- `src/offscreen/playback-coordinator.ts`
  - owns the active session and queue;
  - synthesizes the current chunk and at most one prefetched chunk;
  - uses one persistent `HTMLAudioElement`;
  - stops and cleans the old session before accepting a replacement;
  - continues queue progression independently of service-worker memory;
  - emits typed status and diagnostic events.
- `src/lib/text-normalization.ts`
  - normalizes line endings, whitespace, and paragraph boundaries;
  - enforces the selected-text length limit.
- `src/lib/text-segmentation.ts`
  - handles decimals, versions, domains, URLs, email addresses, abbreviations, quotes, ellipses, and sentence-ending punctuation;
  - does not treat semicolons as sentence endings.
- `src/lib/chunk-packing.ts`
  - packs adjacent complete sentences instead of making one TTS request per sentence;
  - never crosses paragraph boundaries;
  - uses 280/400/500-character target, soft, and hard limits.
- `src/lib/playback-pacing.ts`
  - preserves bounded continuation, sentence, and paragraph pauses at high playback rates.
- `src/lib/playback-protocol.ts`
  - defines and validates all cross-context playback messages and structured errors.

Popup test speech, Options test speech, selection reading, keyboard commands, and context-menu reading all use the same offscreen coordinator. There are no separate UI-local or content-script audio players.

## Requirements

- Node.js 22.12 or newer
- npm
- Chrome or Chromium with Manifest V3 offscreen-document support
- Docker with the Compose plugin

The tested Node version is recorded in `.nvmrc`.

## Start the local TTS service

From the repository root:

```bash
docker compose -f docker/docker-compose.yml up --build
```

The default Compose configuration:

- publishes the API only on `127.0.0.1:5002`;
- uses `tts_models/en/vctk/vits` unless overridden;
- persists the Coqui model cache in the `coqui_models` volume;
- runs a single inference worker behind a bounded queue;
- rejects empty, oversized, overloaded, invalid-voice, and timed-out requests;
- removes temporary WAV files after each response or failure;
- runs as a non-root container user;
- exposes no host-audio playback or debug endpoint.

The first startup may take several minutes while the configured model is downloaded into the persistent volume.

### Service endpoints

- `GET /api/ping` — process liveness
- `GET /api/ready` — model and queue readiness
- `GET /api/voices` — voices exposed by the active model
- `POST /api/tts` — synthesize a bounded text chunk and return `audio/wav`

Normal extension playback uses only `POST /api/tts`. Legacy stored URLs ending in `/api/tts/play` are migrated automatically to `/api/tts`.

### Service configuration

Compose accepts these environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `COQUI_PORT` | `5002` | Host loopback port |
| `COQUI_MODEL` | `tts_models/en/vctk/vits` | Coqui model identifier |
| `COQUI_VOICES` | empty | Optional comma-separated voice override |
| `MAX_TEXT_CHARS` | `500` | Maximum characters per synthesis request |
| `SYNTH_QUEUE_CAPACITY` | `4` | Active plus queued synthesis jobs |
| `SYNTH_TIMEOUT_SECONDS` | `120` | Per-request wait limit |

To intentionally expose the service beyond the local machine, edit the Compose port binding explicitly and apply appropriate network authentication and firewall controls. Remote exposure is not the default or supported security posture.

## Build and load the extension

```bash
npm ci --legacy-peer-deps
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

A new read or test request atomically supersedes the active session. Pause, resume, and cancel always target the same offscreen player.

## Validation

### Extension gates

```bash
npm run lint
npm run typecheck
npm test -- --run
npm run build
```

### Coqui service tests

```bash
python -m pip install -r docker/coqui-local/requirements-test.txt
python -m pytest -q docker/coqui-local/tests
docker compose -f docker/docker-compose.yml config
```

The server tests use a deterministic fake TTS backend; they do not download the real Coqui model.

### Real Chromium topology test

Build a diagnostic test bundle, then run the unpacked-extension harness with Chrome available through `CHROME_PATH`:

```bash
npm run build:e2e
CHROME_PATH=/path/to/chrome xvfb-run -a npm run test:chromium
```

The harness uses Chrome DevTools Protocol and a deterministic local WAV server. It verifies:

- short-sentence packing;
- semicolon preservation;
- bounded paragraph pacing at the maximum supported rate;
- no overlapping chunk intervals;
- stop-before-replace behavior;
- queue continuation after forced service-worker termination;
- unique session identifiers after worker restart.

## Troubleshooting

### The popup says the server is unavailable

```bash
docker compose -f docker/docker-compose.yml ps
docker compose -f docker/docker-compose.yml logs coqui-local
curl --fail http://127.0.0.1:5002/api/ready
```

`/api/ping` can succeed while the model is still loading. The extension probes `/api/ready` because playback requires a ready model.

### A voice is rejected

Query the active model:

```bash
curl http://127.0.0.1:5002/api/voices
```

Voice availability depends on `COQUI_MODEL`. Single-speaker models may return an empty list and ignore the configured voice name.

### The model downloads again

Confirm the effective Compose configuration includes:

```text
source: coqui_models
target: /home/readit/.local/share/tts
```

### Chrome cannot load the bundle

Run `npm run build` again. The build fails closed if the CRXJS extension plugin is unavailable, and CI verifies the generated background, popup, Options, and offscreen entries.

## Security and privacy

Selected text is sent only to the configured TTS endpoint. The default endpoint is loopback-only. Read It does not log selected text or audio payloads. The extension currently declares broad host permissions so it can capture selections on user-opened pages; this should be revisited before Chrome Web Store publication.

## Design and implementation documents

- `docs/CHROME_READIT_PLAYBACK_HARDENING_SPEC_2026-08-02.md`
- `docs/CHROME_READIT_PLAYBACK_HARDENING_TODO_2026-08-02.md`
