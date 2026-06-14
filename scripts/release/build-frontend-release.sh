#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "$PROJECT_ROOT"

RELEASE_ID="${1:-$(date +%Y%m%d%H%M%S)}"

mkdir -p releases

# shellcheck disable=SC1091
source "${PROJECT_ROOT}/scripts/dev/load-env.sh"
load_project_env .env

echo "[frontend-build] Building release ${RELEASE_ID}"
DEFAULT_VITE_API_BASE="https://api.drifellascape.art"
VITE_API_BASE=${VITE_API_BASE:-$DEFAULT_VITE_API_BASE}
VITE_POLL_MS=${VITE_POLL_MS:-30000}

docker compose run --rm \
    -e RELEASE_ID="$RELEASE_ID" \
    -e VITE_API_BASE="$VITE_API_BASE" \
    -e VITE_POLL_MS="$VITE_POLL_MS" \
    frontend-build

ln -sfn "$RELEASE_ID" releases/current

printf "\nFrontend release %s staged.\n" "$RELEASE_ID"
echo "Symlink updated: releases/current -> ${RELEASE_ID}"
echo "Reload central Caddy from its compose directory to activate:"
echo "  docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile"
