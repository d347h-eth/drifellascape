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
