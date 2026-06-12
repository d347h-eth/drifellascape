# Drifellascape — Product Overview

This document presents a high‑level, product‑oriented view of Drifellascape: the goals, guiding ideas, and how they materialize across the system’s components — the sync worker, backend API, and frontend UI — plus the external marketplace API and local database. It is intended for engineers and product partners onboarding into the project. Deeper, component‑level technical details are covered in the next three documents (worker, backend, frontend).

## Vision & Goals

- Create a fast, dependable explorer for a single NFT collection (Drifella III, 1,333 tokens) that:
  - Periodically syncs authoritative listings from a remote marketplace API under strict rate limits.
  - Maintains an accurate, query‑friendly local state (normalized, append‑only snapshots) for reliability and performance.
  - Serves users quickly and economically by keeping the current snapshot in memory.
  - Provides a crisp, high‑fidelity “image exploration” experience of original token artwork with precise pixel rendering.
- Operate “slow and steady” on cheap hosting, optimizing for correctness, determinism, and user responsiveness.

## Core Ideas

- Single‑collection scope: all logic is tailored for one collection; simplifies schema and UX.
- Append‑only snapshots: every material change to listings creates a new snapshot (version), then flips it atomically; old rows are cleaned.
- Deterministic diffs: changes are computed using a temp table + simple joins; a price drift threshold (≥ 0.01 SOL) prevents churn from tiny relists.
- Read from memory: the API holds the active snapshot in memory for quick pagination and sorting; background refreshes are cheap.
- Pixel‑perfect exploration: the frontend offers a Leaflet‑based full‑screen viewer with hard‑pixel rendering, smart hotkeys, and smooth navigation.

## System Architecture (High Level)

- Sync Worker (periodic)
  - Fetches all pages of current listings from the marketplace API within 2 RPS / 120 RPM.
  - Normalizes and stages data into a temp table; computes diffs; creates a new snapshot only if inserts/updates/deletes exist.
  - Flips the active version atomically; cleans up stale rows.
- Database (SQLite + better‑sqlite3, WAL)
  - Tables: `listing_versions` (one active), `listings_current` (append‑only snapshot rows).
  - Concurrency: WAL enables concurrent reads while the worker writes short transactions.
- Backend API (Node)
  - Loads and keeps the active listings snapshot in memory; background loop reloads if version changes.
  - Exposes `GET /listings?offset&limit&sort=price_asc|price_desc` from memory.
  - Exposes DB-side `POST /listings/search` over the active snapshot and `POST /tokens/search` over the static canon token dataset.
- Frontend (Vite + Svelte)
  - Lists the current snapshot with fast pagination and price display. The bottom Filter panel enables current-token trait/value filtering and purpose‑based browsing with fixed paging; the Traits explorer provides full-catalog trait browsing.
  - Image exploration mode: fullscreen, hard‑pixel viewing of original artwork with hotkeys and next/prev.
  - Main bar: token quick search (Enter to jump), price + [ME]/[TS] links in the bar; Gallery footer removed. On mobile, the bar wraps sections (☰ → toggles → → pagination/search → ✕).
  - Deep link: `?token=NUM` (0–1332) opens Gallery centered on the token (Tokens mode). Param updates as you browse; removed when entering Grid.

### Data Flow (Conceptual)

1. Worker → DB
   - Marketplace API → normalized rows → temp table → diff → new version → flip → cleanup
2. DB → Backend
   - Backend on startup: migration + load active snapshot → in‑memory cache → periodic refresh if version changes
3. Backend → Frontend
   - The frontend primarily uses `{listings,tokens}/search` with `limit=50`, traits attached by default, and either `offset` or `anchorMint`.
   - Listings polling stages a new first page when `versionId` changes; tokens are static and are not polled.

## External Dependencies (Marketplace API)

- Primary listings endpoint (Magic Eden collection):
  - `GET https://api-mainnet.magiceden.dev/v2/collections/drifella_iii/listings?offset=0&limit=100&sort=listPrice&listingAggMode=true&sort_direction=asc`
  - Pagination: `limit` = 100; paginate while page size is 100; `offset` advances by 100.
  - Rate limits: ≤ 2 requests/second and ≤ 120 requests/minute — enforced by the worker.
- Fields of interest per listing:
  - `tokenMint` (canonical token identifier on Solana) — used as primary key for listings.
  - `priceInfo.solPrice.rawAmount` (string, integer in base units, 9 decimals) — stored as integer; displayed as SOL.
  - `seller` (address), `extra.img` (image URL), `listingSource` (marketplace source enum).
- Activity endpoints (future): also reference `tokenMint`; reinforces using mint over name parsing.

## Local Data Model

- Listings (normalized current state)
- `listing_versions`
  - `id`, `created_at`, `total`, `active` (unique partial index to enforce a single active version).
- `listings_current`
  - `(version_id, token_mint_addr)` as PK; columns: `token_num?`, `price`, `seller`, `image_url`, `listing_source`, `created_at`.
  - Indexes for the active version: `(version_id)`, `(version_id, price)`, `(version_id, created_at)`, `(version_id, token_num)`.
- Token metadata & traits
  - Current: normalized tables for tokens and traits exist (`tokens`, `trait_types` with `spatial_group` and `purpose_class`, `trait_values`, `trait_types_values`, `token_traits`). A helper script updates type groupings/classes from CSV.
  - Ingestion: raw metadata ingested “as is”; counts maintained per type/value; special `trait_values.id=217` (None) is excluded from filters/attachments in API.

## Synchronization Strategy (Worker)

- Periodic cadence: default every 30 seconds; configurable via env.
- Rate limiter: respects 2 RPS / 120 RPM; sequential page fetching with retries (exponential backoff).
- Diffing algorithm:
  - Stage normalized rows into `temp_listings` (deduplicated by `token_mint_addr`).
  - Compute counts via simple joins (inserted/updated/deleted); apply a price epsilon (≥ 0.01 SOL) to ignore micro‑drifts.
  - If counts sum to 0 → no new snapshot.
  - Else: create a new version (inactive), bulk‑insert the new snapshot, atomically flip `active`, clean stale rows and inactive versions.
- Fault tolerance:
  - If a page fails after retries, abort cycle (avoid accidental mass delete).
  - Flip is the only transactional step; cleanup is idempotent; pending inactive versions are harmless.

## API Serving Strategy (Backend)

- In‑memory cache: load active listings snapshot on startup; background loop checks for `active` version change (default every 30s, clamped to at least 5s).
- `GET /listings?offset=0&limit=100&sort=price_asc|price_desc` returns the in‑memory active listing rows.
- `POST /listings/search` and `POST /tokens/search` run short, transactionally consistent DB reads for trait/value filtering, enrichment, and anchor-based pagination.
- No auth; CORS enabled for ease of development; designed for ~100 concurrent users.

## Frontend UX (Svelte)

- Grid/Gallery browser
  - Starts in Grid mode, then enters the horizontal Gallery for focused browsing.
  - Fetches `POST /listings/search` by default with `limit=50`, traits attached, price ascending sort, and staged periodic listings refresh (default 30s; clamped to at least 5s).
  - Data source toggle `T` switches between current Listings and canon Tokens; both sources support filtering, anchoring, and paging.
  - Gallery/Grid images are loaded from static JPG assets under `https://app.drifellascape.art/static/art/{2560,540h}/...`; exploration mode uses the original `image_url` from marketplace/listing data.
- Price display
  - Computes final price = nominal + maker fee (2%) + royalty (5%), using integer arithmetic in base units and renders in SOL (rounded up to 2 decimals).
- Exploration mode (fullscreen viewer)
  - Leaflet (CRS.Simple + ImageOverlay) with no smoothing (“hard‑pixel mode”) via CSS `image-rendering` hints.
  - Fit‑to‑width default view; precise fractional zoom; wheel zoom is immediate.
  - Next/prev navigation: left/right arrow or A/D; invisible edge click targets on sides.
  - Positioning hotkeys:
    - S: fit‑to‑width centered
    - W/Q/E: fit entire image height (middle/left/right), capped at 1:1
    - 1/2/3: fit a 1007px‑tall band (vertically aligned by tuned offset) to viewport height (no 1:1 cap)
    - O: toggle debug overlay (cyan rectangle) for the 1007px band
  - Pixel‑accurate swapping between images; double‑click resets view; ESC closes.
- Grid mode (default homepage)
  - Vertical 3‑column grid; press `G` or `Esc` to enter from Gallery/Explore; click any image to return to Gallery centered on that token.
  - Infinite scroll up/down with user‑interaction arming for paging; press `F` in Grid to refocus the last anchored token.

## Operating Characteristics

- Performance & Cost
  - Worker is I/O bound but constrained by marketplace limits; DB writes are brief, transactional, and infrequent.
  - Backend avoids DB on the hot path; memory‑resident snapshot is sufficient for current scale.
  - Frontend pulls snapshots and updates infrequently; image exploration uses the original URLs as is.
- Reliability
  - Snapshot flip ensures readers never see half‑written states; cleanup is safe and idempotent.
- Concurrency
  - SQLite WAL allows reads while the worker writes; API and worker use separate connections.

## Configuration

- Worker
  - `DRIFELLASCAPE_SYNC_INTERVAL_MS` (default: 30000)
- Backend
  - `DRIFELLASCAPE_BACKEND_REFRESH_MS` (default: 30000)
  - `DRIFELLASCAPE_PORT` (default: 3000)
- Frontend
  - `VITE_API_BASE` (default: same‑origin; Vite dev proxies `/listings*`, `/tokens*`, and `/traits*` to http://localhost:3000; release builds default to https://api.drifellascape.art)
  - `VITE_POLL_MS` (default: 30000; runtime polling is clamped to at least 5000)

## Roadmap & TBDs

- Search and filters
  - Existing: token/trait normalization, value/trait filtering, and Listings/Tokens search endpoints.
  - Remaining: price range, marketplace source, and token-number filters if the UI needs them.
- Frontend UX
  - Deep‑link for exploration mode (`/explore/:mint`) and optional preload for next/prev exploration images.
- Observability
  - Health endpoint and metrics for last sync, version id, page counts, and failures.

## Onboarding Summary

- Monorepo, Yarn Berry (PnP), TypeScript across workspaces: `backend`, `worker`, `frontend`, `database`, `shared`.
- Run locally:
  - Full stack: `yarn dev` (logs in `tmp/logs/`)
  - Backend: `yarn backend:run`
  - Worker (loop): `yarn worker:run`
  - Frontend: `yarn workspace @drifellascape/frontend dev`
- Inspect DB:
  - SQLite GUI (DB Browser for SQLite, SQLiteStudio) or CLI: open `database/drifellascape.db/sqlite.db`.
- Key design choices to internalize:
  - tokenMint as canonical key; append‑only snapshots; in‑memory serving; price epsilon; hard‑pixel explorer.
