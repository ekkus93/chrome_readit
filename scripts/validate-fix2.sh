#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

run() {
  printf '\n==> %s\n' "$1"
  shift
  "$@"
}

run "Install exact Node dependencies" npm ci
run "Reject dangerous fallbacks and silent failures" bash scripts/check-fix2-hygiene.sh
run "Lint" npm run lint
run "Strict TypeScript" npm run typecheck
run "Extension tests and focused coverage" \
  npx vitest --run --coverage \
    --coverage.thresholds.lines=80 \
    --coverage.thresholds.functions=80 \
    --coverage.thresholds.statements=80 \
    --coverage.thresholds.branches=70
run "Production extension build" npm run build
run "Diagnostic extension build" npm run build:e2e
run "Coqui fake-backend tests" python -m pytest -q docker/coqui-local/tests
run "Compose configuration" docker compose -f docker/docker-compose.yml config

if [[ -n "${CHROME_PATH:-${CHROMIUM_PATH:-}}" ]]; then
  run "Real Chromium extension matrix" xvfb-run -a npm run test:chromium
else
  printf '\nSKIPPED: real Chromium matrix requires CHROME_PATH or CHROMIUM_PATH.\n' >&2
  printf 'This skip is not acceptable for final FIX2 sign-off.\n' >&2
fi

printf '\nAutomated FIX2 validation completed.\n'
