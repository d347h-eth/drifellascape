import { initializeDatabase, db } from '@drifellascape/database';
import type { NormalizedListing, SyncResult } from './types.js';
import { PRICE_EPSILON } from './types.js';

function createTempTable() {
  db.exec(`
    CREATE TEMP TABLE temp_listings (
      token_mint TEXT PRIMARY KEY,
      token_no INTEGER,
      price INTEGER NOT NULL,
      seller TEXT NOT NULL,
      image_url TEXT NOT NULL,
      listing_source TEXT NOT NULL
    ) WITHOUT ROWID;
  `);
}

function dropTempTable() {
  db.exec('DROP TABLE IF EXISTS temp_listings;');
}

function loadTempRows(rows: NormalizedListing[]) {
  const stmt = db.raw.prepare(
    'INSERT OR REPLACE INTO temp_listings (token_mint, token_no, price, seller, image_url, listing_source) VALUES (@token_mint, @token_no, @price, @seller, @image_url, @listing_source)'
  );
  const insertMany = db.raw.transaction((batch: NormalizedListing[]) => {
    for (const r of batch) stmt.run(r);
  });
  insertMany(rows);
}

function getActiveVersionId(): number | null {
  const row = db.raw
    .prepare('SELECT id FROM listing_versions WHERE active = 1 LIMIT 1')
    .get() as { id?: number } | undefined;
  return row?.id ?? null;
}

function countInserted(activeVersionId: number): number {
  const row = db.raw
    .prepare(
      `SELECT COUNT(*) AS c
       FROM temp_listings tl
       LEFT JOIN listings_current lc
         ON lc.version_id = ? AND lc.token_mint = tl.token_mint
       WHERE lc.token_mint IS NULL;`
    )
    .get(activeVersionId) as { c: number };
  return row.c | 0;
}

function countUpdated(activeVersionId: number): number {
  const row = db.raw
    .prepare(
      `SELECT COUNT(*) AS c
       FROM temp_listings tl
       JOIN listings_current lc
         ON lc.version_id = ? AND lc.token_mint = tl.token_mint
       WHERE ABS(tl.price - lc.price) >= ?
          OR tl.seller <> lc.seller
          OR tl.image_url <> lc.image_url
          OR tl.listing_source <> lc.listing_source;`
    )
    .get(activeVersionId, PRICE_EPSILON) as { c: number };
  return row.c | 0;
}

function countDeleted(activeVersionId: number): number {
  const row = db.raw
    .prepare(
      `SELECT COUNT(*) AS c
       FROM listings_current lc
       LEFT JOIN temp_listings tl
         ON tl.token_mint = lc.token_mint
       WHERE lc.version_id = ? AND tl.token_mint IS NULL;`
    )
    .get(activeVersionId) as { c: number };
  return row.c | 0;
}

function countTotalTemp(): number {
  const row = db.raw
    .prepare('SELECT COUNT(*) AS c FROM temp_listings')
    .get() as { c: number };
  return row.c | 0;
}

export async function syncListings(listings: NormalizedListing[]): Promise<SyncResult> {
  await initializeDatabase();

  // Guard: require full set provided by caller.
  // If empty array and active snapshot also empty, no-op is fine.
  createTempTable();
  try {
    loadTempRows(listings);

    let activeId = getActiveVersionId();
    if (activeId == null) {
      // Should not happen due to seeding, but treat as empty snapshot.
      db.raw.prepare(
        `INSERT INTO listing_versions (created_at, total, active)
         VALUES (unixepoch('now'), 0, 1)`
      ).run();
      activeId = getActiveVersionId();
    }
    activeId = activeId ?? 0;
    if (activeId === 0) {
      throw new Error('Invariant violated: expected a single active row in listing_versions');
    }

    const inserted = countInserted(activeId);
    const updated = countUpdated(activeId);
    const deleted = countDeleted(activeId);
    const total = countTotalTemp();

    if (inserted + updated + deleted === 0) {
      return { changed: false, counts: { inserted, updated, deleted, total } };
    }

    // Create inactive version
    const insertVersion = db.raw.prepare(
      `INSERT INTO listing_versions (created_at, total, active)
       VALUES (unixepoch('now'), ?, 0)`
    );
    insertVersion.run(total);
    const newVersionId = (db.raw.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;

    // Insert snapshot rows
    const insertSnapshot = db.raw.prepare(
      `INSERT INTO listings_current
         (version_id, token_mint, token_no, price, seller, image_url, listing_source, created_at)
       SELECT ?, token_mint, token_no, price, seller, image_url, listing_source, unixepoch('now')
       FROM temp_listings`
    );
    const res = insertSnapshot.run(newVersionId);
    if ((res.changes | 0) !== total) {
      // Cleanup partial new version and abort
      db.raw.prepare('DELETE FROM listings_current WHERE version_id = ?').run(newVersionId);
      db.raw.prepare('DELETE FROM listing_versions WHERE id = ?').run(newVersionId);
      throw new Error(`Snapshot insert mismatch: expected ${total}, inserted ${res.changes}`);
    }

    // Activate new version atomically
    db.exec('BEGIN IMMEDIATE');
    try {
      db.raw.prepare('UPDATE listing_versions SET active = 0 WHERE active = 1').run();
      db.raw.prepare('UPDATE listing_versions SET active = 1 WHERE id = ?').run(newVersionId);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      // Cleanup the inserted rows and version record since activation failed
      db.raw.prepare('DELETE FROM listings_current WHERE version_id = ?').run(newVersionId);
      db.raw.prepare('DELETE FROM listing_versions WHERE id = ?').run(newVersionId);
      throw e;
    }

    // Cleanup stale rows and inactive versions (idempotent)
    db.raw.prepare('DELETE FROM listings_current WHERE version_id <> ?').run(newVersionId);
    db.raw.prepare('DELETE FROM listing_versions WHERE active = 0').run();

    return {
      changed: true,
      versionId: newVersionId,
      counts: { inserted, updated, deleted, total },
    };
  } finally {
    dropTempTable();
  }
}
