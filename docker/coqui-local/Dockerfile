FROM python:3.11-slim AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential git && \
    rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"

WORKDIR /build
COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements.txt


FROM python:3.11-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive \
    PATH="/opt/venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TTS_HOME=/home/readit/.local/share/tts \
    XDG_DATA_HOME=/home/readit/.local/share

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg libsndfile1 espeak-ng && \
    rm -rf /var/lib/apt/lists/* && \
    useradd --create-home --uid 10001 --shell /usr/sbin/nologin readit && \
    mkdir -p /home/readit/.local/share/tts && \
    chown -R readit:readit /home/readit

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app
COPY --chown=readit:readit app.py healthcheck.py README.md ./

USER readit
EXPOSE 5002

HEALTHCHECK --interval=30s --timeout=5s --start-period=15m --retries=3 \
    CMD ["python", "/app/healthcheck.py"]

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5002", "--workers", "1", "--no-access-log"]
