Local TTS helper

This folder contains a tiny local HTTP server to call system TTS (spd-say or espeak-ng) from the browser when the browser's speechSynthesis voices are unavailable (e.g., snap Chromium).

Usage:

1) Install dependencies (none required besides system tools: `spd-say` or `espeak-ng`).

2) Run the server:

```bash
node scripts/tts-server.js 4000
```

3) From the page or extension, POST text to speak:

```js
fetch('http://127.0.0.1:4000/speak', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: 'Hello from local helper' })
})
.then(r => r.json()).then(console.log).catch(console.error)
```

Notes:
- The server listens on localhost only (127.0.0.1) and enables CORS for convenience during local testing.
- This is a development helper and should not be used as a production remote API.
- You can wire the extension to POST to this helper when `speechSynthesis.getVoices()` returns an empty array.

Coqui / OpenTTS integration
---------------------------

You can run a local Coqui TTS (or OpenTTS) server and have this helper proxy requests to it. The helper supports two modes:

- Default mode (no COQUI_URL): the helper will call local system TTS (`spd-say` or `espeak-ng`) and play audio on the host.
- Proxy mode (set `COQUI_URL`): the helper will forward POST requests to the configured Coqui/OpenTTS URL. If the upstream returns audio, the helper will play it on the host. The helper also exposes `/speak_audio` which will proxy and return the raw audio bytes from upstream.

Docker Compose example (included in repo)
----------------------------------------


The repository includes a `docker-compose.coqui.yml` with a `coqui-local` service that builds and runs the Coqui TTS server (CPU build) on port 5002. To start the Coqui service alone:

```bash
# from the repo root
docker compose -f docker-compose.coqui.yml up --build -d
```

If you still want to run the small local helper (for `spd-say`/`espeak-ng` fallback or to keep the existing `/speak` endpoint), run the helper locally and point it at Coqui:

```bash
COQUI_URL=http://localhost:5002/api/tts COQUI_MODEL=tts_models/en/vctk/vits node scripts/tts-server.js 4000
```

Notes on COQUI_URL and models
- `COQUI_URL` should point to the TTS server endpoint that accepts a JSON POST with `{ text: "..." }` and returns audio (audio/wav or similar). For OpenTTS, the compatible endpoint is typically `/api/tts`.
- You can set `COQUI_MODEL` to request a particular model name when the upstream server supports that parameter (the helper will add `model_name` to the proxied JSON payload).

Audio playback in Docker
------------------------
If you run the helper or the Coqui server in Docker and want the container to play audio on your host, you can map PulseAudio or ALSA devices. The included `docker-compose.coqui.yml` demonstrates mapping the Pulse socket and `/dev/snd` in the `docker/coqui-local` build. This is platform-specific — see the compose file comments for guidance.

Security
--------
This helper is intended for local development. Do not expose it publicly without proper authentication and safeguards.
