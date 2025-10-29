FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ffmpeg \
    libsndfile1 \
    git \
    curl \
    pulseaudio-utils \
    alsa-utils \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install at build time so the container does not
# perform a runtime pip install when started.
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY app.py /app/app.py
COPY start-app.sh /app/start-app.sh
RUN chmod +x /app/start-app.sh

EXPOSE 8000

CMD ["/app/start-app.sh"]
