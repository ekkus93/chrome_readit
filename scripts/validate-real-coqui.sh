#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"
COMPOSE_FILE="${ROOT_DIR}/docker/docker-compose.yml"
ARTIFACT_DIR="${REAL_COQUI_ARTIFACT_DIR:-${ROOT_DIR}/reports/real-coqui}"
PORT="${COQUI_PORT:-5002}"
BASE_URL="http://127.0.0.1:${PORT}"
READY_TIMEOUT_SECONDS="${REAL_COQUI_READY_TIMEOUT_SECONDS:-900}"
KEEP_RUNNING="${REAL_COQUI_KEEP_RUNNING:-0}"
PREFERRED_VOICE="${REAL_COQUI_VOICE:-p225}"

mkdir -p "${ARTIFACT_DIR}"

capture_runtime_evidence() {
  docker compose -f "${COMPOSE_FILE}" ps --format json \
    >"${ARTIFACT_DIR}/compose-ps-final.json" 2>/dev/null || true
  docker compose -f "${COMPOSE_FILE}" logs --no-color coqui-local \
    >"${ARTIFACT_DIR}/final-container.log" 2>&1 || true
}

cleanup() {
  capture_runtime_evidence
  if [[ "${KEEP_RUNNING}" != "1" ]]; then
    docker compose -f "${COMPOSE_FILE}" down --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

fail() {
  printf 'real-coqui validation failed: %s\n' "$*" >&2
  exit 1
}

request_json() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  if [[ -n "${body}" ]]; then
    curl --silent --show-error --fail-with-body \
      --request "${method}" \
      --header 'Content-Type: application/json' \
      --data "${body}" \
      "${url}"
  else
    curl --silent --show-error --fail-with-body --request "${method}" "${url}"
  fi
}

printf 'Building real Coqui image without cache...\n'
docker compose -f "${COMPOSE_FILE}" build --no-cache coqui-local \
  2>&1 | tee "${ARTIFACT_DIR}/build.log"

printf 'Starting real Coqui service...\n'
docker compose -f "${COMPOSE_FILE}" up -d coqui-local

deadline=$((SECONDS + READY_TIMEOUT_SECONDS))
until curl --silent --fail "${BASE_URL}/api/ready" >"${ARTIFACT_DIR}/ready.json"; do
  if (( SECONDS >= deadline )); then
    capture_runtime_evidence
    cp "${ARTIFACT_DIR}/final-container.log" "${ARTIFACT_DIR}/startup-timeout.log" 2>/dev/null || true
    fail "service did not become ready within ${READY_TIMEOUT_SECONDS}s"
  fi
  sleep 2
done

request_json GET "${BASE_URL}/api/ping" >"${ARTIFACT_DIR}/ping.json"
request_json GET "${BASE_URL}/api/voices" >"${ARTIFACT_DIR}/voices.json"

voice="$(python - "${ARTIFACT_DIR}/ready.json" "${ARTIFACT_DIR}/voices.json" "${PREFERRED_VOICE}" <<'PY'
import json
import sys
from pathlib import Path

ready = json.loads(Path(sys.argv[1]).read_text())
voices = json.loads(Path(sys.argv[2]).read_text()).get("voices")
preferred = sys.argv[3]
if ready.get("ok") is not True or ready.get("ready") is not True:
    raise SystemExit("readiness response is not ready")
if ready.get("accepting_requests") is not True:
    raise SystemExit("readiness response is not accepting requests")
if not isinstance(voices, list):
    raise SystemExit("voices response does not contain a list")
if preferred in voices:
    print(preferred)
elif voices:
    print(voices[0])
else:
    print("")
PY
)"
printf '%s\n' "${voice}" >"${ARTIFACT_DIR}/selected-voice.txt"

python - "${voice}" >"${ARTIFACT_DIR}/request.json" <<'PY'
import json
import sys
print(json.dumps({"text": "Chrome Read It real Coqui validation.", "voice": sys.argv[1] or None}))
PY

curl --silent --show-error --fail-with-body \
  --dump-header "${ARTIFACT_DIR}/tts.headers" \
  --header 'Content-Type: application/json' \
  --data-binary "@${ARTIFACT_DIR}/request.json" \
  --output "${ARTIFACT_DIR}/tts.wav" \
  "${BASE_URL}/api/tts"

grep -Eiq '^content-type:[[:space:]]*audio/wav' "${ARTIFACT_DIR}/tts.headers" \
  || fail "synthesis response did not declare audio/wav"
[[ -s "${ARTIFACT_DIR}/tts.wav" ]] || fail "synthesis response was empty"
[[ "$(head -c 4 "${ARTIFACT_DIR}/tts.wav")" == "RIFF" ]] || fail "synthesis response was not a RIFF WAV"

empty_status="$(curl --silent --output "${ARTIFACT_DIR}/empty.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' --data '{"text":"   "}' "${BASE_URL}/api/tts")"
[[ "${empty_status}" == "400" ]] || fail "empty text returned HTTP ${empty_status}, expected 400"

oversized_text="$(python - <<'PY'
print('x' * 501)
PY
)"
oversized_payload="$(python - "${oversized_text}" <<'PY'
import json
import sys
print(json.dumps({"text": sys.argv[1]}))
PY
)"
oversized_status="$(curl --silent --output "${ARTIFACT_DIR}/oversized.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' --data "${oversized_payload}" "${BASE_URL}/api/tts")"
[[ "${oversized_status}" == "413" ]] || fail "oversized text returned HTTP ${oversized_status}, expected 413"

if [[ -n "${voice}" ]]; then
  invalid_status="$(curl --silent --output "${ARTIFACT_DIR}/invalid-voice.json" --write-out '%{http_code}' \
    --header 'Content-Type: application/json' \
    --data '{"text":"voice validation","voice":"__missing_voice__"}' \
    "${BASE_URL}/api/tts")"
  [[ "${invalid_status}" == "400" ]] || fail "invalid voice returned HTTP ${invalid_status}, expected 400"
fi

python - "${PORT}" "${ARTIFACT_DIR}/compose-port.json" <<'PY'
import json
import subprocess
import sys
from pathlib import Path

port = int(sys.argv[1])
out = subprocess.check_output([
    "docker", "compose", "-f", "docker/docker-compose.yml", "ps", "--format", "json"
], text=True)
Path(sys.argv[2]).write_text(out)
records = [json.loads(line) for line in out.splitlines() if line.strip()]
if not records:
    raise SystemExit("Compose returned no running service records")
publishers = [
    publisher
    for record in records
    for publisher in record.get("Publishers", [])
    if isinstance(publisher, dict)
]
expected = any(
    publisher.get("URL") == "127.0.0.1"
    and publisher.get("TargetPort") == 5002
    and publisher.get("PublishedPort") == port
    and publisher.get("Protocol") == "tcp"
    for publisher in publishers
)
if not expected:
    raise SystemExit("Compose did not publish the service on loopback only")
if any(publisher.get("URL") not in ("127.0.0.1", None, "") for publisher in publishers):
    raise SystemExit("Compose exposed the service on a non-loopback address")
PY

container_id="$(docker compose -f "${COMPOSE_FILE}" ps -q coqui-local)"
[[ -n "${container_id}" ]] || fail "container ID is unavailable"
docker exec "${container_id}" sh -c \
  "find /tmp -maxdepth 1 -type f -name 'chrome-readit-*.wav' -print" \
  >"${ARTIFACT_DIR}/temp-files-after-success.txt"
[[ ! -s "${ARTIFACT_DIR}/temp-files-after-success.txt" ]] \
  || fail "temporary WAV files remained after successful response"

docker compose -f "${COMPOSE_FILE}" logs --no-color coqui-local \
  >"${ARTIFACT_DIR}/first-start.log" 2>&1

docker compose -f "${COMPOSE_FILE}" stop coqui-local
docker compose -f "${COMPOSE_FILE}" up -d coqui-local

deadline=$((SECONDS + READY_TIMEOUT_SECONDS))
until curl --silent --fail "${BASE_URL}/api/ready" >"${ARTIFACT_DIR}/ready-after-recreate.json"; do
  (( SECONDS < deadline )) || fail "recreated service did not become ready"
  sleep 2
done

docker compose -f "${COMPOSE_FILE}" logs --no-color coqui-local \
  >"${ARTIFACT_DIR}/second-start.log" 2>&1

model_volume="$(docker volume ls --format '{{.Name}}' | grep -E '(^|_)coqui_models$' | head -n 1 || true)"
[[ -n "${model_volume}" ]] || fail "persistent Coqui model volume was not found"
image_id="$(docker compose -f "${COMPOSE_FILE}" images -q coqui-local)"
[[ -n "${image_id}" ]] || fail "built Coqui image ID was not found"
docker run --rm -v "${model_volume}:/models:ro" "${image_id}" \
  sh -c 'find /models -mindepth 1 -maxdepth 4 -type f -print -quit | grep -q .' \
  || fail "model cache volume is empty after recreation"

capture_runtime_evidence
printf 'Real Coqui validation passed. Evidence: %s\n' "${ARTIFACT_DIR}"
