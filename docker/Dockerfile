FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    nginx \
    build-essential \
    ffmpeg \
    libsndfile1 \
    git \
    curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and server files
COPY docker/requirements.txt /app/requirements.txt
# Defer Python package installation to container startup to avoid very long builds
# (TTS packages may download large model files during install). The start script
# will perform 'pip install -r requirements.txt' on first run.

COPY docker/app.py /app/app.py
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 5002

CMD ["/app/start.sh"]
