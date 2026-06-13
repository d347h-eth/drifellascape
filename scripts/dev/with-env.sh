#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "$PROJECT_ROOT"

# shellcheck disable=SC1091
source "${PROJECT_ROOT}/scripts/dev/load-env.sh"
load_project_env .env

exec "$@"
