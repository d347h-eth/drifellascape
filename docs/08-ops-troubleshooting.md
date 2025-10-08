# Ops & Troubleshooting

This guide lists common operations, checks, and troubleshooting steps for Drifellascape.

## Processes & Ports

- Backend API: `yarn backend:run` (default port 3000)
- Worker loop: `yarn worker:run` (default interval 30s)
- Frontend dev: `yarn workspace @drifellascape/frontend dev` (port 5173)

## Logs

- Worker: `logs/worker.log` — fetch attempts, skip counts, new version summaries or failures
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
- Action: check backend refresh interval `DRIFELLASCAPE_BACKEND_REFRESH_MS`; verify backend process restarted; inspect DB active version id

### 4) DB Locked Errors

- Symptoms: busy/locked exceptions
- Action: WAL + busy_timeout are enabled; ensure only one writer (single worker) and keep write txns short (as designed)

### 5) Frontend Viewport Jumps

- Symptoms: listings reorder while scrolling
- Action: staged updates are designed to apply only when at top; confirm `VITE_POLL_MS` and logic are intact

### 6) Exploration Mode Artifacts

- Symptoms: flicker when next/prev; blur at non‑1:1 zoom; region‑fit clipping
- Action: overlay opacity swap + hard‑pixel CSS are in place; fractional zoom enabled; region zoom uses a tiny epsilon; verify debug overlay alignment (`G` key)

## Environment Variables

- Worker: `DRIFELLASCAPE_SYNC_INTERVAL_MS`
- Backend: `DRIFELLASCAPE_BACKEND_REFRESH_MS`, `DRIFELLASCAPE_PORT`
- Frontend: `VITE_API_BASE`, `VITE_POLL_MS`

## Run Sequences

- Dev minimal: backend → worker → frontend; open http://localhost:5173
- Production: run worker as a service (single instance), backend as a simple Node service behind a reverse proxy, frontend static hosting
- Sync static previews to a new host:
  ```bash
  rsync -avh --progress frontend/static/ $REMOTE:$APP_DIR/frontend/static/
  ```

### 7) 405 on `/listings/search` after switching to static serving

- Symptoms: `405 Method Not Allowed` from `/listings/search`.
- Action: Ensure Caddy routes `/listings*` and `/tokens*` to the backend (no path rewrite), e.g.:
  ```
  route {
    handle /listings* { reverse_proxy backend:3000 }
    handle /tokens* { reverse_proxy backend:3000 }
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
