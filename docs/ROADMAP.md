# drifellascape: Worker → DB → API Roadmap

This plan implements the listings pipeline with a simple, durable, and testable flow:

- Append-only snapshots in `listings_current` keyed by `(version_id, token_mint_addr)`.
- A single active snapshot selected via `listing_versions.active = 1`.
- Worker computes diffs using one temporary table and simple joins.
- Price drift threshold to ignore micro relistings (epsilon = 0.01 SOL = 10,000,000 in raw units).
- If no diffs, no new version is created. If diffs exist, the worker inserts a full new snapshot, atomically flips the active version, then cleans old rows and prunes inactive version rows.

The steps are isolated and can be developed/tested incrementally with local fixtures and an in-memory or temp-file SQLite DB.

---

## 1) Schema & Migrations

- Progress

  - [x] Create tables and indexes
  - [x] Seed initial empty active version
  - [x] Refine column constraints (seller, listing_source)
  - [x] Consolidate SQLite artifacts under `database/drifellascape.db/` (default path)
  - [ ] Add migration tests (later)

- Tables

  - `listing_versions`
    - `id INTEGER PRIMARY KEY AUTOINCREMENT`
    - `created_at INTEGER NOT NULL` (unix epoch seconds)
    - `total INTEGER NOT NULL` (row count in snapshot)
    - `active INTEGER NOT NULL DEFAULT 0`
    - Unique active constraint: `UNIQUE(active) WHERE active = 1`
  - `listings_current`
    - `version_id INTEGER NOT NULL` (FK → `listing_versions.id` ON DELETE CASCADE)
    - `token_mint_addr TEXT NOT NULL CHECK(length(token_mint_addr) <= 44)` (canonical identifier)
    - `token_num INTEGER` (optional numeric display index; stored informally)
    - `price INTEGER NOT NULL` (integer raw amount from `priceInfo.solPrice.rawAmount` — SOL with 9 decimals)
    - `seller TEXT NOT NULL CHECK(length(seller) <= 44)`
    - `image_url TEXT NOT NULL`
    - `listing_source TEXT NOT NULL CHECK(length(listing_source) <= 64)`
    - `created_at INTEGER NOT NULL` (unix epoch seconds; when the snapshot row is written)
    - Primary key: `(version_id, token_mint_addr)`
    - Indexes: `(version_id)`, `(version_id, price)`, `(version_id, created_at)`, `(version_id, token_num)`

- Pragmas (already applied in code)

  - `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`

- Initial migration file (to add later)

  - `database/migrations/001_listings_schema.sql` containing the table and index DDL above, plus seeding an empty active version if none exists.

- Tests
  - Migration runner creates tables and constraints.
  - Foreign key ON and unique active constraint enforced.

---

## 2) Worker: Normalization & Throttled Fetch

- Progress

  - [x] Implement rate limiter (2 RPS / 120 RPM)
  - [x] Implement paginated fetcher with retries and timeout
  - [x] Implement normalization and basic tests
  - [x] Wire worker loop with configurable interval (default 30s)

- Config

  - Remote endpoint: listings (paginated, `limit=100`, `offset` paging).
  - Rate limit: ≤ 2 RPS and ≤ 120 RPM.
  - Sync interval: ~30s (configurable).
  - Timeouts and simple retry policy (e.g., 3 tries, exponential backoff).

- HTTP client

  - Sequentially fetch pages until a page returns < 100 items.
  - Throttle requests (token bucket or sleep-based limiter) to respect both RPS and RPM.
  - Unit tests with fixtures (mocked responses for multiple pages and edge cases).

- Normalization
  - Accept primary fields only: `tokenMint`, `priceInfo.solPrice.rawAmount`, `seller`, `extra.img`, `listingSource`.
  - Key: `token_mint_addr` (canonical). Optional `token_num` parsed from `token.name`.
  - Exclude `expiry` (not used).
  - Tests for robust parsing and required field enforcement.

---

## 3) Worker: Diff Computation (Temp Table + Simple Joins)

- Progress

  - [x] Implemented diff queries and helper APIs in worker/src/repo.ts
  - [x] Tested countDiffs across insert/update/delete/no-op and epsilon cases

- Pre-conditions

  - Ensure a fully successful fetch of all pages; if not, abort this cycle to avoid accidental mass deletes.
  - Get the active version id: `SELECT id FROM listing_versions WHERE active = 1 LIMIT 1`.
    - If none, treat as empty active snapshot (or seed an empty version in migration).

- SQL (single connection, short-lived temp table)

  1.  Create staging table and load rows

          - `CREATE TEMP TABLE temp_listings (

      token_mint_addr TEXT PRIMARY KEY,
      token_num INTEGER,
      price INTEGER NOT NULL,
      seller TEXT NOT NULL,
      image_url TEXT NOT NULL,
      listing_source TEXT NOT NULL
      ) WITHOUT ROWID;` - Insert all normalized rows with prepared statements.

  2.  Compute counts (use only simple joins)

                      - Inserted:
                        - `SELECT COUNT(*) FROM temp_listings tl

                  LEFT JOIN listings*current lc
                  ON lc.version_id = :active_version AND lc.token_mint_addr = tl.token_mint_addr
                  WHERE lc.token_mint_addr IS NULL;`    - Updated (with price drift threshold):

            -`SELECT COUNT(*) FROM temp*listings tl

      JOIN listings*current lc
      ON lc.version_id = :active_version AND lc.token_mint_addr = tl.token_mint_addr
      WHERE ABS(tl.price - lc.price) >= :epsilon /\* 0.01 SOL = 10,000,000 */
      OR tl.seller <> lc.seller
      OR tl.image*url <> lc.image_url
      OR tl.listing_source <> lc.listing_source;` - Deleted: -`SELECT COUNT(*) FROM listings_current lc
      LEFT JOIN temp_listings tl
      ON tl.token_mint_addr = lc.token_mint_addr
      WHERE lc.version_id = :active_version AND tl.token_mint_addr IS NULL;`

  3.  If inserted + updated + deleted == 0
      - Drop temp table and end: no new version.

---

## 4) Worker: Append-Only Snapshot + Activate + Cleanup

- Progress

  - [x] Implemented append-only snapshot, activation flip, and cleanup in syncListings
  - [x] Added idempotent cleanup of non-active rows and inactive versions

- Create a pending version (inactive)

  - `INSERT INTO listing_versions (created_at, total, active)
VALUES (unixepoch('now'), (SELECT COUNT(*) FROM temp_listings), 0);`
  - `SELECT last_insert_rowid()` → `:new_version_id`.

- Bulk insert the new snapshot rows

  - `INSERT INTO listings_current
  (version_id, token_mint_addr, token_num, price, seller, image_url, listing_source, created_at)
SELECT :new_version_id, token_mint_addr, token_num, price, seller, image_url, listing_source, unixepoch('now')
FROM temp_listings;`

- Optional validation (defensive)

  - Verify inserted row count equals `(SELECT total FROM listing_versions WHERE id = :new_version_id)`.

- Atomically activate the new version (only transactional step)

  - `BEGIN IMMEDIATE;`
  - `UPDATE listing_versions SET active = 0 WHERE active = 1;`
  - `UPDATE listing_versions SET active = 1 WHERE id = :new_version_id;`
  - `COMMIT;`

- Cleanup stale rows (idempotent)

  - `DELETE FROM listings_current WHERE version_id <> :new_version_id;`
  - `DELETE FROM listing_versions WHERE active = 0;`
  - Drop temp table.

- Crash resilience

  - If the process dies before activation, pending version stays inactive and is ignored by readers.
  - If it dies after activation but before cleanup, the next run’s cleanup removes all non-active rows.

- Tests
  - No-op when remote data is identical.
  - Insert-only, update-only, delete-only, and mixed changes.
  - Reordering doesn’t create a new version.
  - Crash scenarios: simulate interruptions before/after activation; ensure next run self-heals.

---

## 5) Backend API: In-Memory Snapshot + Polling

- Cache

  - On startup, read `active_version_id` and load all rows from `listings_current` for that version into memory.
  - Background polling every ~30s: check for a new `active_version_id`.
    - If changed, reload the in-memory snapshot; keep a lightweight in-process lock to avoid overlapping reloads.

- Endpoints (initial)

  - `GET /listings?offset&limit&sort=price_asc|price_desc`
    - Serve from memory. Apply pagination and simple filters locally (fast for ~1–2k rows).

- Progress

  - [x] Implemented ListingsCache with consistent snapshot load
  - [x] Added refresh loop with `DRIFELLASCAPE_BACKEND_REFRESH_MS` (default 30s)
  - [x] Implemented `/listings` with offset/limit and price sorting
  - [ ] Add health endpoint and backend tests

- Tests
  - Cache warms on startup.
  - Cache reloads on version flip; concurrent reads continue to serve previous snapshot until reload completes.

---

## 6) Test Strategy & Fixtures

- Progress

  - [x] Add unit tests for worker repo.countDiffs (epsilon, insert/update/delete/no-op)
  - [x] Add unit tests for worker fetcher.normalizeItem

- Database tests (better-sqlite3)

  - Use a temp-file DB per test run (or `:memory:` per test) and run migrations.
  - Helper to seed `listing_versions` with an empty active version for first-run tests.
  - Verify constraints and indexes exist.

- Worker tests

  - Mock HTTP client with JSON fixtures (including pagination and edge cases).
  - Unit-test normalization (token_id parsing, price integer conversion, required fields).
  - Diff scenarios: no change, inserts, updates (price/seller/image/source), deletes, mixed.
  - Activation flip and cleanup behavior; crash-recovery idempotence.

- API tests
  - In-memory cache boot + refresh cycle using a fake DB adapter.
  - Pagination correctness and ordering by price.

---

## 7) Frontend: Listings + Exploration Mode

- Progress

  - [x] Listings page fetch (limit=100) + staged polling (apply when at top)
  - [x] Price with maker (2%) + royalty (5%) fees; SOL rounding
  - [x] Exploration mode (Leaflet) with hard‑pixel rendering and fit‑by‑width default
  - [x] Next/prev via hotkeys and invisible edge targets; ESC to close
  - [x] Positioning hotkeys: S/W/Q/E and 1/2/3 (region‑fit with tuned offset); G toggles debug overlay

---

## 8) Implementation Order (Milestones)

1. Database migrations for listings schema (001)

   - [x] Add DDL for `listing_versions` and `listings_current`, plus unique active constraint and indexes.
   - [x] Seed: empty active version.

2. Worker core (sync without HTTP)

   - [x] Implement temp-table diff + append-only snapshot + activate + cleanup.
   - [x] Unit tests for diff scenarios using direct row arrays (no network).

3. Worker HTTP integration

   - [x] Add throttled, paginated fetcher and normalization.
   - [x] Wire minimal worker entry and loop.

4. Backend API cache & read endpoints

   - [x] Implement cache warm + poll loop; basic listings endpoint with pagination/sort.
   - [ ] Tests for cache behavior and endpoint outputs.

5. Frontend

   - [x] Listings page, price display, and staged polling
   - [x] Exploration mode with hard‑pixel rendering, hotkeys, next/prev, and debug overlay

6. Observability & ops (optional)

   - Minimal logs (sync success/fail, version id, counts).
   - Health endpoint exposing last sync time/version.

7. Future: Token metadata & traits (out of scope for now)
   - Normalize tokens and traits for filterable queries; integrate with listings.

---

## 9) Configuration & Defaults

- Sync interval: 30s (env-configurable).
- Rate limit: 2 RPS / 120 RPM, exponential backoff retries.
- Timeouts: 10–30s per request.
- Log files under `./logs/`.
- Price drift threshold epsilon: 0.01 SOL = 10,000,000 (raw integer units).

---

## 10) Open Questions

- Do we seed an initial empty active version in migration (recommended for simpler first run)?
- Any need to prune old inactive `listing_versions` rows (rows in `listings_current` are cleaned automatically after activation)?
- Exact sorting and tie-breaking for `/listings` (by price, then token_id?).
