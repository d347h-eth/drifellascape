# Database & Migrations — Technical Guide

This document covers the local database used by Drifellascape: schema, migrations, snapshot model, indices, runtime pragmas, file layout, and test integration.

## Overview

- Engine: SQLite (file‑based) with WAL enabled
- Access: Node `better-sqlite3` (sync API, fast & simple)
- Purpose: store a normalized, append‑only snapshot of current listings, plus static token/trait tables for search and enrichment
- Migrations: plain SQL files executed by a small runner at startup

## File Layout

- Default DB directory (keeps WAL/SHM together):
  - `database/drifellascape.db/sqlite.db`
  - WAL/shm files live alongside (sqlite.db‑wal / sqlite.db‑shm)
- Tests override the DB path via `setDbPath(newPath)` in `database/src/db.ts`

## Runtime Pragmas

Applied once per connection (see `database/src/db.ts`):

- `journal_mode = WAL` — concurrent reads while a writer is active
- `synchronous = NORMAL` — balanced durability/performance
- `foreign_keys = ON` — enforce referential integrity
- `busy_timeout = 5000` — avoid tight loops on transient locks

## Schema

First migration: `database/migrations/001_listings_schema.sql`

```sql
-- listing_versions: tracks snapshots; only one active at a time
CREATE TABLE IF NOT EXISTS listing_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  total INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  CHECK (active IN (0,1))
);
-- Enforce single active row
CREATE UNIQUE INDEX IF NOT EXISTS idx_listing_versions_active_unique
  ON listing_versions(active)
  WHERE active = 1;

-- listings_current: append‑only snapshot rows for the active version
CREATE TABLE IF NOT EXISTS listings_current (
  version_id INTEGER NOT NULL,
  token_mint_addr TEXT NOT NULL CHECK(length(token_mint_addr) <= 44),
  token_num INTEGER,
  price INTEGER NOT NULL,
  seller TEXT NOT NULL CHECK(length(seller) <= 44),
  image_url TEXT NOT NULL,
  listing_source TEXT NOT NULL CHECK(length(listing_source) <= 64),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (version_id, token_mint_addr),
  FOREIGN KEY (version_id) REFERENCES listing_versions(id) ON DELETE CASCADE
);
-- Helpful indexes for the active version
CREATE INDEX IF NOT EXISTS idx_listings_current_version_id
  ON listings_current(version_id);
CREATE INDEX IF NOT EXISTS idx_listings_current_version_price
  ON listings_current(version_id, price);
CREATE INDEX IF NOT EXISTS idx_listings_current_version_created
  ON listings_current(version_id, created_at);
CREATE INDEX IF NOT EXISTS idx_listings_current_version_tokenno
  ON listings_current(version_id, token_num);

-- Seed an initial empty active version if none exists
INSERT INTO listing_versions (created_at, total, active)
SELECT unixepoch('now'), 0, 1
WHERE NOT EXISTS (SELECT 1 FROM listing_versions WHERE active = 1);
```

Design choices:

- Canonical key: `token_mint_addr` (Solana mint)
- Snapshot rows keyed by `(version_id, token_mint_addr)` to enable cheap version switching
- Minimal CHECKs on text lengths for `seller` and `listing_source`

## Snapshot Model

- Append‑only: worker inserts a full new snapshot into `listings_current` using a new `listing_versions.id`
- Activation flip (atomic): within a single IMMEDIATE transaction, set previous `active = 0` and new `active = 1`
- Cleanup: delete all rows in `listings_current` where `version_id <> active_version`; delete any non‑active version rows
- Readers (backend) always filter on the single `active` version id

Why append‑only?

- Readers never observe partial updates; activation is atomic and fast
- Cleanup is idempotent; interrupted runs recover on the next cycle
- Diff logic stays simple and write patterns remain predictable

## Migrations Runner

- `database/src/migrations.ts` loads `.sql` files (sorted) from `database/migrations`
- The runner tracks applied names in a `migrations` table and executes each SQL file inside one transaction
- The backend calls `initializeDatabase()` on startup to ensure the schema is present before serving

## Indices & Query Patterns

- `listings_current(version_id)` — anchor to the active snapshot
- `listings_current(version_id, price)` — backend sorts by price quickly
- `listings_current(version_id, created_at)` — coarse tracing/debug
- `listings_current(version_id, token_num)` — optional ordering/filter by numeric token id

For the single‑collection scope, these indices are sufficient for the in-memory snapshot load and basic price/token ordering. Trait/value search uses the normalized tables from `002_traits_schema.sql` and the indexes listed below.

## Testing & DI

- The DB package exposes `setDbPath(newPath)` to retarget the connection for tests
- Tests typically:
  1. Create a temp directory and pass its `…/test.db` to `setDbPath()`
  2. Run `initializeDatabase()` to apply migrations
  3. Use `better-sqlite3` prepared statements or repo helpers to assert behavior

## Traits Schema

Migration `002_traits_schema.sql` adds normalized tables for static token metadata and traits (raw ingestion, no canonicalization):

- `tokens`

  - `id INTEGER PRIMARY KEY AUTOINCREMENT`
  - `token_mint_addr TEXT NOT NULL UNIQUE CHECK(length(token_mint_addr) <= 44)`
  - `token_num INTEGER NOT NULL UNIQUE`
  - `name TEXT`
  - `image_url TEXT NOT NULL`
  - Indexes: `(token_mint_addr)`, `(token_num)`

- `trait_types`

  - `id INTEGER PRIMARY KEY AUTOINCREMENT`
  - `name TEXT NOT NULL` (raw `trait_type` from metadata)
  - `tokens_with_type INTEGER NOT NULL DEFAULT 0` (populated by the ingest script)
  - `spatial_group TEXT` (artist “group” / spatial layer attribution)
  - `purpose_class TEXT` (custom categorization for UI filtering)
  - Indexes: `(name)`, `(purpose_class)`, and a composite unique index on `(name, spatial_group)`

Maintenance:

- A helper script (`scripts/traits/update-trait-types.ts`) can populate or adjust `spatial_group` and `purpose_class` from a CSV (e.g., `logs/trait_groups.csv`) by id.

Operational note:

- The backend excludes the special `trait_values.id = 217` (representing “None”) from filtering and from attached traits in responses to reduce noise.

- `trait_values`

  - `id INTEGER PRIMARY KEY AUTOINCREMENT`
  - `value TEXT NOT NULL UNIQUE` (raw `value`, global across all types)
  - `tokens_with_value INTEGER NOT NULL DEFAULT 0`
  - Indexes: `(value)`

- `trait_types_values`

  - `type_id INTEGER NOT NULL` (FK → `trait_types.id`)
  - `value_id INTEGER NOT NULL` (FK → `trait_values.id`)
  - `tokens_with_type_value INTEGER NOT NULL DEFAULT 0`
  - Primary key: `(type_id, value_id)`
  - Indexes: `(value_id)`

- `token_traits`
  - `token_id INTEGER NOT NULL` (FK → `tokens.id`)
  - `type_id INTEGER NOT NULL` (FK → `trait_types.id`)
  - `value_id INTEGER NOT NULL` (FK → `trait_values.id`)
  - Primary key: `(token_id, type_id)` — one value per raw type per token
  - Indexes: `(type_id, value_id, token_id)`, `(value_id, token_id)`, `(token_id)`

Ingestion script (`scripts/traits/ingest-traits.ts`) populates these tables from the local metadata dump and a CSV mapping of mint ↔ image URL. All strings are ingested exactly as they appear in metadata (no normalization). The script recomputes counts for types, values, and type/value pairs.

Duplicate images (expected): In this collection, multiple mints can reference the same `image_url`. The ingest script handles this by treating the CSV mapping as `image_url → queue of mints` and assigns each occurrence of the same image to the next mint in FIFO order. This guarantees all 1,333 mints are inserted into `tokens` even when only ~1,263 unique image URLs exist. The schema enforces uniqueness only on `token_mint_addr` and `token_num`, not on `image_url`.

## Future Work

- Additional indices for future filters such as price ranges, marketplace sources, or token-number ranges
- Optional numeric normalization for trait values that represent numbers (range filtering)
- Lightweight integrity checks (e.g., counts consistency)

## Operations Notes

- WAL files grow with write bursts; activation/cleanup are brief. Normal VACUUM isn’t typically required; monitor file sizes in production.
- Busy timeouts mitigate transient locks; the worker keeps write transactions short.
- Backups: copy while the app is idle or copy the DB and WAL together.
