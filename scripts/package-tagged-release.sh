#!/usr/bin/env bash
set -euo pipefail

tag="${1:-${GITHUB_REF_NAME:-}}"
output_argument="${2:-release}"

if [[ -z "${tag}" ]]; then
  echo "A release tag is required." >&2
  exit 1
fi

if [[ ! "${tag}" =~ ^v[0-9]+(\.[0-9]+){2,3}$ ]]; then
  echo "Release tag '${tag}' must use vMAJOR.MINOR.PATCH or vMAJOR.MINOR.PATCH.BUILD." >&2
  exit 1
fi

if [[ ! -f dist/manifest.json ]]; then
  echo "dist/manifest.json is missing. Run npm run build first." >&2
  exit 1
fi

if [[ ! -f docker/docker-compose.yml || ! -d docker/coqui-local ]]; then
  echo "The Docker release inputs are missing." >&2
  exit 1
fi

manifest_version="$(node -e "const fs=require('fs'); const manifest=JSON.parse(fs.readFileSync('dist/manifest.json','utf8')); if(typeof manifest.version!=='string'||!manifest.version){process.exit(2)}; process.stdout.write(manifest.version)")"
expected_tag="v${manifest_version}"
if [[ "${tag}" != "${expected_tag}" ]]; then
  echo "Release tag '${tag}' does not match extension manifest version '${manifest_version}'." >&2
  exit 1
fi

mkdir -p "${output_argument}"
output_dir="$(cd "${output_argument}" && pwd)"
rm -f "${output_dir}"/*

extension_archive="chrome-readit-${tag}-extension.zip"
docker_archive="chrome-readit-${tag}-coqui-source.tar.gz"
compose_asset="chrome-readit-${tag}-docker-compose.yml"

(
  cd dist
  zip -q -r "${output_dir}/${extension_archive}" .
)

tar -czf "${output_dir}/${docker_archive}" \
  docker/docker-compose.yml \
  docker/coqui-local

cp docker/docker-compose.yml "${output_dir}/${compose_asset}"

(
  cd "${output_dir}"
  sha256sum \
    "${extension_archive}" \
    "${docker_archive}" \
    "${compose_asset}" \
    > SHA256SUMS
)

printf 'Created release assets in %s\n' "${output_dir}"
printf '  %s\n' \
  "${extension_archive}" \
  "${docker_archive}" \
  "${compose_asset}" \
  "SHA256SUMS"
