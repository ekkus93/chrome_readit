# Chrome Read It local Coqui TTS service

This directory contains the FastAPI service used by the Chrome Read It extension. It loads one Coqui TTS model and returns WAV audio for bounded text chunks.

## Start with Compose

From the repository root:

```bash
docker compose -f docker/docker-compose.yml up --build
```

The default service is available only at `http://127.0.0.1:5002`.

The first startup downloads the configured model into the persistent `coqui_models` volume. Subsequent container recreations reuse that cache.

## API

### `GET /api/ping`

Process liveness. This endpoint can respond while the model is still loading.

### `GET /api/ready`

Returns HTTP 200 only when the model/executor are ready and another bounded request can be accepted. It returns HTTP 503 while loading or saturated and reports queue state.

### `GET /api/voices`

Returns the speakers or voices exposed by the loaded model. `COQUI_VOICES` can provide an explicit comma-separated override.

### `POST /api/tts`

Request:

```json
{
  "text": "Text to synthesize.",
  "voice": "p225"
}
```

Success returns `audio/wav`. Failures use a stable JSON shape:

```json
{
  "ok": false,
  "error": {
    "code": "TEXT_TOO_LONG",
    "message": "Text exceeds the 500-character limit."
  }
}
```

The service does not provide `/api/tts/play`, `/api/playing`, `/api/tts/cancel`, or `/api/debug`. Browser playback belongs exclusively to the extension's offscreen coordinator.

## Concurrency and cleanup

- One executor worker accesses the shared Coqui model.
- A bounded semaphore limits active plus queued work.
- Queue overflow returns HTTP 429.
- Synthesis timeout returns HTTP 504; the queue slot remains occupied until in-process inference actually finishes.
- Invalid voices return HTTP 400 before queue/tempfile allocation.
- WAV paths remain tracked until deletion succeeds; timed-out work is cleaned after completion and failed deletion is retried at shutdown.
- The API does not return backend stack traces.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `COQUI_MODEL` | `tts_models/en/vctk/vits` | Coqui model identifier |
| `COQUI_VOICES` | empty | Optional comma-separated voice override |
| `MAX_TEXT_CHARS` | `500` | Maximum request text length |
| `SYNTH_QUEUE_CAPACITY` | `4` | Active plus queued synthesis jobs |
| `SYNTH_TIMEOUT_SECONDS` | `120` | Request wait timeout |
| `TTS_HOME` | `/home/readit/.local/share/tts` | Model cache location |
| `XDG_DATA_HOME` | `/home/readit/.local/share` | Coqui data root |

Compose also supports `COQUI_PORT`, which changes the host loopback port while leaving the container port at 5002.

## Direct Docker use

From this directory:

```bash
docker build -t chrome-readit-coqui .
docker run --rm \
  -p 127.0.0.1:5002:5002 \
  -v chrome_readit_coqui_models:/home/readit/.local/share/tts \
  chrome-readit-coqui
```

Do not replace the loopback binding with an all-interface binding unless the service is placed behind appropriate authentication, transport security, and firewall rules.

## Verified real-model evidence

Run `30854518366` passed on `31702133a5afd326902aa8f5bdfb6e2afe5dfe28` with artifact `8872045367` and verified VCTK `p225`, valid WAV, saturation-aware readiness, loopback-only/non-root/single-worker operation, timeout accounting, tempfile cleanup, bounded shutdown, and cache reuse.

## Tests

The service tests inject fake TTS backends and therefore do not download Coqui or model files:

```bash
python -m pip install -r docker/coqui-local/requirements-test.txt
python -m pytest -q docker/coqui-local/tests
```

They cover readiness, voices, valid WAV delivery, input limits, invalid voices, bounded queue behavior, serialized inference, timeout cleanup, synthesis failure cleanup, and absence of host-play/debug endpoints.

Validate the effective Compose configuration with:

```bash
docker compose -f docker/docker-compose.yml config
```

The output must include a `127.0.0.1` host IP and the `coqui_models` mount targeting `/home/readit/.local/share/tts`.
