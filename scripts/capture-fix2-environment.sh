#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

OUTPUT="${1:-reports/fix2-environment.txt}"
mkdir -p "$(dirname "${OUTPUT}")"

{
  echo "captured_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "git_sha=$(git rev-parse HEAD 2>/dev/null || echo unavailable)"
  echo "platform=$(uname -a)"
  echo "node=$(node --version 2>/dev/null || echo unavailable)"
  echo "npm=$(npm --version 2>/dev/null || echo unavailable)"
  echo "python=$(python --version 2>&1 || echo unavailable)"
  echo "docker=$(docker --version 2>/dev/null || echo unavailable)"
  echo "docker_compose=$(docker compose version 2>/dev/null || echo unavailable)"
  echo "chrome=${CHROME_PATH:-${CHROMIUM_PATH:-unconfigured}}"
  if [[ -n "${CHROME_PATH:-${CHROMIUM_PATH:-}}" ]]; then
    "${CHROME_PATH:-${CHROMIUM_PATH}}" --version 2>/dev/null || true
  fi
} | tee "${OUTPUT}"
