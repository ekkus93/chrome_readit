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
