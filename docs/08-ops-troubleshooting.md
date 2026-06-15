# Ops & Troubleshooting

This guide lists common operations, checks, and troubleshooting steps for Drifellascape.

## Processes & Ports

- Full local dev stack: `yarn dev` (writes `tmp/logs/{backend,worker,frontend}.log`)
- Backend API: `yarn backend:run` (default port 42800)
- Worker loop: `yarn worker:run` (default interval 30s)
- Frontend dev: `yarn workspace @drifellascape/frontend dev` (port 42820)
- Backend metrics: `/metrics` and `/healthz` on `127.0.0.1:42840` by default when enabled
- Worker metrics: `/metrics` and `/healthz` on `127.0.0.1:42841` by default when enabled
- Local observability: `yarn observability:up` (Grafana on `127.0.0.1:42835`)
- Production Compose: `docker compose --env-file .env.deploy -f docker-compose.deploy.yml up -d backend worker` after ensuring the external `public-edge` Docker network exists. The repo-local Caddy is opt-in via `--profile local-caddy`; `caddy-verify` remains opt-in via `--profile verify`.

## Logs

- Local dev supervisor: JSON Lines in `tmp/logs/backend.log` and `tmp/logs/worker.log`; Vite output in `tmp/logs/frontend.log`
- Worker: fetch attempts, retry scheduling, skip counts, new version summaries, market-event summaries, ownership summaries, and failures are structured with `component`/`action` fields.
- Deploy: Alloy discovers containers labeled `com.drifellascape.observability.logs=true` and ships JSON logs to Loki.
- Backend: structured stdout/stderr for server lifecycle and errors.

## Database

- File: `database/drifellascape.db/sqlite.db` (WAL mode)
- Inspect:
  - Active version: `SELECT id FROM listing_versions WHERE active=1;`
  - Count rows: `SELECT COUNT(*) FROM listings_current WHERE version_id=(SELECT id FROM listing_versions WHERE active=1);`
- Backups: copy DB + WAL files together; do during low‑activity windows

## Common Issues

### 1) HTTP 429 / 5xx from Marketplace

- Symptoms: worker log shows retries; run aborts for that cycle
- Action: verify rate limiter env/logic; allow worker to retry next interval; investigate sustained outages

### 2) No-op Syncs

- Symptoms: no new version for many cycles
- Action: verify epsilon logic and listings actually changing; confirm staging/diff queries are correct

### 3) Backend Serving Old Data

- Symptoms: frontend versionId doesn’t change after confirmed worker flip
- Action: check backend refresh interval `BACKEND_REFRESH_MS`; verify backend process restarted; inspect DB active version id

### 4) DB Locked Errors

- Symptoms: busy/locked exceptions
- Action: WAL + busy_timeout are enabled; ensure only one writer (single worker) and keep write txns short (as designed)

### 5) Frontend Viewport Jumps

- Symptoms: listings reorder while scrolling
- Action: staged updates are designed to apply only when at top; confirm `VITE_POLL_MS` and logic are intact

### 6) Exploration Mode Artifacts

- Symptoms: flicker when next/prev; blur at non‑1:1 zoom; region‑fit clipping
- Action: overlay opacity swap + hard‑pixel CSS are in place; fractional zoom enabled; region zoom uses a tiny epsilon; verify debug overlay alignment (`O` key)

## Environment Variables

- Copy `.env.example` to `.env` for local dev and Docker Compose. `yarn backend:run`, `yarn worker:run`, and `yarn dev` load root `.env` as local defaults; already-set env vars still take precedence. Compose passes the same values into backend, worker, and frontend-build containers with defaults.
- Worker: `WORKER_SYNC_INTERVAL_MS` (default 30000, min 5000)
- Backend: `BACKEND_REFRESH_MS` (default 30000, min 5000), `BACKEND_PORT`, `BACKEND_DEBUG`
- Frontend: `VITE_API_BASE`, `VITE_POLL_MS` (default 30000, min 5000 at runtime)
- Market events: `MARKET_EVENT_RECENT_PAGES` (default 2), `MARKET_EVENT_BACKFILL_PAGES` (default 5)
- Ownership: `HELIUS_KEY`; `OWNERSHIP_SYNC_INTERVAL_MS` (default 600000, min 60000)
- Metrics: `BACKEND_METRICS_ENABLED`, `BACKEND_METRICS_HOST`, `BACKEND_METRICS_PORT`, `WORKER_METRICS_ENABLED`, `WORKER_METRICS_HOST`, `WORKER_METRICS_PORT`
- HTTP resilience: `COMMON_HTTP_FETCH_TIMEOUT_MS`, `COMMON_HTTP_FETCH_RETRY_MAX_ATTEMPTS`, `COMMON_HTTP_FETCH_RETRY_BASE_DELAY_MS`, `COMMON_HTTP_FETCH_RETRY_MAX_DELAY_MS`
- Deploy observability: `OBSERVABILITY_GRAFANA_HOST_BIND_IP` (example: `10.77.0.1`), `OBSERVABILITY_GRAFANA_HOST_BIND_PORT`, `OBSERVABILITY_GRAFANA_ADMIN_USER`, `OBSERVABILITY_GRAFANA_ADMIN_PASSWORD`

## Run Sequences

- Dev minimal: `yarn dev`; open http://localhost:42820
- Local observability:
  ```bash
  yarn observability:up
  # Grafana: http://127.0.0.1:42835
  ```
- Production: create/verify the external `public-edge` network, run worker as a single service, run backend on both the project network and `public-edge` as `drifella-backend:42800`, and serve frontend static files through the central Caddy stack.
  ```bash
  docker network inspect public-edge >/dev/null 2>&1 || docker network create public-edge
  cp .env.deploy.example .env.deploy
  docker compose --env-file .env.deploy -f docker-compose.deploy.yml up -d backend worker
  ```
- Production observability:
  ```bash
  docker compose --env-file .env.deploy -f docker-compose.deploy.yml --profile observability up -d backend worker loki tempo pyroscope alloy prometheus grafana
  ```
  Grafana is not attached to `public-edge`; it is published only on `${OBSERVABILITY_GRAFANA_HOST_BIND_IP}:${OBSERVABILITY_GRAFANA_HOST_BIND_PORT}`. The example uses `10.77.0.1:42835` for WireGuard-only access.
- Sync static previews to a new host:
  ```bash
  rsync -avh --progress frontend/static/ $REMOTE:$APP_DIR/frontend/static/
  ```

### 7) 405 on `/listings/search` after switching to same-origin static serving

- Symptoms: `405 Method Not Allowed` from `/listings/search`.
- Action: The current release script sets `VITE_API_BASE=https://api.drifellascape.art`, and the central Caddy stack proxies `api.drifellascape.art` to `drifella-backend:42800` over `public-edge`. If you intentionally build same-origin API calls instead, ensure that app-domain Caddy routes `/listings*`, `/tokens*`, `/traits*`, `/market*`, and `/owners*` to the backend (no path rewrite), e.g.:
  ```
  route {
    handle /listings* { reverse_proxy drifella-backend:42800 }
    handle /tokens* { reverse_proxy drifella-backend:42800 }
    handle /traits* { reverse_proxy drifella-backend:42800 }
    handle /market* { reverse_proxy drifella-backend:42800 }
    handle /owners* { reverse_proxy drifella-backend:42800 }
    handle /static/* { root * /srv/static; file_server }
    handle { root * /srv/releases/current; try_files {path} {path}/ /index.html; file_server }
  }
  ```

### 8) 404 on images under `/static/art/...`

- Symptoms: 404 for `/static/art/2560/{mint}.jpg` or `/static/art/540h/{mint}.jpg`.
- Action: Verify the central Caddy mount path matches the URL: project `frontend/static/art/...` → central Caddy static root → `/static/art/...`. The repo-local Caddy profiles use `frontend/static` mounted at `/srv/static` for local/example verification.

### 9) Side‑by‑side verification without touching prod

- Start a temporary repo-local Caddy on `:42888` using the `caddy-verify` compose profile (serves `releases/current` and `/static/*`).
- Test routes and static assets; tear down when done. This keeps the live Caddy untouched.

### 10) Market feed is empty or stale

- Symptoms: `GET /market/events` returns no rows or old rows.
- Action: Check `tmp/logs/worker.log` locally, or Loki in deploy, for `component=WorkerLoop action=market_events_synced` / `market_events_failed`. Inspect `market_event_sync_state` for `backfill_offset` and `backfill_complete`. If recent pages fail, confirm Magic Eden activities requests are not returning 429/5xx.

### 11) Owner filter is empty

- Symptoms: searching an owner address returns no Grid rows.
- Action: Check whether `HELIUS_KEY` is configured. Then inspect `tmp/logs/worker.log` locally, or Loki in deploy, for `component=WorkerLoop action=ownership_*` entries and `ownership_sync_state.last_success_at`. If listings are present, listed tokens should use the listing seller as the effective owner.
