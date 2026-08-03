#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

failures=0

fail_match() {
  local label="$1"
  shift
  printf 'FIX2 hygiene failure: %s\n' "${label}" >&2
  "$@" >&2 || true
  failures=$((failures + 1))
}

production_ts_files=()
while IFS= read -r file; do
  production_ts_files+=("${file}")
done < <(find src -type f \( -name '*.ts' -o -name '*.tsx' \) ! -name '*.test.ts' ! -name '*.test.tsx' -print | sort)

if grep -RInE --include='*.ts' --include='*.tsx' \
  --exclude='*.test.ts' --exclude='*.test.tsx' \
  'SPEECH_STATUS|PAUSE_SPEECH|RESUME_SPEECH|CANCEL_SPEECH|LegacyPlaybackControlRequest' src \
  >/tmp/chrome-readit-legacy-protocol.txt; then
  fail_match 'the obsolete playback message protocol remains active' cat /tmp/chrome-readit-legacy-protocol.txt
fi

if grep -RInE --include='*.ts' --include='*.tsx' \
  --exclude='*.test.ts' --exclude='*.test.tsx' \
  'new[[:space:]]+Audio[[:space:]]*\(' src \
  | grep -v '^src/offscreen/playback-coordinator.ts:' >/tmp/chrome-readit-extra-audio.txt; then
  fail_match 'production Audio construction exists outside the coordinator' cat /tmp/chrome-readit-extra-audio.txt
fi

if grep -RInE --include='*.ts' --include='*.tsx' \
  --exclude='*.test.ts' --exclude='*.test.tsx' \
  'AudioContext|AudioBufferSourceNode|speechSynthesis|SpeechSynthesisUtterance' src \
  >/tmp/chrome-readit-fallback-player.txt; then
  fail_match 'an unapproved fallback player exists' cat /tmp/chrome-readit-fallback-player.txt
fi

if grep -RInE --include='*.ts' --include='*.tsx' \
  --exclude='*.test.ts' --exclude='*.test.tsx' \
  'catch[[:space:]]*\{[[:space:]]*return[[:space:]]+\[\]' src \
  >/tmp/chrome-readit-empty-list-fallback.txt; then
  fail_match 'a catch-all converts failure into an empty list' cat /tmp/chrome-readit-empty-list-fallback.txt
fi

if grep -RInE --include='*.ts' --include='*.tsx' \
  --exclude='*.test.ts' --exclude='*.test.tsx' \
  '\.catch\([[:space:]]*\(\)[[:space:]]*=>[[:space:]]*(undefined|null|false|true)[[:space:]]*\)' src \
  >/tmp/chrome-readit-silent-promise.txt; then
  fail_match 'a promise failure is converted into a silent sentinel' cat /tmp/chrome-readit-silent-promise.txt
fi

if grep -RInE --include='*.tsx' \
  'sendMessage\([^\n]+,[[:space:]]*\(\)[[:space:]]*=>[[:space:]]*\{?[[:space:]]*\}?[[:space:]]*\)' \
  src/popup src/options >/tmp/chrome-readit-empty-callback.txt; then
  fail_match 'popup or Options ignores a runtime response with an empty callback' cat /tmp/chrome-readit-empty-callback.txt
fi

if grep -RIn -- '--legacy-peer-deps' package.json package-lock.json .github scripts 2>/dev/null \
  >/tmp/chrome-readit-legacy-peer.txt; then
  fail_match 'the dependency-resolution bypass remains in active configuration' cat /tmp/chrome-readit-legacy-peer.txt
fi

if grep -RInE --include='*.ts' --include='*.tsx' \
  --exclude='*.test.ts' --exclude='*.test.tsx' \
  "fetch\([^\n]*api/tts/play|ttsUrl[^\n]*api/tts/play" src \
  >/tmp/chrome-readit-host-play.txt; then
  fail_match 'production code invokes the obsolete host-play endpoint' cat /tmp/chrome-readit-host-play.txt
fi

if grep -RInE --include='*.py' \
  'subprocess\.(run|Popen|call|check_call|check_output).*\b(aplay|paplay|ffplay|mpv|vlc)\b' \
  docker >/tmp/chrome-readit-host-audio.txt; then
  fail_match 'Docker code launches host audio playback' cat /tmp/chrome-readit-host-audio.txt
fi

if grep -RInE --include='*.yml' --include='*.yaml' \
  'uses:[[:space:]]+[^@[:space:]]+@(main|master|v[0-9]+)([[:space:]]|$)' .github/workflows \
  >/tmp/chrome-readit-mutable-actions.txt; then
  fail_match 'a GitHub Action uses a mutable branch or major tag' cat /tmp/chrome-readit-mutable-actions.txt
fi

rm -f \
  /tmp/chrome-readit-legacy-protocol.txt \
  /tmp/chrome-readit-extra-audio.txt \
  /tmp/chrome-readit-fallback-player.txt \
  /tmp/chrome-readit-empty-list-fallback.txt \
  /tmp/chrome-readit-silent-promise.txt \
  /tmp/chrome-readit-empty-callback.txt \
  /tmp/chrome-readit-legacy-peer.txt \
  /tmp/chrome-readit-host-play.txt \
  /tmp/chrome-readit-host-audio.txt \
  /tmp/chrome-readit-mutable-actions.txt

if (( failures > 0 )); then
  printf '%d FIX2 hygiene check(s) failed.\n' "${failures}" >&2
  exit 1
fi

printf 'FIX2 hygiene checks passed across %d production TypeScript files.\n' "${#production_ts_files[@]}"
