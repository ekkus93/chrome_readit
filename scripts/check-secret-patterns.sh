#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

history_file="$(mktemp)"
trap 'rm -f "${history_file}"' EXIT

git log --all --format=fuller --patch --no-ext-diff --binary >"${history_file}"

failures=0

check_pattern() {
  local name="$1"
  local pattern="$2"
  if grep -Eaq -- "${pattern}" "${history_file}"; then
    printf 'Secret scan failure: %s-like material exists in Git history.\n' "${name}" >&2
    failures=$((failures + 1))
  fi
}

check_pattern 'AWS access key ID' 'AKIA[0-9A-Z]{16}'
check_pattern 'GitHub token' 'gh[pousr]_[A-Za-z0-9]{36,255}'
check_pattern 'OpenAI-style secret' 'sk-[A-Za-z0-9_-]{32,255}'
check_pattern 'Slack token' 'xox[baprs]-[A-Za-z0-9-]{20,255}'
check_pattern 'Google API key' 'AIza[0-9A-Za-z_-]{35}'
check_pattern 'private key' '-----BEGIN ([A-Z0-9 ]+ )?PRIVATE KEY-----'

tracked_sensitive="$(git ls-files | grep -E '(^|/)(\.env($|\.)|[^/]+\.(pem|p12|pfx|key))$' || true)"
if [[ -n "${tracked_sensitive}" ]]; then
  printf 'Secret scan failure: sensitive-looking files are tracked.\n' >&2
  failures=$((failures + 1))
fi

if (( failures > 0 )); then
  exit 1
fi

printf 'Secret-pattern scan passed without disclosing matched content.\n'
