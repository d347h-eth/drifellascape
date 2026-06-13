# Ops & Troubleshooting

This guide lists common operations, checks, and troubleshooting steps for Drifellascape.

## Processes & Ports

- Full local dev stack: `yarn dev` (writes `tmp/logs/{backend,worker,frontend}.log`)
- Backend API: `yarn backend:run` (default port 3000)
- Worker loop: `yarn worker:run` (default interval 30s)
- Frontend dev: `yarn workspace @drifellascape/frontend dev` (port 5173)

## Logs

- Local dev supervisor: `tmp/logs/backend.log`, `tmp/logs/worker.log`, `tmp/logs/frontend.log`
- Worker: `logs/worker.log` — fetch attempts, skip counts, new version summaries or failures
- Market events: `logs/worker.log` also records per-type pages fetched, rows inserted, skipped rows, and backfill cursor state
- Ownership: `logs/worker.log` records Helius missing-key skips once, applied/no-change summaries, and failures
- Backend: stdout/stderr (server start, errors)

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

## Run Sequences

- Dev minimal: `yarn dev`; open http://localhost:5173
- Production: run worker as a service (single instance), backend as a simple Node service behind a reverse proxy, frontend static hosting
- Sync static previews to a new host:
  ```bash
  rsync -avh --progress frontend/static/ $REMOTE:$APP_DIR/frontend/static/
  ```

### 7) 405 on `/listings/search` after switching to same-origin static serving

- Symptoms: `405 Method Not Allowed` from `/listings/search`.
- Action: The current release script sets `VITE_API_BASE=https://api.drifellascape.art`, and the live Caddyfile proxies only `api.drifellascape.art` to the backend. If you intentionally build same-origin API calls instead, ensure that app-domain Caddy routes `/listings*`, `/tokens*`, and `/traits*` to the backend (no path rewrite), e.g.:
  ```
  route {
    handle /listings* { reverse_proxy backend:3000 }
    handle /tokens* { reverse_proxy backend:3000 }
    handle /traits* { reverse_proxy backend:3000 }
    handle /market* { reverse_proxy backend:3000 }
    handle /static/* { root * /srv/static; file_server }
    handle { root * /srv/releases/current; try_files {path} {path}/ /index.html; file_server }
  }
  ```

### 8) 404 on images under `/static/art/...`

- Symptoms: 404 for `/static/art/2560/{mint}.jpg` or `/static/art/540h/{mint}.jpg`.
- Action: Verify the container mount path matches the URL: host `frontend/static/art/...` → container `/srv/static/art/...` → Caddy `handle /static/*`.

### 9) Side‑by‑side verification without touching prod

- Start a temporary Caddy on `:8080` using the `caddy-verify` compose profile (serves `releases/current` and `/static/*`).
- Test routes and static assets; tear down when done. This keeps the live Caddy untouched.

### 10) Market feed is empty or stale

- Symptoms: `GET /market/events` returns no rows or old rows.
- Action: Check `logs/worker.log` for `Market listing events` and `Market sale events` lines. Inspect `market_event_sync_state` for `backfill_offset` and `backfill_complete`. If recent pages fail, confirm Magic Eden activities requests are not returning 429/5xx.

### 11) Owner filter is empty

- Symptoms: searching an owner address returns no Grid rows.
- Action: Check whether `HELIUS_KEY` is configured. Then inspect `logs/worker.log` for `Ownership sync` lines and `ownership_sync_state.last_success_at`. If listings are present, listed tokens should use the listing seller as the effective owner.
