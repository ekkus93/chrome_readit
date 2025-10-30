# Read It — Chrome extension (React + TypeScript + Vite)

[![CI](https://github.com/ekkus93/chrome_readit/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/ekkus93/chrome_readit/actions/workflows/ci.yml)

[![Coverage](https://codecov.io/gh/ekkus93/chrome_readit/branch/master/graph/badge.svg)](https://codecov.io/gh/ekkus93/chrome_readit)

This repository contains "Read It", a Chrome extension built with React + TypeScript and Vite. The extension provides a keyboard-first, accessible UI to read selected text aloud using a local Coqui TTS Docker server with 109 high-quality voices.

This README documents what the extension does, how it's implemented, current project state, how to build & load it locally, and how to start the TTS server.

## What the extension does

  - Playback controls: Pause, Resume and Cancel (stop) while reading; available via popup/options buttons and keyboard commands.

## High-level architecture

  - Background worker: producer/consumer pipeline that prefetches TTS audio chunks and forwards them to the content script for ordered playback.
  - Chunking: sentence-aware chunking (character-based) with a current max chunk size of 400 characters and a per-chunk ack-or-timeout behavior to avoid stalls.
- `src/lib/messaging.ts` — Shared message types and helpers for extension communication.
- `src/lib/storage.ts` — Small storage wrapper for getting/saving voice and rate settings via `chrome.storage.sync`.
- `src/popup/Popup.tsx` — React popup UI allowing the user to trigger reading and configure voice/rate.
  - `src/background/timeout.integration.test.ts` — integration test verifying per-chunk ack-or-timeout behavior and that the background proceeds when content acks are slow or missing.
  - `src/background/splitting.integration.test.ts` — integration test verifying sentence-aware splitting and that each chunk is sent to the TTS server and forwarded to the page in order.
- `docker/coqui-local/Dockerfile` & `docker/coqui-local/app.py` — FastAPI server providing TTS endpoints with 109 voices.

Key implementation notes:
- Audio playback happens in the page context using HTML5 Audio API for reliable cross-origin audio
- Settings are stored under `settings` in `chrome.storage.sync` with default voice 'p225' and rate `1.0`

## Files of interest

- `src/manifest.ts` — manifest settings (permissions include `storage`, `activeTab`, `scripting`, `contextMenus`; `host_permissions` currently set to `<all_urls>`).
  - ✅ Added Pause/Resume/Cancel playback controls (UI + keyboard commands) and tests; improved background pipeline to prefetch audio and handle per-chunk timeouts.
- `src/background/service-worker.ts` — command and context menu logic plus injection fallback.
- `src/content/content.ts` — message listener and `speak()` implementation.
- `src/popup/Popup.tsx` and `src/options/Options.tsx` — React UIs for quick controls and persistent options.

## How to build and load locally

### Prerequisites
- Node.js 18+ and npm
- Docker and Docker Compose
- Chrome browser

### Step 1: Start the TTS Server

First, start the Coqui TTS Docker server that provides the 109 voices:

```bash
# From the repository root directory
docker compose -f docker/docker-compose.yml up --build
```

This will:
- Download and build the Coqui TTS container with VITS multi-speaker model
- Start the FastAPI server on `http://localhost:5002`
- Pre-download the TTS model (may take a few minutes on first run)
- Make 109 voices available via `/api/voices` endpoint

**Note:** Keep this terminal running. The extension requires the TTS server to be running.

### Step 2: Build the Chrome Extension

Install dependencies and build the extension:

```bash
# Install dependencies
npm install

# Build for distribution
npm run build
```

### Step 3: Load the Extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `dist/` folder from your project directory
5. The extension should now appear in your extensions list

### Step 4: Test the Extension

- Select text on any web page
- Use `Alt+Shift+R` to read the selection
- Right-click selected text → "Read selection aloud"
- Click the extension icon for the popup UI
- Go to extension options for settings and "Test Speech"

**Troubleshooting:**
- If TTS doesn't work, check that the Docker container is running on port 5002
- Check browser console (F12) for any extension errors
- Ensure the extension has the correct permissions

## Recommendations / next steps

Below are remaining recommended improvements, prioritized by impact.

1. **Permissions audit (HIGH for publishing):** Review `host_permissions` and either narrow the match patterns or switch to `optional_permissions` and programmatic injection where possible. Currently uses `<all_urls>` for broad web access.

2. **Additional tests & coverage (MEDIUM):** Some unit coverage exists. Remaining work: add more background-path tests (e.g., TTS server communication edge cases) and consider integration/e2e tests (Playwright) that load the unpacked extension into a Chromium instance.

3. **CI improvements (MEDIUM):** Parse the built `dist/manifest.json` after `npm run build` to discover referenced assets instead of hardcoding icon names. Consider adding Vitest coverage reports and gating thresholds.

4. **UX polish (LOW):** Improve popup feedback (e.g., "No selection", "Reading…", handle voice-list race conditions) and consider an explicit "Save" action on the Options page if preferred.

5. **Docs & release readiness (LOW):** Add a short publishing guide (Chrome Web Store packaging, keys, CHANGELOG) and confirm icon assets exist for all platforms.

6. **Performance optimization (LOW):** Consider lazy-loading the TTS model or implementing voice caching for faster startup.

## TTS Server (Coqui Docker)

The extension uses a local Coqui TTS Docker server that provides 109 high-quality voices. The server runs a FastAPI application with the following endpoints:

- `GET /api/voices` — List all available voices
- `POST /api/tts` — Generate speech audio (returns WAV file)
- `POST /api/tts/play` — Generate and play audio on host (server-side playback)

### Quick Start

```bash
# Start the TTS server (from repository root)
docker compose -f docker/docker-compose.yml up --build
```

The server will be available at `http://localhost:5002`. The extension is configured to use this endpoint by default.

### Configuration

The Docker setup includes:
- **VITS multi-speaker model** with 109 voices
- **espeak-ng phonemizer** for better text processing
- **FastAPI server** with automatic voice fallback to 'p225'
- **Model caching** to avoid re-downloads

### Voice Selection

The extension defaults to voice 'p225' but you can change this in the extension options. Available voices include various speakers with different genders, ages, and accents.

### Troubleshooting

**Container won't start:**
- Ensure Docker and Docker Compose are installed
- Check available disk space (models are ~200MB)
- Try `docker system prune` if you have disk space issues

**TTS server not responding:**
- Verify the container is running: `docker ps`
- Check container logs: `docker logs <container-name>`
- Ensure port 5002 is not in use by another service

**Audio quality issues:**
- The VITS model provides high-quality speech
- Voice 'p225' is a good default for clear, natural speech
- Some voices may work better for different types of text



