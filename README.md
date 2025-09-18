# Drifellascape

A fast, reliable explorer for a single NFT collection (Drifella III). It keeps a local, versioned snapshot of live marketplace listings, serves data from memory, and offers a crisp, pixel‑perfect fullscreen viewer for original artwork.

## Features

- Slow & steady sync worker (rate‑limited; resilient), append‑only snapshots with atomic activation
- Normalized SQLite schema (WAL); concurrent reads while syncing
- Backend API with in‑memory cache for low‑latency reads
- Frontend (Svelte) with a fullscreen hard‑pixel exploration mode and rich hotkeys

## Repo Layout

- `worker/` — periodic sync from marketplace → SQLite snapshot
- `backend/` — Node HTTP server with in‑memory snapshot cache
- `frontend/` — Vite + Svelte app (listings + exploration)
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

## Database

- SQLite file is stored under:
  - `database/drifellascape.db/sqlite.db`
- Inspect with DB Browser for SQLite / SQLiteStudio, or the `sqlite3` CLI.

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

## License

AGPL‑3.0‑only. See `LICENSE`.
