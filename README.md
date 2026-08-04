# Read It — Chrome text-to-speech extension

[![CI](https://github.com/ekkus93/chrome_readit/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/ekkus93/chrome_readit/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/ekkus93/chrome_readit/branch/master/graph/badge.svg)](https://codecov.io/gh/ekkus93/chrome_readit)

Read It is a Manifest V3 Chrome extension that reads selected text aloud. This repository contains:

- the Chrome extension;
- a Dockerized local Coqui TTS service; and
- the test and validation tooling for both components.

## Install

### Requirements

- Git
- Chrome 116 or newer
- Node.js 22.12.0 or newer
- npm
- Docker Engine or Docker Desktop with the Compose plugin

The repository pins the tested Node version in `.nvmrc`.

### 1. Clone the repository

```bash
git clone https://github.com/ekkus93/chrome_readit.git
cd chrome_readit
```

### 2. Build and start the Docker TTS service

From the repository root:

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

This command builds the local Coqui image and starts the service in the background.

The first startup downloads `tts_models/en/vctk/vits` into the persistent `coqui_models` Docker volume. The API may start responding before the model is ready.

Watch the startup log:

```bash
docker compose -f docker/docker-compose.yml logs -f coqui-local
```

Check the container state:

```bash
docker compose -f docker/docker-compose.yml ps
```

Verify the service:

```bash
curl http://127.0.0.1:5002/api/ping
curl --fail http://127.0.0.1:5002/api/ready
curl http://127.0.0.1:5002/api/voices
```

`/api/ready` returns HTTP 503 while the model is loading or while the synthesis queue is full. Continue only after it returns HTTP 200.

Default extension settings:

```text
TTS endpoint: http://localhost:5002/api/tts
Voice: p225
Speech rate: 1.0
```

### 3. Build the Chrome extension

Install the pinned Node version with `nvm`, when available:

```bash
nvm install
nvm use
```

Install dependencies and build the extension:

```bash
npm ci
npm run build
```

The unpacked extension is written to:

```text
dist/
```

### 4. Load the extension in Chrome

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the repository's `dist/` directory.

This repository does not currently provide a Chrome Web Store package. Install it as an unpacked extension.

### 5. Verify the extension

1. Open the extension's **Options** page.
2. Confirm **TTS synthesis endpoint** is `http://localhost:5002/api/tts`.
3. Click **Test server**.
4. Confirm the page reports **Server accepting requests**.
5. Select voice `p225` if it is not already selected.
6. Click **Test speech**.

The Docker service and extension are installed when the server test succeeds and the test sentence plays.

## Use

Read selected text with any of these methods:

- Select text and press `Alt+Shift+R`.
- Right-click selected text and choose **Read selection aloud**.
- Open the popup and use its controls.

Playback controls:

| Action | Shortcut |
| --- | --- |
| Read selection | `Alt+Shift+R` |
| Pause | `Alt+Shift+P` |
| Resume | `Alt+Shift+U` |
| Cancel | `Alt+Shift+C` |

Voice, playback rate, endpoint, server testing, and test speech are available on the Options page.

## Update or rebuild

Pull repository changes:

```bash
git pull
```

Rebuild and restart the Docker service:

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

Rebuild the extension:

```bash
npm ci
npm run build
```

Then open `chrome://extensions/` and click **Reload** on the Read It extension card.

Chrome does not automatically reload an unpacked extension when `dist/` changes.

## Docker service operations

### Start

```bash
docker compose -f docker/docker-compose.yml up -d
```

### Stop

```bash
docker compose -f docker/docker-compose.yml down
```

This keeps the downloaded model in the `coqui_models` volume.

### Stop and delete the model cache

```bash
docker compose -f docker/docker-compose.yml down -v
```

Use `-v` only when you intend to delete the downloaded model. The next startup will download it again.

### Rebuild without Docker layer cache

```bash
docker compose -f docker/docker-compose.yml build --no-cache
docker compose -f docker/docker-compose.yml up -d
```

### Show logs

```bash
docker compose -f docker/docker-compose.yml logs -f coqui-local
```

### Show the effective Compose configuration

```bash
docker compose -f docker/docker-compose.yml config
```

The default configuration binds the service only to `127.0.0.1` and mounts `coqui_models` at `/home/readit/.local/share/tts`.

### Build and run without Compose

From `docker/coqui-local/`:

```bash
docker build -t chrome-readit-coqui .
docker run --rm \
  -p 127.0.0.1:5002:5002 \
  -v chrome_readit_coqui_models:/home/readit/.local/share/tts \
  chrome-readit-coqui
```

## TTS service configuration

Compose reads these environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `COQUI_PORT` | `5002` | Host loopback port |
| `COQUI_MODEL` | `tts_models/en/vctk/vits` | Coqui model identifier |
| `COQUI_VOICES` | empty | Optional comma-separated voice override |
| `MAX_TEXT_CHARS` | `500` | Maximum characters per synthesis request |
| `SYNTH_QUEUE_CAPACITY` | `4` | Active plus queued synthesis jobs |
| `SYNTH_TIMEOUT_SECONDS` | `120` | Request wait timeout |

Example:

```bash
COQUI_PORT=5003 SYNTH_QUEUE_CAPACITY=2 \
  docker compose -f docker/docker-compose.yml up -d --build
```

When changing `COQUI_PORT`, also change the extension endpoint on the Options page, for example:

```text
http://localhost:5003/api/tts
```

Invalid numeric values and an empty model name fail startup.

### API endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/ping` | Process liveness |
| GET | `/api/ready` | Model readiness and queue availability |
| GET | `/api/voices` | Available voices or speakers |
| POST | `/api/tts` | Synthesize WAV audio |

Example synthesis request:

```bash
curl --fail \
  -H 'Content-Type: application/json' \
  -d '{"text":"This is a test.","voice":"p225"}' \
  http://127.0.0.1:5002/api/tts \
  --output test.wav
```

The service does not provide host-audio playback endpoints. Audio playback is owned by the Chrome extension.

## Extension settings

The default stored settings are:

| Setting | Default |
| --- | --- |
| Voice | `p225` |
| Speech rate | `1.0` |
| TTS endpoint | `http://localhost:5002/api/tts` |

On the Options page:

- **Save endpoint** stores the current HTTP or HTTPS URL.
- **Use local default** restores `http://localhost:5002/api/tts`.
- **Test server** checks whether the configured service is ready.
- **Test speech** sends the text in the test box through the normal playback path.

Malformed stored settings are repaired to safe values. Legacy URLs ending in `/api/tts/play` are migrated to `/api/tts`.

## Troubleshooting

### `/api/ready` returns HTTP 503

Check logs:

```bash
docker compose -f docker/docker-compose.yml logs -f coqui-local
```

Common causes:

- the model is still downloading;
- the model is still loading; or
- every synthesis queue slot is occupied.

`/api/ping` can succeed before `/api/ready` succeeds.

### The Options page says the server is unavailable

Check the service directly:

```bash
curl --fail http://127.0.0.1:5002/api/ready
```

Then confirm the saved endpoint is:

```text
http://localhost:5002/api/tts
```

If Docker is running on another computer, `localhost` is wrong. Set the endpoint to the address of that computer and secure the service before exposing it to the network.

### Chrome cannot load `dist/`

Rebuild it:

```bash
npm ci
npm run build
```

Confirm `dist/manifest.json` exists, then load the `dist/` directory—not the repository root.

### Changes do not appear in Chrome

Run:

```bash
npm run build
```

Then click **Reload** for the extension on `chrome://extensions/`.

### No voices appear

Check the API:

```bash
curl http://127.0.0.1:5002/api/voices
```

Voice availability depends on the configured model. The default VCTK model exposes multiple speakers and uses `p225` as the default.

### The model downloads again

Confirm the Compose volume is present:

```bash
docker volume ls | grep coqui_models
```

Do not run `docker compose down -v` unless you intend to delete the model cache.

### Playback reports a cleanup failure

Playback cleanup is fail-closed. A new session is rejected when the previous audio source cannot be proven stopped and released. Reload the extension and inspect the browser extension logs rather than repeatedly starting new speech.

## Development and validation

### Extension checks

```bash
npm run lint
npm run typecheck
node scripts/check-coverage-surface.mjs
npx vitest --run --coverage
node scripts/check-coverage-thresholds.mjs
npm run build
npm run build:e2e
```

### Coqui service tests

```bash
python -m pip install -r docker/coqui-local/requirements-test.txt
python -m pytest -q docker/coqui-local/tests \
  --cov=docker/coqui-local \
  --cov-config=.coveragerc \
  --cov-branch \
  --cov-report=term-missing
python scripts/check_python_coverage.py
```

The normal Python test suite uses injected fake TTS backends and does not download the real model.

### Chromium extension tests

```bash
npm run build:e2e
CHROME_PATH=/path/to/chrome xvfb-run -a npm run test:chromium
CHROME_PATH=/path/to/chrome xvfb-run -a npm run test:chromium-ui
```

### Real-model validation

```bash
bash scripts/validate-real-coqui.sh
```

This builds and starts the real container, loads the actual model, synthesizes WAV audio, checks queue and timeout behavior, recreates the service, and verifies model-cache reuse.

## Architecture

```text
Chrome popup / Options / keyboard / context menu
                         │
                         ▼
              Manifest V3 service worker
             selection capture and routing
                         │
                         ▼
                Offscreen document
       text processing, synthesis queue, Audio
                         │
                         ▼
              Coqui FastAPI service
```

The service worker is the sole request owner for extension-document start, status, pause, resume, and cancel messages. The offscreen document owns the playback coordinator and the single persistent `HTMLAudioElement`.

Important files:

| Path | Purpose |
| --- | --- |
| `src/background/service-worker.ts` | Selection capture, command handling, offscreen lifecycle, status persistence |
| `src/offscreen.ts` | Offscreen runtime message adapter |
| `src/offscreen/playback-coordinator.ts` | Playback session, queue, cleanup, pacing, and replacement logic |
| `src/lib/tts-client.ts` | Bounded HTTP audio client |
| `src/lib/storage.ts` | Settings validation, defaults, repair, and migration |
| `docker/coqui-local/app.py` | FastAPI TTS service and bounded synthesis runtime |
| `docker/docker-compose.yml` | Default local container configuration |

## Security and privacy

Selected text is sent to the configured synthesis endpoint. The default endpoint is local and the Docker service binds only to `127.0.0.1`.

The extension declares `<all_urls>` because users can configure arbitrary HTTP or HTTPS TTS endpoints. Do not expose the Docker service beyond the local machine without authentication, TLS, firewall rules, and an explicit network design.

## Current validation status

Final coverage-hardening validation passed on exact SHA `3b308d016153b372d247945f0932ae98a4c91142`:

- CI run `30881863828`, attempt 1;
- real-Coqui run `30881863836`, attempt 1;
- 294 TypeScript tests;
- 57 Python tests;
- TypeScript coverage: 95.52% statements/lines, 87.61% branches, 96.15% functions;
- Python coverage: 97.44% statements, 89.19% branches; and
- all hosted Chromium matrices passed.

Automated validation does not establish subjective audio quality. The separate human listening gate has not been executed, so the broader FIX2 disposition remains `PARTIAL`.

## Project documents

- `docs/CHROME_READIT_PLAYBACK_HARDENING_SPEC_2026-08-02.md`
- `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_SPEC_2026-08-02.md`
- `docs/CHROME_READIT_PLAYBACK_HARDENING_FIX2_TODO_2026-08-02.md`
- `docs/CHROME_READIT_FIX2_LISTENING_EVIDENCE_TEMPLATE_2026-08-02.md`
- `docs/CHROME_READIT_FIX2_EVIDENCE_INDEX_2026-08-02.md`
- `docs/CHROME_READIT_TEST_COVERAGE_HARDENING_SPEC_2026-08-03.md`
- `docs/CHROME_READIT_TEST_COVERAGE_HARDENING_TODO_2026-08-03.md`
- `docs/CHROME_READIT_TEST_COVERAGE_HARDENING_IMPLEMENTATION_REPORT_2026-08-03.md`
