-- 004_ownership_snapshots.sql
-- Versioned ownership snapshots for owner-based token filtering.

CREATE TABLE IF NOT EXISTS ownership_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  total INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  CHECK (active IN (0, 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ownership_versions_active_unique
  ON ownership_versions(active)
  WHERE active = 1;

CREATE TABLE IF NOT EXISTS ownership_current (
  version_id INTEGER NOT NULL,
  token_mint_addr TEXT NOT NULL CHECK(length(token_mint_addr) <= 44),
  owner TEXT NOT NULL CHECK(length(owner) <= 44),
  onchain_owner TEXT NOT NULL CHECK(length(onchain_owner) <= 44),
  listed_owner TEXT CHECK(listed_owner IS NULL OR length(listed_owner) <= 44),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (version_id, token_mint_addr),
  FOREIGN KEY (version_id) REFERENCES ownership_versions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ownership_current_version_owner
  ON ownership_current(version_id, owner);

CREATE INDEX IF NOT EXISTS idx_ownership_current_version_mint
  ON ownership_current(version_id, token_mint_addr);

CREATE TABLE IF NOT EXISTS ownership_sync_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  last_attempt_at INTEGER NOT NULL DEFAULT 0,
  last_success_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

INSERT INTO ownership_versions (created_at, total, active)
SELECT unixepoch('now'), 0, 1
WHERE NOT EXISTS (SELECT 1 FROM ownership_versions WHERE active = 1);

INSERT INTO ownership_sync_state (id, last_attempt_at, last_success_at, last_error)
SELECT 1, 0, 0, NULL
WHERE NOT EXISTS (SELECT 1 FROM ownership_sync_state WHERE id = 1);
