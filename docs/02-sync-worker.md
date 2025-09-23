# Sync Worker — Technical Guide

This document describes the Drifellascape synchronization worker in depth: what it does, how it talks to the external marketplace, how it computes diffs and writes versioned snapshots, operational safeguards, and how it’s tested and configured.

## Responsibilities

- Periodically fetch the current listings for the Drifella III collection from the marketplace API.
- Normalize the data into a stable internal shape keyed by `tokenMint`.
- Compute diffs against the active local snapshot to decide whether a new snapshot is warranted.
- If changes exist, create and activate a new append‑only snapshot atomically; clean up stale rows.
- Log activity and failures with enough detail to diagnose issues, while avoiding noisy flapping on micro price drifts.

## Data Sources & Targets

- Source: Magic Eden listings API
  - `GET https://api-mainnet.magiceden.dev/v2/collections/drifella_iii/listings?offset=0&limit=100&sort=listPrice&listingAggMode=true&sort_direction=asc`
  - Pagination: `limit=100`; advance `offset` by 100 until returned page size < 100.
  - Rate limits: ≤ 2 RPS, ≤ 120 RPM (enforced by a simple in‑process limiter).
- Target: Local SQLite (WAL) schema
  - `listing_versions(id, created_at, total, active)` — only one row has `active=1`.
  - `listings_current(version_id, token_mint_addr, token_num?, price, seller, image_url, listing_source, created_at)` — append‑only snapshot rows; after activation, non‑active rows are deleted.

## Control Flow (One Cycle)

1. Fetch all pages (see Rate Limiting) and normalize to `NormalizedListing`:
   - `token_mint_addr`: string (from `tokenMint`)
   - `token_num?`: number | null (parsed from `token.name` as a convenience)
   - `price`: integer (rawAmount, SOL base units: 9 decimals)
   - `seller`: string
   - `image_url`: string (original artwork URL)
   - `listing_source`: string (source enum)
   - Listings missing any required field are skipped and counted.
2. Stage rows into a temp table: `CREATE TEMP TABLE temp_listings (...) PRIMARY KEY(token_mint_addr)`.
3. Compute diffs via joins against the active snapshot (see SQL below).
4. If inserted + updated + deleted == 0 → drop temp; end (no new snapshot, no DB churn).
5. Else:
   - Insert a new inactive version in `listing_versions` with `total = COUNT(temp_listings)`.
   - Bulk insert the new snapshot rows from `temp_listings` with `created_at = unixepoch('now')`.
   - Atomically flip `active` (BEGIN IMMEDIATE; set previous to 0, new to 1; COMMIT).
   - Cleanup: delete non‑active rows in `listings_current` and any `listing_versions` with `active=0`.

Crash safety:

- If process dies before activation, the pending version remains inactive and is ignored.
- If it dies after activation but before cleanup, the next run’s cleanup removes any stragglers.

## Rate Limiting, Retries, Logging

- Limiter: ≤ 2 RPS and ≤ 120 RPM using a minimalist token/timestamp window; sequential requests.
- Retries: up to 3 attempts with exponential backoff (2s, 4s, 8s) on 429 and 5xx; request timeout 30s.
- Abort: if any page fails after retries, abort the cycle (don’t produce partial snapshots).
- Logging: `logs/worker.log` captures page counts, skips, and summary (new version or no change) or failure cause.

## Normalization

The worker only accepts “primary” fields from the marketplace response and skips the item otherwise — to simplify invariants and testing.

- `token_mint_addr = listing.tokenMint` (canonical key)
- `price = Number(listing.priceInfo.solPrice.rawAmount)` (integer string → number)
- `seller = listing.seller`
- `image_url = listing.extra.img`
- `listing_source = listing.listingSource`
- `token_num?` is parsed from `listing.token.name` like `/#(\d+)/`; failures result in `null`.

Note: JavaScript `number` can represent typical SOL raw amounts safely at current scales. If prices ever exceed safe integer bounds, migrate to `bigint` and store as text or via a bigint‑aware binding.

## Diff Logic & SQL

Price drift epsilon: ignore updates when only `price` changed by less than `0.01 SOL` (10,000,000 in raw units). Other field changes (seller/image/source) always count.

Create and load staging:

```sql
CREATE TEMP TABLE temp_listings (
  token_mint_addr TEXT PRIMARY KEY,
  token_num INTEGER,
  price INTEGER NOT NULL,
  seller TEXT NOT NULL,
  image_url TEXT NOT NULL,
  listing_source TEXT NOT NULL
) WITHOUT ROWID;

-- Insert or replace all normalized rows via prepared statements
```

Counts:

```sql
-- Inserted
SELECT COUNT(*) AS c
FROM temp_listings tl
LEFT JOIN listings_current lc
  ON lc.version_id = :active_version AND lc.token_mint_addr = tl.token_mint_addr
WHERE lc.token_mint_addr IS NULL;

-- Updated (with epsilon on price)
SELECT COUNT(*) AS c
FROM temp_listings tl
JOIN listings_current lc
  ON lc.version_id = :active_version AND lc.token_mint_addr = tl.token_mint_addr
WHERE ABS(tl.price - lc.price) >= :epsilon
   OR tl.seller <> lc.seller
   OR tl.image_url <> lc.image_url
   OR tl.listing_source <> lc.listing_source;

-- Deleted
SELECT COUNT(*) AS c
FROM listings_current lc
LEFT JOIN temp_listings tl
  ON tl.token_mint_addr = lc.token_mint_addr
WHERE lc.version_id = :active_version AND tl.token_mint_addr IS NULL;
```

Apply (if counts > 0):

```sql
-- New inactive version
INSERT INTO listing_versions (created_at, total, active)
VALUES (unixepoch('now'), (SELECT COUNT(*) FROM temp_listings), 0);
SELECT last_insert_rowid() AS new_version_id;

-- Insert full snapshot rows
INSERT INTO listings_current
  (version_id, token_mint_addr, token_num, price, seller, image_url, listing_source, created_at)
SELECT :new_version_id, token_mint_addr, token_num, price, seller, image_url, listing_source, unixepoch('now')
FROM temp_listings;

-- Activate atomically
BEGIN IMMEDIATE;
UPDATE listing_versions SET active = 0 WHERE active = 1;
UPDATE listing_versions SET active = 1 WHERE id = :new_version_id;
COMMIT;

-- Cleanup
DELETE FROM listings_current WHERE version_id <> :new_version_id;
DELETE FROM listing_versions WHERE active = 0;
```

Notes:

- Only the activation flip is transactional to minimize lock time; cleanup is idempotent.
- Diff detection is performed once; apply phase never re‑evaluates conditions.

## Implementation Structure

Source layout (worker):

- `worker/src/fetcher.ts`
  - Rate limiter, retry wrapper, pagination, and normalization.
  - Returns `{ ok: true, listings, pages, skipped } | { ok: false, error }`.
- `worker/src/repo.ts`
  - Small DB helpers (create temp table, load rows, count diffs, versioning, activation, cleanup).
  - `ensureActiveVersionId()` seeds an initial active version if missing.
- `worker/src/sync.ts`
  - Orchestrates a single cycle: stage → diff → apply (if needed) → cleanup.
  - Exposed `syncListings(listings: NormalizedListing[])` for direct unit testing.
- `worker/src/types.ts`
  - `NormalizedListing`, `SyncResult`, `PRICE_EPSILON = 10_000_000` (0.01 SOL).
- `worker/src/index.ts`
  - Infinite loop: fetch → sync → sleep. Interval via `DRIFELLASCAPE_SYNC_INTERVAL_MS` (default 30s). Graceful SIGINT/SIGTERM handling. Logs to `logs/worker.log`.

DB module (shared):

- `database/src/db.ts`
  - Pragmas: WAL, synchronous=NORMAL, foreign_keys=ON, busy_timeout=5000.
  - `setDbPath(path)` for tests (reopens connection).
- `database/src/migrations.ts` + `database/migrations/001_listings_schema.sql`
  - Creates `listing_versions`, `listings_current`, indexes; seeds an empty active version if none.

## Error Handling & Logging

- File: `logs/worker.log`
  - Fetch errors (HTTP status and attempt), pagination summary, skip counts.
  - Sync summary: new version id and counts, or “no change”.
- Defensive checks:
  - Snapshot insert rowcount must equal `total`; otherwise rollback the new version and abort.
  - Aborts cycle on fetch failure to avoid partial snapshots that would induce mass deletes.

## Configuration

- `DRIFELLASCAPE_SYNC_INTERVAL_MS` — worker loop interval (ms), default `30000`.
- Marketplace base URL and params are currently in code (single collection); can be externalized later if needed.

## Testing Strategy

- Unit tests (Vitest):
  - `repo.countDiffs` with scenarios: no‑op, inserts, updates (epsilon below/at), deletes, mixed.
  - `fetcher.normalizeItem` for required field enforcement and parsing behavior.
- Test harness:
  - `setDbPath()` to point the DB module to an isolated temp file per test.
  - `initializeDatabase()` runs migrations for each test suite.
- Future: an end‑to‑end integration test (mocked HTTP with multiple pages) that verifies snapshot activation and cleanup.

## Extensions & Future Work

- Support additional endpoints (activities) and derived signals (e.g., delist/list events) while keeping the snapshot model intact.
- Make the price epsilon configurable per collection/market conditions.
- Consider `bigint` for price to future‑proof raw amounts.
- Add metrics/health reporting for last sync time, last error, and current version id.

## Quick Start

- Run the worker loop:

```bash
yarn worker:run
# optional interval override
DRIFELLASCAPE_SYNC_INTERVAL_MS=60000 yarn worker:run
```

- Single‑cycle (programmatic): import `fetchAllListings()` → `syncListings(listings)`.
