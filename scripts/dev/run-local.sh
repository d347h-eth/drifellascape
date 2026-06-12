#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
LOG_DIR="${PROJECT_ROOT}/tmp/logs"

mkdir -p "$LOG_DIR"
cd "$PROJECT_ROOT"

names=()
pids=()
shutting_down=0

start_process() {
    local name="$1"
    shift
    local log_file="${LOG_DIR}/${name}.log"

    : > "$log_file"
    printf '[dev] starting %-8s -> %s\n' "$name" "${log_file#"$PROJECT_ROOT"/}"
    setsid "$@" >>"$log_file" 2>&1 &
    names+=("$name")
    pids+=("$!")
}

shutdown_processes() {
    local pid
    for pid in "${pids[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
        fi
    done

    for pid in "${pids[@]}"; do
        wait "$pid" 2>/dev/null || true
    done
}

on_signal() {
    if [[ "$shutting_down" -eq 1 ]]; then
        exit 130
    fi
    shutting_down=1
    printf '\n[dev] stopping local runtimes...\n'
    shutdown_processes
    exit 130
}

trap on_signal INT TERM

start_process backend yarn backend:run
start_process worker yarn worker:run
start_process frontend yarn workspace @drifellascape/frontend dev

printf '[dev] frontend: http://localhost:5173\n'
printf '[dev] backend:  http://localhost:3000\n'
printf '[dev] logs:     tmp/logs/{backend,worker,frontend}.log\n'
printf '[dev] press Ctrl+C to stop all runtimes\n'

set +e
wait -n "${pids[@]}"
status=$?
set -e

printf '[dev] a runtime exited; stopping the rest...\n'
shutting_down=1
shutdown_processes
exit "$status"
