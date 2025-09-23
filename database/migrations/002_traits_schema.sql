-- 002_traits_schema.sql
-- Traits and tokens schema to support filtering (raw ingestion).

-- Table: tokens (static per collection)
CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_mint_addr TEXT NOT NULL UNIQUE CHECK(length(token_mint_addr) <= 44),
  token_num INTEGER NOT NULL UNIQUE,
  name TEXT,
  image_url TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tokens_mint ON tokens(token_mint_addr);
CREATE INDEX IF NOT EXISTS idx_tokens_num ON tokens(token_num);

-- Table: trait_types (raw keys as present in metadata)
CREATE TABLE IF NOT EXISTS trait_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  tokens_with_type INTEGER NOT NULL DEFAULT 0,
  spatial_group TEXT,
  purpose_class TEXT
);

CREATE INDEX IF NOT EXISTS idx_trait_types_name ON trait_types(name);
CREATE INDEX IF NOT EXISTS idx_trait_types_purpose_class ON trait_types(purpose_class);
-- Enforce uniqueness per spatial group (name + spatial_group)
CREATE UNIQUE INDEX IF NOT EXISTS idx_trait_types_unique_name_group
  ON trait_types(name, spatial_group);

-- Table: trait_values (global unique text values across all types; raw, no normalization)
CREATE TABLE IF NOT EXISTS trait_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  value TEXT NOT NULL UNIQUE,
  tokens_with_value INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_trait_values_value ON trait_values(value);

-- Table: trait_types_values (catalog of seen type/value pairs, with counts)
CREATE TABLE IF NOT EXISTS trait_types_values (
  type_id INTEGER NOT NULL,
  value_id INTEGER NOT NULL,
  tokens_with_type_value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (type_id, value_id),
  FOREIGN KEY (type_id) REFERENCES trait_types(id) ON DELETE CASCADE,
  FOREIGN KEY (value_id) REFERENCES trait_values(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_trait_types_values_value ON trait_types_values(value_id);

-- Join table: token_traits (one value per raw type per token)
CREATE TABLE IF NOT EXISTS token_traits (
  token_id INTEGER NOT NULL,
  type_id INTEGER NOT NULL,
  value_id INTEGER NOT NULL,
  PRIMARY KEY (token_id, type_id),
  FOREIGN KEY (token_id) REFERENCES tokens(id) ON DELETE CASCADE,
  FOREIGN KEY (type_id) REFERENCES trait_types(id) ON DELETE CASCADE,
  FOREIGN KEY (value_id) REFERENCES trait_values(id) ON DELETE CASCADE
);

-- Helpful indexes for filtering (side-agnostic querying)
CREATE INDEX IF NOT EXISTS idx_token_traits_type_value ON token_traits(type_id, value_id, token_id);
CREATE INDEX IF NOT EXISTS idx_token_traits_value ON token_traits(value_id, token_id);
CREATE INDEX IF NOT EXISTS idx_token_traits_token ON token_traits(token_id);
