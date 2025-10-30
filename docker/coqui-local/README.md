Coqui-local TTS server
======================

This directory contains a small Docker build that runs a CPU-based Coqui TTS server using the `TTS` Python package and a tiny FastAPI wrapper.

Usage
-----

Build and run with docker-compose included in the repo:

```bash
docker compose -f docker-compose.coqui.yml up --build -d
```

Or build/run directly with Docker:

```bash
docker build -t coqui-local:latest .
docker run --rm -p 5002:5002 coqui-local:latest
```

Endpoints
---------
- POST /api/tts
  - JSON body: { "text": "..." }
  - Response: audio/wav stream
- GET /api/ping
  - Healthcheck

Notes
-----
- On first run the TTS model will be downloaded (may be large). Set `COQUI_MODEL` env var to select another compatible model.
- The container installs `ffmpeg` and `libsndfile1` to ensure audio writing works.

Multi‑speaker voices and performance
-----------------------------------

- By default this repo can be configured to use multi‑speaker Coqui TTS models (for
  example `tts_models/en/vctk/vits`) which expose many named speakers. These allow
  the extension to list selectable voices and request playback with a chosen
  speaker id.
- Multi‑speaker models and vocoders are significantly larger than a single‑speaker
  model and will increase disk usage (hundreds of MBs). They also run slower on
  CPU; expect higher latency when synthesizing on the host without a GPU.
- To reduce repeated downloads, the Docker compose configuration persists the
  model cache into a named volume (`coqui_models`). This avoids re-downloading
  the model on container recreate.

Configuration
-------------
- Set `COQUI_MODEL` (env) to choose a different model. Example values:
  - `tts_models/en/vctk/vits` (multi‑speaker VITS — many speakers)
  - `tts_models/en/ljspeech/tacotron2-DDC` (single‑speaker LJSpeech — smaller)
- Optionally set `COQUI_VOICES` to a comma-separated list if you want to expose
  custom voice names without relying on model introspection. Note: if the model
  doesn't support the supplied voice ids, requests using those names will fail.

Rebuild & run
-------------
After changing `COQUI_MODEL` or other settings, rebuild and restart the service:

```bash
docker compose -f docker/docker-compose.yml up -d --build coqui-local
```

The first run will download model files into the persisted volume; this can
take several minutes depending on network speed.
