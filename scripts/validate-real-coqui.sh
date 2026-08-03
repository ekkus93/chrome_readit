#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"
COMPOSE_FILE="${ROOT_DIR}/docker/docker-compose.yml"
ARTIFACT_DIR="${REAL_COQUI_ARTIFACT_DIR:-${ROOT_DIR}/reports/real-coqui}"
PORT="${COQUI_PORT:-5002}"
TIMEOUT_PORT="${REAL_COQUI_TIMEOUT_PORT:-5003}"
BASE_URL="http://127.0.0.1:${PORT}"
TIMEOUT_BASE_URL="http://127.0.0.1:${TIMEOUT_PORT}"
READY_TIMEOUT_SECONDS="${REAL_COQUI_READY_TIMEOUT_SECONDS:-900}"
KEEP_RUNNING="${REAL_COQUI_KEEP_RUNNING:-0}"
PREFERRED_VOICE="${REAL_COQUI_VOICE:-p225}"
TIMEOUT_CONTAINER="chrome-readit-real-timeout-${GITHUB_RUN_ID:-$$}"
export SYNTH_QUEUE_CAPACITY="${SYNTH_QUEUE_CAPACITY:-${REAL_COQUI_QUEUE_CAPACITY:-1}}"

mkdir -p "${ARTIFACT_DIR}"

dc() {
  docker compose -f "${COMPOSE_FILE}" "$@"
}

capture_runtime_evidence() {
  dc ps --all --format json >"${ARTIFACT_DIR}/compose-ps-final.json" 2>/dev/null || true
  dc logs --no-color coqui-local >"${ARTIFACT_DIR}/final-container.log" 2>&1 || true
}

cleanup() {
  capture_runtime_evidence
  docker rm -f "${TIMEOUT_CONTAINER}" >/dev/null 2>&1 || true
  if [[ "${KEEP_RUNNING}" != "1" ]]; then
    dc down --remove-orphans >/dev/null 2>&1 || true
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

wait_for_ready() {
  local base_url="$1"
  local output_path="$2"
  local deadline=$((SECONDS + READY_TIMEOUT_SECONDS))
  until curl --silent --fail "${base_url}/api/ready" >"${output_path}"; do
    if (( SECONDS >= deadline )); then
      return 1
    fi
    sleep 2
  done
}

list_temp_files() {
  local container_id="$1"
  local output_path="$2"
  docker exec "${container_id}" sh -c \
    "find /tmp -maxdepth 1 -type f -name 'chrome-readit-*.wav' -print | sort" \
    >"${output_path}"
}

printf 'Removing prior containers and model volume for a cold validation...\n'
dc down -v --remove-orphans 2>&1 | tee "${ARTIFACT_DIR}/cold-reset.log"

printf 'Building real Coqui image without cache...\n'
build_started=$SECONDS
dc build --no-cache coqui-local 2>&1 | tee "${ARTIFACT_DIR}/build.log"
printf '%s\n' "$((SECONDS - build_started))" >"${ARTIFACT_DIR}/build-duration-seconds.txt"

mapfile -t image_refs < <(dc config --images)
[[ "${#image_refs[@]}" -eq 1 ]] \
  || fail "expected exactly one configured Compose image, found ${#image_refs[@]}"
image_ref="${image_refs[0]}"
[[ -n "${image_ref}" ]] || fail "configured Coqui image reference is empty"
printf '%s\n' "${image_ref}" >"${ARTIFACT_DIR}/image-ref.txt"
if ! image_id="$(docker image inspect --format '{{.Id}}' "${image_ref}")"; then
  fail "built Coqui image could not be inspected by configured reference ${image_ref}"
fi
[[ -n "${image_id}" ]] || fail "built Coqui image ID was empty"
printf '%s\n' "${image_id}" >"${ARTIFACT_DIR}/image-id.txt"
docker image inspect "${image_id}" >"${ARTIFACT_DIR}/image-inspect.json"

printf 'Starting real Coqui service...\n'
first_start=$SECONDS
dc up -d coqui-local
if ! wait_for_ready "${BASE_URL}" "${ARTIFACT_DIR}/ready.json"; then
  capture_runtime_evidence
  cp "${ARTIFACT_DIR}/final-container.log" "${ARTIFACT_DIR}/startup-timeout.log" 2>/dev/null || true
  fail "service did not become ready within ${READY_TIMEOUT_SECONDS}s"
fi
printf '%s\n' "$((SECONDS - first_start))" >"${ARTIFACT_DIR}/first-ready-duration-seconds.txt"

container_id="$(dc ps -q coqui-local)"
[[ -n "${container_id}" ]] || fail "container ID is unavailable"
printf '%s\n' "${container_id}" >"${ARTIFACT_DIR}/container-id.txt"
docker inspect "${container_id}" >"${ARTIFACT_DIR}/container-inspect.json"
docker exec "${container_id}" id >"${ARTIFACT_DIR}/container-identity.txt"
docker exec "${container_id}" sh -c \
  'printf "pid1_cmd="; tr "\0" " " </proc/1/cmdline; printf "\n"; grep -E "^(Name|Uid|Gid|Threads):" /proc/1/status' \
  >"${ARTIFACT_DIR}/container-process.txt"

python - "${ARTIFACT_DIR}/container-inspect.json" "${ARTIFACT_DIR}/container-identity.txt" "${ARTIFACT_DIR}/container-process.txt" <<'PY'
import json
import sys
from pathlib import Path

inspect = json.loads(Path(sys.argv[1]).read_text())[0]
identity = Path(sys.argv[2]).read_text()
process = Path(sys.argv[3]).read_text()
config = inspect.get("Config", {})
host = inspect.get("HostConfig", {})
mounts = inspect.get("Mounts", [])
if config.get("User") not in ("readit", "10001", "10001:10001"):
    raise SystemExit(f"unexpected configured container user: {config.get('User')!r}")
if "uid=10001(readit)" not in identity:
    raise SystemExit("container does not execute as uid 10001/readit")
if "uvicorn" not in process or "--workers 1" not in process:
    raise SystemExit("PID 1 is not the single-worker Uvicorn command")
if host.get("Privileged") is not False:
    raise SystemExit("container is privileged")
if host.get("PidMode") == "host" or host.get("IpcMode") == "host":
    raise SystemExit("container shares a host namespace")
if host.get("Devices"):
    raise SystemExit("container has unexpected host devices")
if host.get("CapAdd"):
    raise SystemExit("container has added Linux capabilities")
model_mounts = [m for m in mounts if m.get("Destination") == "/home/readit/.local/share/tts"]
if len(model_mounts) != 1 or model_mounts[0].get("Type") != "volume":
    raise SystemExit("model cache is not backed by exactly one named volume")
PY

ss -H -ltn >"${ARTIFACT_DIR}/host-listeners.txt"
python - "${PORT}" "${ARTIFACT_DIR}/host-listeners.txt" <<'PY'
import sys
from pathlib import Path

port = int(sys.argv[1])
lines = [line.split() for line in Path(sys.argv[2]).read_text().splitlines() if line.strip()]
listeners = [fields[3] for fields in lines if len(fields) >= 4 and fields[3].endswith(f":{port}")]
if listeners != [f"127.0.0.1:{port}"]:
    raise SystemExit(f"unexpected host listener set for port {port}: {listeners}")
PY

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
if ready.get("queue_capacity") != 1:
    raise SystemExit("validation service was not started with queue capacity one")
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
python - "${ARTIFACT_DIR}/tts.wav" <<'PY'
import sys
import wave
from pathlib import Path

path = Path(sys.argv[1])
if path.stat().st_size <= 44 or path.read_bytes()[:4] != b"RIFF":
    raise SystemExit("synthesis response was not a non-empty RIFF WAV")
with wave.open(str(path), "rb") as handle:
    if handle.getnchannels() <= 0 or handle.getframerate() <= 0 or handle.getnframes() <= 0:
        raise SystemExit("WAV structure contains no playable samples")
PY

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

invalid_status="$(curl --silent --output "${ARTIFACT_DIR}/invalid-voice.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data '{"text":"voice validation","voice":"__missing_voice__"}' \
  "${BASE_URL}/api/tts")"
[[ "${invalid_status}" == "400" ]] || fail "invalid voice returned HTTP ${invalid_status}, expected 400"
list_temp_files "${container_id}" "${ARTIFACT_DIR}/temp-files-after-invalid-voice.txt"
[[ ! -s "${ARTIFACT_DIR}/temp-files-after-invalid-voice.txt" ]] \
  || fail "invalid voice allocated a temporary WAV"

for endpoint in tts-play playing tts-cancel debug; do
  case "${endpoint}" in
    tts-play)
      removed_status="$(curl --silent --output "${ARTIFACT_DIR}/removed-tts-play.json" --write-out '%{http_code}' \
        --header 'Content-Type: application/json' --data '{"text":"Hello"}' "${BASE_URL}/api/tts/play")"
      ;;
    playing)
      removed_status="$(curl --silent --output "${ARTIFACT_DIR}/removed-playing.json" --write-out '%{http_code}' "${BASE_URL}/api/playing")"
      ;;
    tts-cancel)
      removed_status="$(curl --silent --output "${ARTIFACT_DIR}/removed-tts-cancel.json" --write-out '%{http_code}' \
        --request POST "${BASE_URL}/api/tts/cancel")"
      ;;
    debug)
      removed_status="$(curl --silent --output "${ARTIFACT_DIR}/removed-debug.json" --write-out '%{http_code}' "${BASE_URL}/api/debug")"
      ;;
  esac
  [[ "${removed_status}" == "404" ]] || fail "removed endpoint ${endpoint} returned HTTP ${removed_status}"
done

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

list_temp_files "${container_id}" "${ARTIFACT_DIR}/temp-files-before-saturation.txt"
[[ ! -s "${ARTIFACT_DIR}/temp-files-before-saturation.txt" ]] || fail "temporary WAV files existed before saturation test"
python - "${voice}" >"${ARTIFACT_DIR}/queue-request.json" <<'PY'
import json
import sys
text = ("Queue saturation validation sentence. " * 20)[:500]
print(json.dumps({"text": text, "voice": sys.argv[1] or None}))
PY
(
  curl --silent --show-error \
    --output "${ARTIFACT_DIR}/queue-primary.wav" \
    --write-out '%{http_code}' \
    --header 'Content-Type: application/json' \
    --data-binary "@${ARTIFACT_DIR}/queue-request.json" \
    "${BASE_URL}/api/tts" >"${ARTIFACT_DIR}/queue-primary.status"
) &
queue_pid=$!
queue_deadline=$((SECONDS + 60))
while :; do
  saturation_ready_status="$(curl --silent --output "${ARTIFACT_DIR}/ready-saturated.json" --write-out '%{http_code}' "${BASE_URL}/api/ready")"
  if [[ "${saturation_ready_status}" == "503" ]]; then
    break
  fi
  kill -0 "${queue_pid}" 2>/dev/null || fail "primary saturation request finished before the queue could be observed"
  (( SECONDS < queue_deadline )) || fail "queue did not report saturation"
  sleep 0.1
done
python - "${ARTIFACT_DIR}/ready-saturated.json" <<'PY'
import json
import sys
from pathlib import Path
payload = json.loads(Path(sys.argv[1]).read_text())
if payload.get("error", {}).get("code") != "QUEUE_FULL":
    raise SystemExit("saturated readiness did not report QUEUE_FULL")
PY
list_temp_files "${container_id}" "${ARTIFACT_DIR}/temp-files-during-saturation.txt"
[[ -s "${ARTIFACT_DIR}/temp-files-during-saturation.txt" ]] || fail "active synthesis tempfile was not observable"
queue_rejected_status="$(curl --silent --output "${ARTIFACT_DIR}/queue-rejected.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' --data-binary "@${ARTIFACT_DIR}/queue-request.json" "${BASE_URL}/api/tts")"
[[ "${queue_rejected_status}" == "429" ]] || fail "saturated queue returned HTTP ${queue_rejected_status}, expected 429"
wait "${queue_pid}"
[[ "$(cat "${ARTIFACT_DIR}/queue-primary.status")" == "200" ]] || fail "primary saturation request did not complete successfully"
wait_for_ready "${BASE_URL}" "${ARTIFACT_DIR}/ready-after-saturation.json" || fail "service did not recover after saturation"
list_temp_files "${container_id}" "${ARTIFACT_DIR}/temp-files-after-saturation.txt"
[[ ! -s "${ARTIFACT_DIR}/temp-files-after-saturation.txt" ]] || fail "temporary WAV files remained after saturation"

model_volume="$(docker inspect "${container_id}" --format '{{range .Mounts}}{{if eq .Destination "/home/readit/.local/share/tts"}}{{.Name}}{{end}}{{end}}')"
[[ -n "${model_volume}" ]] || fail "persistent Coqui model volume was not found"
printf '%s\n' "${model_volume}" >"${ARTIFACT_DIR}/model-volume-name.txt"
docker run --rm -v "${model_volume}:/models:ro" "${image_id}" \
  sh -c 'find /models -mindepth 1 -maxdepth 8 -type f -printf "%P\t%s\n" | sort' \
  >"${ARTIFACT_DIR}/model-cache-before-recreate.tsv"
[[ -s "${ARTIFACT_DIR}/model-cache-before-recreate.tsv" ]] || fail "model cache volume is empty"

dc logs --no-color coqui-local >"${ARTIFACT_DIR}/first-start.log" 2>&1
first_stop=$SECONDS
dc stop -t 10 coqui-local
printf '%s\n' "$((SECONDS - first_stop))" >"${ARTIFACT_DIR}/first-stop-duration-seconds.txt"
(( SECONDS - first_stop <= 15 )) || fail "normal container stop exceeded 15 seconds"

second_start=$SECONDS
dc up -d coqui-local
wait_for_ready "${BASE_URL}" "${ARTIFACT_DIR}/ready-after-recreate.json" || fail "recreated service did not become ready"
printf '%s\n' "$((SECONDS - second_start))" >"${ARTIFACT_DIR}/second-ready-duration-seconds.txt"
dc logs --no-color coqui-local >"${ARTIFACT_DIR}/second-start.log" 2>&1
container_id="$(dc ps -q coqui-local)"
docker run --rm -v "${model_volume}:/models:ro" "${image_id}" \
  sh -c 'find /models -mindepth 1 -maxdepth 8 -type f -printf "%P\t%s\n" | sort' \
  >"${ARTIFACT_DIR}/model-cache-after-recreate.tsv"
python - "${ARTIFACT_DIR}/model-cache-before-recreate.tsv" "${ARTIFACT_DIR}/model-cache-after-recreate.tsv" <<'PY'
import sys
from pathlib import Path

def read(path: str) -> dict[str, int]:
    output: dict[str, int] = {}
    for line in Path(path).read_text().splitlines():
        name, size = line.rsplit("\t", 1)
        output[name] = int(size)
    return output

before = read(sys.argv[1])
after = read(sys.argv[2])
if not before:
    raise SystemExit("cold-start cache manifest was empty")
missing = {name: size for name, size in before.items() if after.get(name) != size}
if missing:
    raise SystemExit(f"cached model files were not preserved across recreation: {sorted(missing)[:5]}")
PY

printf 'Starting exact-image timeout probe...\n'
docker rm -f "${TIMEOUT_CONTAINER}" >/dev/null 2>&1 || true
docker run -d \
  --name "${TIMEOUT_CONTAINER}" \
  --publish "127.0.0.1:${TIMEOUT_PORT}:5002" \
  --env COQUI_MODEL="${COQUI_MODEL:-tts_models/en/vctk/vits}" \
  --env COQUI_VOICES="${voice}" \
  --env MAX_TEXT_CHARS=500 \
  --env SYNTH_QUEUE_CAPACITY=1 \
  --env SYNTH_TIMEOUT_SECONDS=0.001 \
  --env TTS_HOME=/home/readit/.local/share/tts \
  --env XDG_DATA_HOME=/home/readit/.local/share \
  --volume "${model_volume}:/home/readit/.local/share/tts" \
  "${image_id}" >"${ARTIFACT_DIR}/timeout-container-id.txt"
wait_for_ready "${TIMEOUT_BASE_URL}" "${ARTIFACT_DIR}/timeout-ready.json" || fail "timeout probe container did not become ready"
timeout_status="$(curl --silent --output "${ARTIFACT_DIR}/timeout.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' --data-binary "@${ARTIFACT_DIR}/queue-request.json" "${TIMEOUT_BASE_URL}/api/tts")"
[[ "${timeout_status}" == "504" ]] || fail "timeout probe returned HTTP ${timeout_status}, expected 504"
python - "${ARTIFACT_DIR}/timeout.json" <<'PY'
import json
import sys
from pathlib import Path
payload = json.loads(Path(sys.argv[1]).read_text())
if payload.get("error", {}).get("code") != "SYNTHESIS_TIMEOUT":
    raise SystemExit("timeout response did not use SYNTHESIS_TIMEOUT")
PY
timeout_ready_status="$(curl --silent --output "${ARTIFACT_DIR}/timeout-ready-saturated.json" --write-out '%{http_code}' "${TIMEOUT_BASE_URL}/api/ready")"
[[ "${timeout_ready_status}" == "503" ]] || fail "timeout probe released capacity before inference completed"
docker exec "${TIMEOUT_CONTAINER}" sh -c \
  "find /tmp -maxdepth 1 -type f -name 'chrome-readit-*.wav' -print | sort" \
  >"${ARTIFACT_DIR}/temp-files-after-timeout-response.txt"
[[ -s "${ARTIFACT_DIR}/temp-files-after-timeout-response.txt" ]] || fail "timed-out work was not retained while inference continued"
wait_for_ready "${TIMEOUT_BASE_URL}" "${ARTIFACT_DIR}/timeout-ready-recovered.json" || fail "timeout probe did not recover capacity"
docker exec "${TIMEOUT_CONTAINER}" sh -c \
  "find /tmp -maxdepth 1 -type f -name 'chrome-readit-*.wav' -print | sort" \
  >"${ARTIFACT_DIR}/temp-files-after-timeout-completion.txt"
[[ ! -s "${ARTIFACT_DIR}/temp-files-after-timeout-completion.txt" ]] || fail "timed-out work left a temporary WAV after completion"
docker logs "${TIMEOUT_CONTAINER}" >"${ARTIFACT_DIR}/timeout-container.log" 2>&1
timeout_stop=$SECONDS
docker stop --time 10 "${TIMEOUT_CONTAINER}" >/dev/null
printf '%s\n' "$((SECONDS - timeout_stop))" >"${ARTIFACT_DIR}/timeout-stop-duration-seconds.txt"
(( SECONDS - timeout_stop <= 15 )) || fail "timeout probe shutdown exceeded 15 seconds"
docker rm "${TIMEOUT_CONTAINER}" >/dev/null

container_id="$(dc ps -q coqui-local)"
list_temp_files "${container_id}" "${ARTIFACT_DIR}/temp-files-before-final-shutdown.txt"
[[ ! -s "${ARTIFACT_DIR}/temp-files-before-final-shutdown.txt" ]] || fail "tracked temporary WAVs remained before final shutdown"
capture_runtime_evidence
printf 'Real Coqui validation passed. Evidence: %s\n' "${ARTIFACT_DIR}"
