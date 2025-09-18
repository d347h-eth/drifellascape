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
  - Loads and keeps the active snapshot in memory; background loop reloads if version changes.
  - Exposes `GET /listings?offset&limit&sort=price_asc|price_desc`.
- Frontend (Vite + Svelte)
  - Lists the current snapshot with fast pagination and price display.
  - Image exploration mode: fullscreen, hard‑pixel viewing of original artwork with hotkeys and next/prev.

### Data Flow (Conceptual)

1. Worker → DB
   - Marketplace API → normalized rows → temp table → diff → new version → flip → cleanup
2. DB → Backend
   - Backend on startup: migration + load active snapshot → in‑memory cache → periodic refresh if version changes
3. Backend → Frontend
   - `GET /listings` serves in‑memory data; frontend fetches, renders, and periodically polls/stages updates.

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
- Token metadata (downloaded offline)
  - Current state: all token metadata JSON fetched and stored locally (IDs 0..1332) under `./metadata/{id}.json`.
  - Future state (TBD): normalize tokens and traits into relational tables for fast filtering (tokens, traits, token_traits), including distributions and indexes.

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

- In‑memory cache: load active snapshot on startup; background loop checks for `active` version change (default every 30s).
- Single endpoint:
  - `GET /listings?offset=0&limit=50&sort=price_asc|price_desc`
  - Returns `{ versionId, total, offset, limit, sort, items: [...] }` using the in‑memory dataset.
- No auth; CORS enabled for ease of development; designed for ~100 concurrent users.

## Frontend UX (Svelte)

- Listings page
  - Fetches `GET /listings?limit=100` on mount; staged periodic refresh (default 30s) updates only when the user scrolls to top to avoid viewport jumps.
  - Displays a single image per row (2560px width local assets per mint); price includes fees and links to marketplace.
- Price display
  - Computes final price = nominal + maker fee (2%) + royalty (5%), using integer arithmetic in base units and renders in SOL (rounded up to 2 decimals).
- Exploration mode (fullscreen viewer)
  - Leaflet (CRS.Simple + ImageOverlay) with no smoothing (“hard‑pixel mode”) via CSS `image-rendering` hints.
  - Fit‑to‑width default view; precise fractional zoom; wheel zoom is immediate.
  - Next/prev navigation: left/right arrow or A/D; invisible edge click targets on sides.
  - Positioning hotkeys:
    - S: fit‑to‑width centered
    - W/Q/E: fit entire image height (middle/left/right), capped at 1:1
    - 1/2/3: fit a 1006px‑tall band (vertically aligned by tuned offset) to viewport height (no 1:1 cap)
    - G: toggle debug overlay (cyan rectangle) for the 1006px band
  - Pixel‑accurate swapping between images; double‑click resets view; ESC closes.

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
  - `VITE_API_BASE` (default: http://localhost:3000)
  - `VITE_POLL_MS` (default: 30000)

## Roadmap & TBDs

- Token metadata & traits (TBD)
  - Normalize tokens and traits; design indexes for multi‑trait filtering; compute distributions and rarity surfaces.
- Backend filtering
  - Add server‑side filters (traits, price ranges, marketplace source) with efficient plans.
- Frontend UX
  - Deep‑link for exploration mode (`/explore/:mint`), shareable links, wrap‑around navigation.
  - Optional preload for next/prev images; light keyboard overlay help.
- Observability
  - Health endpoints; metrics for last sync, version id, page counts; minimal logs for failures.

## Onboarding Summary

- Monorepo, Yarn Berry (PnP), TypeScript across workspaces: `backend`, `worker`, `frontend`, `database`, `shared`.
- Run locally:
  - Backend: `yarn backend:run`
  - Worker (loop): `yarn worker:run`
  - Frontend: `yarn workspace @drifellascape/frontend dev`
- Inspect DB:
  - SQLite GUI (DB Browser for SQLite, SQLiteStudio) or CLI: open `database/drifellascape.db/sqlite.db`.
- Key design choices to internalize:
  - tokenMint as canonical key; append‑only snapshots; in‑memory serving; price epsilon; hard‑pixel explorer.
