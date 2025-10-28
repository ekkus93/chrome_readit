#!/usr/bin/env bash
set -euo pipefail

if ! python -c 'import pkgutil, sys; sys.exit(0 if pkgutil.find_loader("TTS") else 1)'; then
  echo "Installing Python requirements (this runs on container start)..."
  pip install --no-cache-dir -r /app/requirements.txt || {
    echo "pip install failed" >&2
    exit 1
  }
fi

echo "Starting uvicorn..."
uvicorn app:app --host 0.0.0.0 --port 8000
