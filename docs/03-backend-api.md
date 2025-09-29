# Backend API — Technical Guide

This document describes the Drifellascape backend API: its in‑memory caching model, endpoint contract, data flow from SQLite, concurrency/race handling, configuration, and extension points.

## Purpose

- Serve the current listings snapshot quickly and cheaply.
- Decouple read performance from the database by keeping the active snapshot in memory.
- Reload the in‑memory snapshot only when the active version flips in the database.

## Architecture Overview

- Minimal Node HTTP server (no framework), see `backend/src/server.ts`.
- In‑memory cache (see `backend/src/cache.ts`) backed by repo functions (`backend/src/repo.ts`).
- Database access via the shared `database` package (better‑sqlite3, WAL). Migrations executed once at startup.

### In‑memory Cache

- Shape: `{ versionId: number, items: ListingRow[] }` where `ListingRow` contains:
  - `token_mint_addr`, `token_num?`, `price`, `seller`, `image_url`, `listing_source`.
- On first request, the cache ensures it is loaded by reading the active version and its rows.
- Background loop (interval) checks the active version id and reloads only if changed.
- Simple in‑process guard (`refreshing` flag) avoids overlapping reloads.

### Race‑free Active Snapshot Load

To avoid a race between reading the active version id and its rows while the worker flips versions, the backend uses a consistent, read‑transaction load:

- `loadActiveSnapshotConsistent()` performs `SELECT id FROM listing_versions WHERE active=1` and `SELECT ... FROM listings_current WHERE version_id=?` inside a single transaction on the same connection.
- This guarantees a snapshot view even if the worker flips and cleans rows concurrently — you either get the full old or full new snapshot, never a partial mix.

## Endpoint Contract

- `GET /listings?offset&limit&sort`

  - Query params:
    - `offset`: default 0, clamped to `>= 0`.
    - `limit`: default 50, clamped to `[1, 200]`.
    - `sort`: `price_asc` (default) or `price_desc`.
  - Response (200):
    ```json
    {
      "versionId": 123,
      "total": 100,
      "offset": 0,
      "limit": 50,
      "sort": "price_asc",
      "items": [ { /* ListingRow */ }, ... ]
    }
    ```
  - Errors (500): `{ "error": "message" }`.
  - CORS: `Access-Control-Allow-Origin: *`.

- `POST /listings/search`

  - Server‑side filtering over the active snapshot; returns enriched listings (token + traits) by default.
  - Body:
    - `mode`: `"value" | "trait"`
    - `valueIds`: number[] (AND semantics in value mode)
    - `traits`: `{ typeId: number, valueIds: number[] }[]` (AND across types, OR within values)
    - `offset`, `limit` (default 0/100; max 200), `sort` (`price_asc` | `price_desc`), `includeTraits` (default true)
    - `anchorMint` (optional): exclusive with `offset`. When present, the server computes the page so this mint appears (centered when possible) and returns the effective `offset` used.
  - Notes:
    - Consistent read: results are anchored to the active snapshot id.
    - Excludes special `trait_values.id = 217` ("None") from filtering and attached traits.
  - CORS & preflight: `GET,POST,OPTIONS` with `content-type` allowed.
  - See also: API details and sample payloads in `docs/06-api-reference.md`.

- `POST /tokens/search`
  - Server‑side filtering over the canon tokens dataset; returns enriched tokens by default.
  - Body:
    - `mode`, `valueIds`, `traits`, `includeTraits` same as listings.
    - `offset`, `limit` (default 0/100; max 100), `sort` (`token_asc` | `token_desc`).
    - `anchorMint` (optional): exclusive with `offset`. Behavior mirrors listings search; response `offset` is the effective offset used.
  - Notes:
    - Tokens are static; there is no `versionId` in the response.
    - Excludes `trait_values.id = 217` ("None").

Notes:

- Sorting is performed in memory on the cached array by the integer `price` field (raw SOL units). Tie‑breakers are not enforced; add secondary sort if needed.
- Price formatting, fees, and image rendering are handled by the frontend.

## Process Flow

1. Server startup:
   - `initializeDatabase()` runs migrations (idempotent) and ensures schema.
   - Starts refresh loop with interval `DRIFELLASCAPE_BACKEND_REFRESH_MS` (default 30s).
2. First request / cold start:
   - `ensureLoaded()` loads `{ versionId, items }` with a consistent DB read.
3. Subsequent requests:
   - Serve from the in‑memory snapshot.
4. Background refresh:
   - Poll active version id; if changed, reload snapshot with the consistent read and swap in memory.

## Files & Responsibilities

- `backend/src/server.ts`
  - Node HTTP server, request routing, JSON responses, and CORS header.
  - Starts DB and refresh loop (`startServer()`).
- `backend/src/cache.ts`
  - `ListingsCache` with `ensureLoaded()`, `refreshIfChanged()`, and `getSnapshotUnsafe()`.
  - Holds the current `{ versionId, items }` and guards concurrent refresh.
- `backend/src/repo.ts`
  - `getActiveVersionId()`: reads the active version id.
  - `loadSnapshot(versionId)`: loads all rows for the given version id.
  - `loadActiveSnapshotConsistent()`: reads id+rows in a single transaction (preferred).

## Concurrency & Database

- SQLite with WAL allows readers to proceed while the worker writes.
- The backend uses read‑only operations and short‑lived transactions.
- Consistent snapshot loads prevent races with the worker’s activation/cleanup phases.

## Configuration

- `DRIFELLASCAPE_BACKEND_REFRESH_MS` — polling interval for active version changes (default `30000`).
- `DRIFELLASCAPE_PORT` — server port (default `3000`).

## Performance & Capacity

- Memory footprint: `items.length` equals the currently listed tokens (typically far below 1,333). Each row is small; JSON serialization cost dominates at large `limit`.
- Throughput: designed for ~100 concurrent users on modest hardware; pagination and sorting operate on in‑memory arrays.
- Latency: no DB access on the hot path; only memory and JSON encoding.

## Error Handling

- Errors during cache load or refresh yield 500 with `{ error }` and are logged to stdout/stderr.
- The server continues running; next refresh attempts will try to recover.

## Security & CORS

- No authentication; open `GET /listings`.
- CORS: permissive, suitable for single‑domain deployment; tighten as needed.

## Extensions & Roadmap

- Add health endpoint (e.g., `/health`) with last refresh time, version id, and item count.
- Add filters: price ranges, marketplace source, token number; later, trait filters (once traits are normalized in DB).
- Improve sorting: tie‑breakers, then secondary fields.
- Consider gzip/deflate if payloads grow (many listings); Vite dev already handles compression for frontend.

## Quick Start

```bash
yarn backend:run
# Optional:
DRIFELLASCAPE_PORT=4000 DRIFELLASCAPE_BACKEND_REFRESH_MS=10000 yarn backend:run
```

The frontend defaults to `VITE_API_BASE=http://localhost:3000` and consumes `/listings` for rendering.
