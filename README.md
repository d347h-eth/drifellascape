# Drifellascape

A fast, reliable explorer for a single NFT collection (Drifella III). It keeps a local, versioned snapshot of live marketplace listings, serves data from memory, and offers a crisp, pixel‑perfect fullscreen viewer for original artwork.

## Features

- Slow & steady sync worker (rate‑limited; resilient), append‑only snapshots with atomic activation
- Normalized SQLite schema (WAL); concurrent reads while syncing
- Backend API with in‑memory cache for low‑latency reads
- Frontend (Svelte) with:
  - Grid (default homepage): 3 columns, infinite scroll up/down (user‑interaction armed)
  - Gallery (horizontal): near‑edge paging recenters around current mint (no jumps)
  - Fullscreen hard‑pixel exploration with rich hotkeys

## Repo Layout

- `worker/` — periodic sync from marketplace → SQLite snapshot
- `backend/` — Node HTTP server with in‑memory snapshot cache
- `frontend/` — Vite + Svelte app (grid + gallery + exploration)
- `scripts/` — utilities (e.g., `count-mints-images.ts`, `ingest-traits.ts`)
- `database/` — SQLite integration, pragmas, migrations
- `docs/` — product & technical docs (start with `docs/01-product-overview.md`)

## Requirements

- Node.js ≥ 24 (nvm recommended)
- Yarn Berry (PnP). The repo is configured; simply run `yarn install`.

## Quick Start

Install deps:

```bash
yarn install
```

Run backend API (port 3000):

```bash
yarn backend:run
# Optional envs:
#   DRIFELLASCAPE_PORT=4000 DRIFELLASCAPE_BACKEND_REFRESH_MS=10000 yarn backend:run
```

Run worker (infinite loop, default 30s interval):

```bash
yarn worker:run
# Optional env:
#   DRIFELLASCAPE_SYNC_INTERVAL_MS=60000 yarn worker:run
```

Run frontend (dev server on port 5173):

```bash
yarn workspace @drifellascape/frontend dev
# Optional env:
#   VITE_API_BASE=http://localhost:3000 VITE_POLL_MS=15000 yarn workspace @drifellascape/frontend dev
```

Open http://localhost:5173 — the app will fetch from the backend by default.

Hotkeys (subset)

- Toggle data source (Listings/Tokens): `T`
- Enter Grid: `G` or `Esc` (from Gallery)
- Refocus last anchored token in Grid: `F`
- Enter Explore: `W`
- Toggle Explore debug overlay: `O`

## Static Assets (Images)

- High‑resolution images live outside the build under `frontend/static/art/2560/` and `frontend/static/art/540h/` (git‑ignored).
- The app requests them under `/static/art/2560/...` and `/static/art/540h/...`.
- For local development, symlink the `static` folder into `frontend/public` so Vite can serve them:
  ```bash
  ln -s ../static frontend/public/static
  # verifies: ls frontend/public/static/art/2560
  ```
- In production, `docker-compose.yml` mounts `frontend/static` into the Caddy container and the Caddyfile serves `/static/*` using `handle_path`, so requests for `/static/art/...` map to `/srv/static/art/...` on disk.

## Deployment (VPS Workflow)

The VPS setup builds the frontend once per release and serves the static output directly from Caddy. Backend and worker services continue to run from source.

1. Pull the latest code: `git pull`
2. Build a new frontend release:
   ```bash
   ./scripts/build-frontend-release.sh
   # optional custom ID: ./scripts/build-frontend-release.sh 20241021-frontend
   ```
   The script runs `docker compose run --rm frontend-build` and stages the build under `releases/<release-id>`, updating the `releases/current` symlink.
3. Reload Caddy to swap the live assets:
   ```bash
   docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
   ```
4. (Optional) Roll back by re-pointing the symlink: `ln -sfn <previous-id> releases/current` followed by another Caddy reload.

Backend/worker containers still use `docker compose up -d` as before; only the frontend now deploys with a quick, no-downtime swap of static files.
If you still have the legacy `frontend` container running, clean it up once with `docker compose up -d --remove-orphans`.

## Database

- SQLite file is stored under:
  - `database/drifellascape.db/sqlite.db`
- Inspect with DB Browser for SQLite / SQLiteStudio, or the `sqlite3` CLI.

Traits & ingestion

- Tokens/traits are normalized via `scripts/ingest-traits.ts` using `logs/mint_to_image.csv` and `metadata/`.
- Duplicate images are expected — the script assigns `image_url → [mints...]` in FIFO order so all 1,333 mints are inserted (uniqueness enforced on `token_mint_addr` and `token_num`, not `image_url`).
- Utility: `yarn tsx scripts/count-mints-images.ts` prints unique mint/image counts from the CSV.

## Tests

- Worker unit tests (Vitest):

```bash
yarn vitest run
```

## Documentation

- Product overview: `docs/01-product-overview.md`
- Sync worker: `docs/02-sync-worker.md`
- Backend API: `docs/03-backend-api.md`
- Frontend: `docs/04-frontend.md`
- Gallery infinite scroll: `docs/gallery-infinite-scroll.md`

## License

AGPL‑3.0‑only. See `LICENSE`.
