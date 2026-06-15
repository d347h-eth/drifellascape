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

This starts the backend, worker, and frontend. The backend/worker scripts and the full dev script load root `.env` as local defaults when present; already-set env vars still take precedence. Runtime logs are JSON Lines written to `tmp/logs/backend.log` and `tmp/logs/worker.log`; Vite output is written to `tmp/logs/frontend.log`.

Run backend API only (port 42800):

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

Run frontend (dev server on port 42820):

```bash
yarn workspace @drifellascape/frontend dev
# Optional env:
#   VITE_API_BASE=http://localhost:42800 VITE_POLL_MS=15000 yarn workspace @drifellascape/frontend dev
```

Open http://localhost:42820. In dev, Vite proxies same‑origin `/listings*`, `/tokens*`, `/traits*`, `/market*`, and `/owners*` requests to the backend on port 42800 unless `VITE_API_BASE` is set.

Hotkeys (subset)

- Toggle data source (Listings/Tokens): `T`
- Enter Grid: `G` or `Esc` (from Gallery)
- Refocus last anchored token in Grid: `F`
- Enter Explore: `W`
- Toggle Explore debug overlay: `O`
- Focus token search: `E`
- Clear owner filter: empty the owner search field and press Enter, or use `reset owner`

Deep‑links

- `?token=NUM` (0–1332) opens Gallery centered on that token (Tokens mode). The param updates as you browse in Gallery and is removed when you enter Grid.
- `?owner=ADDRESS` opens Grid filtered to that owner. Owner-filtered Gallery links preserve both params as `?owner=ADDRESS&token=NUM`; direct token jumps clear the owner param.

## Static Assets (Images)

- High‑resolution and grid images live outside the bundle under `frontend/static/art/2560/` and `frontend/static/art/540h/` (git‑ignored).
- The current Gallery/Grid components request `https://app.drifellascape.art/static/art/{2560,540h}/{mint}.jpg`.
- In production, the central Caddy stack serves `releases/current` and `frontend/static` directly from this project root, so `/static/art/...` maps to `frontend/static/art/...` on disk.
- The resize helper is cwd‑relative: `yarn tsx scripts/assets/resize-images.ts width|height|meta` reads `static/full` and writes `static/{2560,540h,meta}` from the directory where it is run. Move or sync generated assets into `frontend/static/art/...` for the central Caddy mount.

## Deployment (Shared Edge VPS Workflow)

The VPS setup builds the frontend once per release and serves the static output through the central Caddy stack. Backend and worker services continue to run from source. Public API traffic enters the central Caddy on the external Docker network `public-edge` and is proxied to `drifella-backend:42800`.

1. Pull the latest code: `git pull`
2. Ensure the shared edge network exists, then start the app services:
   ```bash
   docker network inspect public-edge >/dev/null 2>&1 || docker network create public-edge
   docker compose up -d backend worker
   ```
   For the deploy compose with observability labels, private Grafana binding, and metrics scrape wiring, use:
   ```bash
   cp .env.deploy.example .env.deploy
   docker compose --env-file .env.deploy -f docker-compose.deploy.yml up -d backend worker
   ```
3. Build a new frontend release:
   ```bash
   ./scripts/release/build-frontend-release.sh
   # optional custom ID: ./scripts/release/build-frontend-release.sh 20241021-frontend
   ```
   The script runs `docker compose run --rm frontend-build` and stages the build under `releases/<release-id>`, updating the `releases/current` symlink.
   By default the build sets `VITE_API_BASE=https://api.drifellascape.art` and `VITE_POLL_MS=30000`; set either in `.env` or export them before running the script to override.
4. Reload the central Caddy from its compose directory to swap the live assets:
   ```bash
   docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
   ```
5. (Optional) Roll back by re-pointing the symlink: `ln -sfn <previous-id> releases/current` followed by another central Caddy reload.

Normal production startup does not use the repo-local Caddy service. The local Caddyfile remains available behind the opt-in `local-caddy` compose profile, and the side-by-side `caddy-verify` profile still serves `releases/current` and `/static/*` on `:42888`.
If you still have the legacy `frontend` container running, clean it up once with `docker compose up -d --remove-orphans`.

## Observability

The local observability profile mirrors the ArtGod stack: Loki for logs, Alloy for log shipping, Prometheus for metrics, Tempo and Pyroscope datasources, and Grafana with file-provisioned datasources and dashboards.

```bash
yarn observability:up
# Grafana: http://127.0.0.1:42835
```

The worker exports Magic Eden and Helius golden-signal metrics on `WORKER_METRICS_PORT` (`42841` by default): request rate, latency histograms, 429 responses, retry scheduling, and client rate-limiter waits. The backend exports API request latency/counts on `BACKEND_METRICS_PORT` (`42840` by default). Use `yarn observability:stop` or `yarn observability:down` to stop/remove only observability containers.

Deploy observability runs from `docker-compose.deploy.yml`:

```bash
docker compose --env-file .env.deploy -f docker-compose.deploy.yml --profile observability up -d backend worker loki tempo pyroscope alloy prometheus grafana
```

In deploy, Grafana is not attached to `public-edge`; it is published only on `${OBSERVABILITY_GRAFANA_HOST_BIND_IP}:${OBSERVABILITY_GRAFANA_HOST_BIND_PORT}`. The example binds `10.77.0.1:42835` for WireGuard-only access from the admin machine.

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
