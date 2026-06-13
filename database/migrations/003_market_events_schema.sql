-- 003_market_events_schema.sql
-- Append-only market activity feed rows from Magic Eden collection activities.

CREATE TABLE IF NOT EXISTS market_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL CHECK(event_type IN ('listing', 'sale')),
  signature TEXT NOT NULL,
  source TEXT NOT NULL CHECK(length(source) <= 64),
  slot INTEGER NOT NULL,
  block_time INTEGER NOT NULL,
  token_mint_addr TEXT NOT NULL CHECK(length(token_mint_addr) <= 44),
  price INTEGER NOT NULL,
  seller TEXT CHECK(seller IS NULL OR length(seller) <= 44),
  buyer TEXT CHECK(buyer IS NULL OR length(buyer) <= 44),
  image_url TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(event_type, signature, token_mint_addr)
);

CREATE INDEX IF NOT EXISTS idx_market_events_type_time
  ON market_events(event_type, block_time DESC, slot DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_market_events_time
  ON market_events(block_time DESC, slot DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_market_events_token_time
  ON market_events(token_mint_addr, block_time DESC);

CREATE TABLE IF NOT EXISTS market_event_sync_state (
  event_type TEXT PRIMARY KEY CHECK(event_type IN ('listing', 'sale')),
  backfill_offset INTEGER NOT NULL DEFAULT 0,
  backfill_complete INTEGER NOT NULL DEFAULT 0 CHECK(backfill_complete IN (0, 1)),
  updated_at INTEGER NOT NULL
);

INSERT INTO market_event_sync_state (event_type, backfill_offset, backfill_complete, updated_at)
SELECT 'listing', 0, 0, unixepoch('now')
WHERE NOT EXISTS (SELECT 1 FROM market_event_sync_state WHERE event_type = 'listing');

INSERT INTO market_event_sync_state (event_type, backfill_offset, backfill_complete, updated_at)
SELECT 'sale', 0, 0, unixepoch('now')
WHERE NOT EXISTS (SELECT 1 FROM market_event_sync_state WHERE event_type = 'sale');
