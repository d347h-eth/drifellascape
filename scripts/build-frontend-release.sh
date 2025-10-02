#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$PROJECT_ROOT"

RELEASE_ID="${1:-$(date +%Y%m%d%H%M%S)}"

mkdir -p releases

echo "[frontend-build] Building release ${RELEASE_ID}"
docker compose run --rm -e RELEASE_ID="$RELEASE_ID" frontend-build

ln -sfn "$RELEASE_ID" releases/current

echo "\nFrontend release ${RELEASE_ID} staged."
echo "Symlink updated: releases/current -> ${RELEASE_ID}"
echo "Run 'docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile' to activate."
