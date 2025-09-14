-- 001_listings_schema.sql
-- Initial schema for versioned listings snapshots.

-- Table: listing_versions
CREATE TABLE IF NOT EXISTS listing_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  total INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  CHECK (active IN (0,1))
);

-- Ensure only one active version at a time via partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_listing_versions_active_unique
  ON listing_versions(active)
  WHERE active = 1;

-- Table: listings_current (append-only snapshots)
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

-- Indexes to speed up filtering/sorting for the active version
CREATE INDEX IF NOT EXISTS idx_listings_current_version_id
  ON listings_current(version_id);

CREATE INDEX IF NOT EXISTS idx_listings_current_version_price
  ON listings_current(version_id, price);

CREATE INDEX IF NOT EXISTS idx_listings_current_version_created
  ON listings_current(version_id, created_at);

-- Optional numeric display index for sorting/navigation
CREATE INDEX IF NOT EXISTS idx_listings_current_version_tokenno
  ON listings_current(version_id, token_num);

-- Seed an initial empty active version to simplify first sync
INSERT INTO listing_versions (created_at, total, active)
SELECT unixepoch('now'), 0, 1
WHERE NOT EXISTS (SELECT 1 FROM listing_versions WHERE active = 1);
