import { db } from "@drifellascape/database";
import type { NormalizedListing } from "./types.js";

export function createTempTable(): void {
    db.exec(`
    CREATE TEMP TABLE temp_listings (
      token_mint_addr TEXT PRIMARY KEY,
      token_num INTEGER,
      price INTEGER NOT NULL,
      seller TEXT NOT NULL,
      image_url TEXT NOT NULL,
      listing_source TEXT NOT NULL
    ) WITHOUT ROWID;
  `);
}

export function dropTempTable(): void {
    db.exec("DROP TABLE IF EXISTS temp_listings;");
}

export function loadTempRows(rows: NormalizedListing[]): void {
    const stmt = db.raw.prepare(
        "INSERT OR REPLACE INTO temp_listings (token_mint_addr, token_num, price, seller, image_url, listing_source) VALUES (@token_mint_addr, @token_num, @price, @seller, @image_url, @listing_source)",
    );
    const insertMany = db.raw.transaction((batch: NormalizedListing[]) => {
        for (const r of batch) stmt.run(r);
    });
    insertMany(rows);
}

export function getActiveVersionId(): number | null {
    const row = db.raw
        .prepare("SELECT id FROM listing_versions WHERE active = 1 LIMIT 1")
        .get() as { id?: number } | undefined;
    return row?.id ?? null;
}

export function ensureActiveVersionId(): number {
    const existingId = getActiveVersionId();
    if (existingId) return existingId;
    db.raw
        .prepare(
            `INSERT INTO listing_versions (created_at, total, active) VALUES (unixepoch('now'), 0, 1)`,
        )
        .run();
    const seededId = getActiveVersionId();
    if (!seededId)
        throw new Error("Failed to seed active listing_versions row");
    return seededId;
}

export function countDiffs(
    activeVersionId: number,
    epsilon: number,
): {
    inserted: number;
    updated: number;
    deleted: number;
    total: number;
} {
    const inserted =
        (
            db.raw
                .prepare(
                    `SELECT COUNT(*) AS c
       FROM temp_listings tl
       LEFT JOIN listings_current lc
         ON lc.version_id = ? AND lc.token_mint_addr = tl.token_mint_addr
       WHERE lc.token_mint_addr IS NULL;`,
                )
                .get(activeVersionId) as { c: number }
        ).c | 0;

    const updated =
        (
            db.raw
                .prepare(
                    `SELECT COUNT(*) AS c
       FROM temp_listings tl
       JOIN listings_current lc
         ON lc.version_id = ? AND lc.token_mint_addr = tl.token_mint_addr
       WHERE ABS(tl.price - lc.price) >= ?
          OR tl.seller <> lc.seller
          OR tl.image_url <> lc.image_url
          OR tl.listing_source <> lc.listing_source;`,
                )
                .get(activeVersionId, epsilon) as { c: number }
        ).c | 0;

    const deleted =
        (
            db.raw
                .prepare(
                    `SELECT COUNT(*) AS c
       FROM listings_current lc
       LEFT JOIN temp_listings tl
         ON tl.token_mint_addr = lc.token_mint_addr
       WHERE lc.version_id = ? AND tl.token_mint_addr IS NULL;`,
                )
                .get(activeVersionId) as { c: number }
        ).c | 0;

    const total =
        (
            db.raw.prepare("SELECT COUNT(*) AS c FROM temp_listings").get() as {
                c: number;
            }
        ).c | 0;

    return { inserted, updated, deleted, total };
}

export function createInactiveVersion(total: number): number {
    db.raw
        .prepare(
            `INSERT INTO listing_versions (created_at, total, active) VALUES (unixepoch('now'), ?, 0)`,
        ) // inactive
        .run(total);
    const row = db.raw.prepare("SELECT last_insert_rowid() AS id").get() as {
        id: number;
    };
    return row.id;
}

export function insertSnapshotFromTemp(newVersionId: number): number {
    const res = db.raw
        .prepare(
            `INSERT INTO listings_current
         (version_id, token_mint_addr, token_num, price, seller, image_url, listing_source, created_at)
       SELECT ?, token_mint_addr, token_num, price, seller, image_url, listing_source, unixepoch('now')
       FROM temp_listings`,
        )
        .run(newVersionId);
    return res.changes | 0;
}

export function activateVersion(newVersionId: number): void {
    db.exec("BEGIN IMMEDIATE");
    try {
        db.raw
            .prepare("UPDATE listing_versions SET active = 0 WHERE active = 1")
            .run();
        db.raw
            .prepare("UPDATE listing_versions SET active = 1 WHERE id = ?")
            .run(newVersionId);
        db.exec("COMMIT");
    } catch (e) {
        db.exec("ROLLBACK");
        throw e;
    }
}

export function cleanupNonActive(newVersionId: number): void {
    db.raw
        .prepare("DELETE FROM listings_current WHERE version_id <> ?")
        .run(newVersionId);
    db.raw.prepare("DELETE FROM listing_versions WHERE active = 0").run();
}

export function deleteVersionCascade(versionId: number): void {
    // listings_current rows will be removed via ON DELETE CASCADE
    db.raw.prepare("DELETE FROM listing_versions WHERE id = ?").run(versionId);
}
