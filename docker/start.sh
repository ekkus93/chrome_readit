#!/usr/bin/env bash
set -euo pipefail

# Install Python requirements if not present (fast path: pip cache will help after first run)
if ! python -c 'import pkgutil, sys; sys.exit(0 if pkgutil.find_loader("TTS") else 1)'; then
	echo "Installing Python requirements (this runs on container start)..."
	pip install --no-cache-dir -r /app/requirements.txt || {
		echo "pip install failed" >&2
		exit 1
	}
fi

# Start uvicorn FastAPI app in background
echo "Starting uvicorn..."
uvicorn app:app --host 127.0.0.1 --port 8000 &
UVICORN_PID=$!

sleep 1

echo "Starting nginx..."
nginx -g 'daemon off;'

# If nginx exits, kill uvicorn
kill $UVICORN_PID
