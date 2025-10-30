FROM python:3.11-slim

# Allow selecting the Coqui model at build time (default to a multi-speaker VITS)
ARG COQUI_MODEL=tts_models/en/vctk/vits
ENV COQUI_MODEL=${COQUI_MODEL}

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        build-essential git ffmpeg libsndfile1 pulseaudio-utils alsa-utils espeak-ng && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Pre-warm the Coqui TTS model at build time so the image already contains
# the downloaded weights. This makes the image larger but avoids long first-run
# downloads when the container starts. You can override the model at build
# time with: docker build --build-arg COQUI_MODEL=tts_models/en/ljspeech/tacotron2-DDC .
RUN python - <<PY
import os
model = os.environ.get('COQUI_MODEL')
if model:
    try:
        print('Pre-downloading Coqui model:', model)
        from TTS.api import TTS
        # progress_bar=False avoids interactive download output during build
        TTS(model_name=model, progress_bar=False, gpu=False)
        print('Model download complete')
    except Exception as e:
        print('Warning: model pre-download failed:', e)
PY

COPY app.py ./
COPY README.md ./

EXPOSE 5002

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5002", "--workers", "1"]
