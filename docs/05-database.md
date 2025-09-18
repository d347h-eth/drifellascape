# Database & Migrations — Technical Guide

This document covers the local database used by Drifellascape: schema, migrations, snapshot model, indices, runtime pragmas, file layout, and test integration.

## Overview

- Engine: SQLite (file‑based) with WAL enabled
- Access: Node `better-sqlite3` (sync API, fast & simple)
- Purpose: store a normalized, append‑only snapshot of current listings for a single collection and track snapshot versions
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

- `database/src/migrations.ts` loads SQL files (sorted) from `database/migrations`
- The runner executes statements individually and is idempotent
- The backend calls `initializeDatabase()` on startup to ensure the schema is present before serving

## Indices & Query Patterns

- `listings_current(version_id)` — anchor to the active snapshot
- `listings_current(version_id, price)` — backend sorts by price quickly
- `listings_current(version_id, created_at)` — coarse tracing/debug
- `listings_current(version_id, token_num)` — optional ordering/filter by numeric token id

For the single‑collection scope, these indices are sufficient for basic pagination and sorting. When trait filtering arrives, new tables and indices will be added (see TBD).

## Testing & DI

- The DB package exposes `setDbPath(newPath)` to retarget the connection for tests
- Tests typically:
  1) Create a temp directory and pass its `…/test.db` to `setDbPath()`
  2) Run `initializeDatabase()` to apply migrations
  3) Use `better-sqlite3` prepared statements or repo helpers to assert behavior

## Future Work (TBD)

- Traits schema
  - `tokens(token_mint_addr PK, token_num?, name, image_url, …)`
  - `traits(trait_id PK, trait_name)`
  - `token_traits(token_mint_addr, trait_id, value)` with indices on `(trait_id, value)` and `(token_mint_addr)`
  - Precomputed distributions for fast filtering
- Additional indices for server‑side filtering (by source, price ranges, etc.)
- Lightweight integrity checks (e.g., row count = `listing_versions.total` for active snapshot)

## Operations Notes

- WAL files grow with write bursts; activation/cleanup are brief. Normal VACUUM isn’t typically required; monitor file sizes in production.
- Busy timeouts mitigate transient locks; the worker keeps write transactions short.
- Backups: copy while the app is idle or copy the DB and WAL together.
