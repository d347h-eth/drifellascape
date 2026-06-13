# Drifellascape

A fast, reliable explorer for a single NFT collection (Drifella III). It keeps a local, versioned snapshot of live marketplace listings, serves data from memory, and offers a crisp, pixel‑perfect fullscreen viewer for original artwork.

## Features

- Slow & steady sync worker (rate‑limited; resilient), append‑only snapshots with atomic activation
- Market event indexing for listing and sale feeds from Magic Eden collection activities
- Optional Helius ownership snapshots for owner-address token filtering
- Normalized SQLite schema (WAL); concurrent reads while syncing
- Backend API with an in‑memory listings cache plus DB‑side search for listings/tokens
- Frontend (Svelte) with:
  - Grid (default homepage): 3 columns, infinite scroll up/down (user‑interaction armed)
  - Gallery (horizontal): near‑edge paging recenters around current mint (no jumps)
  - Fullscreen hard‑pixel exploration with rich hotkeys

## Repo Layout

- `worker/` — periodic sync from marketplace → SQLite snapshot
- `backend/` — Node HTTP server with in‑memory snapshot cache
- `frontend/` — Vite + Svelte app (grid + gallery + exploration)
- `scripts/` — grouped utilities (`dev/`, `assets/`, `traits/`, `release/`)
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

Prepare local env:

```bash
cp .env.example .env
# Optional: set HELIUS_KEY=... to enable ownership sync
```

Run the full local stack:

```bash
yarn dev
```

This starts the backend, worker, and frontend. The backend/worker scripts and the full dev script load root `.env` as local defaults when present; already-set env vars still take precedence. Logs are written to `tmp/logs/backend.log`, `tmp/logs/worker.log`, and `tmp/logs/frontend.log`.

Run backend API only (port 3000):

```bash
yarn backend:run
# Optional envs:
#   BACKEND_PORT=4000 BACKEND_REFRESH_MS=10000 yarn backend:run
```

Run worker (infinite loop, default 30s interval):

```bash
yarn worker:run
# Optional env:
#   WORKER_SYNC_INTERVAL_MS=60000 yarn worker:run
#   HELIUS_KEY=... yarn worker:run
```

Run frontend (dev server on port 5173):

```bash
yarn workspace @drifellascape/frontend dev
# Optional env:
#   VITE_API_BASE=http://localhost:3000 VITE_POLL_MS=15000 yarn workspace @drifellascape/frontend dev
```

Open http://localhost:5173. In dev, Vite proxies same‑origin `/listings*`, `/tokens*`, and `/traits*` requests to the backend on port 3000 unless `VITE_API_BASE` is set.

Hotkeys (subset)

- Toggle data source (Listings/Tokens): `T`
- Enter Grid: `G` or `Esc` (from Gallery)
- Refocus last anchored token in Grid: `F`
- Enter Explore: `W`
- Toggle Explore debug overlay: `O`
- Focus token search: `E`

Deep‑links

- `?token=NUM` (0–1332) opens Gallery centered on that token (Tokens mode). The param updates as you browse in Gallery and is removed when you enter Grid.

## Static Assets (Images)

- High‑resolution and grid images live outside the bundle under `frontend/static/art/2560/` and `frontend/static/art/540h/` (git‑ignored).
- The current Gallery/Grid components request `https://app.drifellascape.art/static/art/{2560,540h}/{mint}.jpg`.
- In production, `docker-compose.yml` mounts `frontend/static` into Caddy and the Caddyfile serves `/static/*` using `handle_path`, so `/static/art/...` maps to `/srv/static/art/...` on disk.
- The resize helper is cwd‑relative: `yarn tsx scripts/assets/resize-images.ts width|height|meta` reads `static/full` and writes `static/{2560,540h,meta}` from the directory where it is run. Move or sync generated assets into `frontend/static/art/...` for the current Caddy mount.

## Deployment (VPS Workflow)

The VPS setup builds the frontend once per release and serves the static output directly from Caddy. Backend and worker services continue to run from source.

1. Pull the latest code: `git pull`
2. Build a new frontend release:
   ```bash
   ./scripts/release/build-frontend-release.sh
   # optional custom ID: ./scripts/release/build-frontend-release.sh 20241021-frontend
   ```
   The script runs `docker compose run --rm frontend-build` and stages the build under `releases/<release-id>`, updating the `releases/current` symlink.
   By default the build sets `VITE_API_BASE=https://api.drifellascape.art` and `VITE_POLL_MS=30000`; set either in `.env` or export them before running the script to override.
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

- Tokens/traits are normalized via `scripts/traits/ingest-traits.ts` using `logs/mint_to_image.csv` and `metadata/`.
- Duplicate images are expected — the script assigns `image_url → [mints...]` in FIFO order so all 1,333 mints are inserted (uniqueness enforced on `token_mint_addr` and `token_num`, not `image_url`).
- Trait grouping maintenance: `yarn tsx scripts/traits/update-trait-types.ts` reads `logs/trait_groups.csv`.

## Tests

- Worker unit tests (Vitest):

```bash
yarn vitest run
```

- Frontend e2e tests (Playwright):

```bash
yarn workspace @drifellascape/frontend test:e2e
```

## Documentation

- Product overview: `docs/01-product-overview.md`
- Sync worker: `docs/02-sync-worker.md`
- Backend API: `docs/03-backend-api.md`
- Frontend: `docs/04-frontend.md`
- Gallery infinite scroll: `docs/gallery-infinite-scroll.md`

## License

AGPL‑3.0‑only. See `LICENSE`.
