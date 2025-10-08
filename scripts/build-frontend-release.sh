#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$PROJECT_ROOT"

RELEASE_ID="${1:-$(date +%Y%m%d%H%M%S)}"

mkdir -p releases

echo "[frontend-build] Building release ${RELEASE_ID}"
DEFAULT_VITE_API_BASE="https://api.drifellascape.art"
VITE_API_BASE=${VITE_API_BASE:-$DEFAULT_VITE_API_BASE}

docker compose run --rm \
    -e RELEASE_ID="$RELEASE_ID" \
    -e VITE_API_BASE="$VITE_API_BASE" \
    frontend-build

ln -sfn "$RELEASE_ID" releases/current

echo "\nFrontend release ${RELEASE_ID} staged."
echo "Symlink updated: releases/current -> ${RELEASE_ID}"
echo "Run 'docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile' to activate."
