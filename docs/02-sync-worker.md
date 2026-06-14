# Sync Worker — Technical Guide

This document describes the Drifellascape synchronization worker in depth: what it does, how it talks to the external marketplace, how it computes diffs and writes versioned snapshots, operational safeguards, and how it’s tested and configured.

## Responsibilities

- Periodically fetch the current listings for the Drifella III collection from the marketplace API.
- Periodically fetch listing and sale activities for the same collection.
- Optionally fetch a collection-wide ownership snapshot from Helius.
- Normalize the data into a stable internal shape keyed by `tokenMint`.
- Compute diffs against the active local snapshot to decide whether a new snapshot is warranted.
- If changes exist, create and activate a new append‑only snapshot atomically; clean up stale rows.
- Log activity and failures with enough detail to diagnose issues, while avoiding noisy flapping on micro price drifts.

## Data Sources & Targets

- Source: Magic Eden listings API
  - `GET https://api-mainnet.magiceden.dev/v2/collections/drifella_iii/listings?offset=0&limit=100&sort=listPrice&listingAggMode=true&sort_direction=asc`
  - Pagination: `limit=100`; advance `offset` by 100 until returned page size < 100.
  - Rate limits: ≤ 2 RPS, ≤ 120 RPM (enforced by a simple in‑process limiter).
- Source: Magic Eden activities API
  - Listings: `GET https://api-mainnet.magiceden.dev/v2/collections/drifella_iii/activities?offset=0&limit=100&type=list`
  - Sales: `GET https://api-mainnet.magiceden.dev/v2/collections/drifella_iii/activities?offset=0&limit=100&type=buyNow`
  - Pagination: same `limit=100` / `offset += 100` contract.
- Target: Local SQLite (WAL) schema
  - `listing_versions(id, created_at, total, active)` — only one row has `active=1`.
  - `listings_current(version_id, token_mint_addr, token_num?, price, seller, image_url, listing_source, created_at)` — append‑only snapshot rows; after activation, non‑active rows are deleted.
  - `market_events(...)` — append-only listing/sale event rows, unique on `(event_type, signature, token_mint_addr)`.
  - `market_event_sync_state(...)` — per-type historical backfill cursor.
  - `ownership_versions` / `ownership_current` — active ownership snapshot rows keyed by `(version_id, token_mint_addr)`.
  - `ownership_sync_state` — last ownership attempt/success/error timestamps.

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

## Market Event Flow

The worker uses Magic Eden collection activities directly for market feeds rather than deriving sale/listing history from listing snapshot diffs.

1. For each event type (`listing`, `sale`), fetch the first recent activity pages every cycle.
2. If historical backfill is incomplete, fetch a bounded number of pages from the stored per-type cursor.
3. Normalize only primary activity fields:
   - `event_type`: internal `listing` from remote `type=list`, internal `sale` from remote `type=buyNow`
   - `signature`, `source`, `slot`, `blockTime`
   - `token_mint_addr = tokenMint`
   - `price`: numeric SOL `price` converted to 9-decimal integer base units
   - `seller`, `buyer?`, `image?`
4. Insert with `INSERT OR IGNORE`; repeated recent pages and restarted backfills are idempotent.
5. Advance `market_event_sync_state.backfill_offset` after each full historical page; mark complete when a page returns fewer than 100 rows.

Operational notes:

- The same in-process limiter is shared with listing fetches, so activities remain within the worker’s ≤ 2 RPS / ≤ 120 RPM budget.
- Activity `priceInfo.solPrice.rawAmount` has been observed at a different scale from listings; the worker stores activity prices from the numeric SOL `price` field to keep all persisted prices in the project’s 9-decimal integer convention.

## Ownership Flow

Ownership sync runs in the same worker cycle after the Magic Eden listings snapshot has been applied. It is optional: when `HELIUS_KEY` is not configured, the worker skips ownership sync and the rest of the app continues normally.

1. Enforce the ownership interval (`OWNERSHIP_SYNC_INTERVAL_MS`, default 10 minutes; clamped to at least 1 minute) using `ownership_sync_state.last_attempt_at`.
2. Fetch all Drifella III assets from Helius DAS `getAssetsByGroup` with `groupKey=collection`, `groupValue=ArqtvxDZ1nfWgnGiHYCFTLj4FSVuyf7tmkAetQ9SScyQ`, and `limit=1000`.
3. Normalize `id` as `token_mint_addr` and `ownership.owner` as `onchain_owner`.
4. Merge with the fresh Magic Eden listings from the same cycle:
   - `owner = listing.seller` for listed tokens.
   - `owner = onchain_owner` for unlisted tokens.
   - `listed_owner` records the listing seller when present.
5. Stage rows into `temp_ownership`, compute inserted/updated/deleted counts against the active ownership version, and create a new version only when material changes exist.
6. Flip the active ownership version atomically and clean non-active ownership rows/versions.

## Rate Limiting, Retries, Logging, Metrics

- Limiter: ≤ 2 RPS and ≤ 120 RPM using a minimalist token/timestamp window; sequential requests.
- Retries: up to 3 attempts with exponential backoff (2s, 4s, 8s by default); only 429/5xx responses and thrown fetch errors are retried before failing the page. Request timeout is 30s by default.
- Abort: if any page fails after retries, abort the cycle (don’t produce partial snapshots).
- Logging: runtime logs are structured JSON Lines on stdout/stderr. `yarn dev` captures them in `tmp/logs/worker.log`; deploy Alloy reads labeled container logs.
- Metrics: when `WORKER_METRICS_ENABLED=true`, the worker exposes `/metrics` and `/healthz` on `WORKER_METRICS_HOST:WORKER_METRICS_PORT` (default `127.0.0.1:42841` locally). Prometheus scrapes Magic Eden and Helius request counts, latency histograms, 429 counters, retry scheduling, client rate-limiter wait histograms, worker run health, and sync result counters.

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
  - Rate limiter, shared retry wrapper, pagination, listings normalization, market event normalization, and Magic Eden request metrics.
  - Returns `{ ok: true, listings, pages, skipped } | { ok: false, error }`.
- `worker/src/market-events.ts`
  - Orchestrates recent activity sampling plus bounded historical backfill for listing/sale events.
- `worker/src/ownership.ts`
  - Orchestrates optional Helius pagination, listed-seller overlay, interval gating, ownership snapshot sync, and Helius request metrics.
- `worker/src/observability.ts` / `worker/src/external-api-observability.ts`
  - Initializes the metrics scrape endpoint and records external API golden signals.
- `worker/src/repo.ts`
  - Small DB helpers (create temp table, load rows, count diffs, versioning, activation, cleanup).
  - Market event insert helpers, ownership snapshot helpers, and backfill/sync state updates.
  - `ensureActiveVersionId()` seeds an initial active version if missing.
- `worker/src/sync.ts`
  - Orchestrates a single cycle: stage → diff → apply (if needed) → cleanup.
  - Exposed `syncListings(listings: NormalizedListing[])` for direct unit testing.
- `worker/src/types.ts`
  - `NormalizedListing`, `SyncResult`, `PRICE_EPSILON = 10_000_000` (0.01 SOL).
- `worker/src/index.ts`
  - Infinite loop: fetch → sync → sleep. Interval via `WORKER_SYNC_INTERVAL_MS` (default 30s, clamped to at least 5s). Graceful SIGINT/SIGTERM handling. Emits structured stdout/stderr logs captured by the local dev supervisor or Docker.

DB module (shared):

- `database/src/db.ts`
  - Pragmas: WAL, synchronous=NORMAL, foreign_keys=ON, busy_timeout=5000.
  - `setDbPath(path)` for tests (reopens connection).
- `database/src/migrations.ts` + `database/migrations/001_listings_schema.sql`
  - Creates `listing_versions`, `listings_current`, indexes; seeds an empty active version if none.

## Error Handling & Logging

- Runtime logs:
  - JSON Lines with `t`, `level`, `msg`, `component`, and `action`.
  - Local `yarn dev` writes worker output to `tmp/logs/worker.log`; deploy logs are collected from Docker by Alloy.
  - Fetch errors (HTTP status and attempt), retry scheduling, pagination summary, skip counts, and sync summary are logged with structured fields.
- Defensive checks:
  - Snapshot insert rowcount must equal `total`; otherwise rollback the new version and abort.
  - Aborts cycle on fetch failure to avoid partial snapshots that would induce mass deletes.

## Configuration

In local dev, `yarn worker:run` and `yarn dev` load root `.env` as local defaults before starting the worker; already-set env vars still take precedence. In Compose and production, provide these as process/container environment variables.

- `WORKER_SYNC_INTERVAL_MS` — worker loop interval (ms), default `30000`; values below 5000 are raised to 5000.
- `MARKET_EVENT_RECENT_PAGES` — recent pages per event type per cycle, default `2`, clamped to `0..10`.
- `MARKET_EVENT_BACKFILL_PAGES` — historical pages per event type per cycle, default `5`, clamped to `0..25`.
- `HELIUS_KEY` — optional Helius API key for ownership sync.
- `OWNERSHIP_SYNC_INTERVAL_MS` — ownership snapshot interval, default `600000`, clamped to at least `60000`.
- `WORKER_METRICS_ENABLED` — enables the Prometheus scrape endpoint.
- `WORKER_METRICS_HOST` / `WORKER_METRICS_PORT` — default local endpoint `127.0.0.1:42841`; Compose uses `0.0.0.0` internally.
- `COMMON_HTTP_FETCH_TIMEOUT_MS` — shared Magic Eden/Helius attempt timeout, default `30000`.
- `COMMON_HTTP_FETCH_RETRY_MAX_ATTEMPTS`, `COMMON_HTTP_FETCH_RETRY_BASE_DELAY_MS`, `COMMON_HTTP_FETCH_RETRY_MAX_DELAY_MS` — shared retry controls for 429/5xx and thrown fetch errors.
- Marketplace base URL and params are currently in code (single collection); can be externalized later if needed.

## Testing Strategy

- Unit tests (Vitest):
  - `repo.countDiffs` with scenarios: no‑op, inserts, updates (epsilon below/at), deletes, mixed.
  - `fetcher.normalizeItem` for required field enforcement and parsing behavior.
  - `fetcher.normalizeMarketEvent` for listing/sale activity field normalization and price scaling.
  - Market event repo helpers for idempotent inserts and backfill state.
  - Ownership merge/snapshot helpers for listed-seller overlay and no-op diff behavior.
- Test harness:
  - `setDbPath()` to point the DB module to an isolated temp file per test.
  - `initializeDatabase()` runs migrations for each test suite.
- Future: an end‑to‑end integration test (mocked HTTP with multiple pages) that verifies snapshot activation and cleanup.

## Extensions & Future Work

- Support additional activity types such as delists and accepted bids if the UI needs them.
- Make the price epsilon configurable per collection/market conditions.
- Consider `bigint` for price to future‑proof raw amounts.
- Add richer sync-state gauges if operational dashboards need per-version last success/error details beyond the current run health and result counters.

## Quick Start

- Run the worker loop:

```bash
yarn worker:run
# optional interval override
WORKER_SYNC_INTERVAL_MS=60000 yarn worker:run
```

- Single‑cycle (programmatic): import `fetchAllListings()` → `syncListings(listings)`.
