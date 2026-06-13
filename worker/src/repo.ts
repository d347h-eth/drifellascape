import { db } from "@drifellascape/database";
import type {
    MarketEventType,
    NormalizedListing,
    NormalizedMarketEvent,
    NormalizedOwnership,
} from "./types.js";

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

export type MarketEventSyncState = {
    eventType: MarketEventType;
    backfillOffset: number;
    backfillComplete: boolean;
};

export function ensureMarketEventSyncState(
    eventType: MarketEventType,
): MarketEventSyncState {
    db.raw
        .prepare(
            `INSERT OR IGNORE INTO market_event_sync_state
               (event_type, backfill_offset, backfill_complete, updated_at)
             VALUES (?, 0, 0, unixepoch('now'))`,
        )
        .run(eventType);
    const row = db.raw
        .prepare(
            `SELECT backfill_offset, backfill_complete
             FROM market_event_sync_state
             WHERE event_type = ?`,
        )
        .get(eventType) as
        | { backfill_offset: number; backfill_complete: number }
        | undefined;
    if (!row) throw new Error(`Missing market event sync state: ${eventType}`);
    return {
        eventType,
        backfillOffset: row.backfill_offset,
        backfillComplete: row.backfill_complete === 1,
    };
}

export function updateMarketEventSyncState(
    eventType: MarketEventType,
    backfillOffset: number,
    backfillComplete: boolean,
): void {
    db.raw
        .prepare(
            `UPDATE market_event_sync_state
             SET backfill_offset = ?,
                 backfill_complete = ?,
                 updated_at = unixepoch('now')
             WHERE event_type = ?`,
        )
        .run(backfillOffset, backfillComplete ? 1 : 0, eventType);
}

export function insertMarketEvents(events: NormalizedMarketEvent[]): number {
    if (events.length === 0) return 0;
    const stmt = db.raw.prepare(
        `INSERT OR IGNORE INTO market_events
           (event_type, signature, source, slot, block_time, token_mint_addr,
            price, seller, buyer, image_url, created_at)
         VALUES
           (@event_type, @signature, @source, @slot, @block_time, @token_mint_addr,
            @price, @seller, @buyer, @image_url, unixepoch('now'))`,
    );
    let inserted = 0;
    const insertMany = db.raw.transaction((batch: NormalizedMarketEvent[]) => {
        for (const event of batch) {
            const res = stmt.run({
                ...event,
                seller: event.seller ?? null,
                buyer: event.buyer ?? null,
                image_url: event.image_url ?? null,
            });
            inserted += res.changes | 0;
        }
    });
    insertMany(events);
    return inserted;
}

export type OwnershipSyncState = {
    lastAttemptAt: number;
    lastSuccessAt: number;
    lastError: string | null;
};

export function ensureOwnershipSyncState(): OwnershipSyncState {
    db.raw
        .prepare(
            `INSERT OR IGNORE INTO ownership_sync_state
               (id, last_attempt_at, last_success_at, last_error)
             VALUES (1, 0, 0, NULL)`,
        )
        .run();
    const row = db.raw
        .prepare(
            `SELECT last_attempt_at, last_success_at, last_error
             FROM ownership_sync_state
             WHERE id = 1`,
        )
        .get() as
        | {
              last_attempt_at: number;
              last_success_at: number;
              last_error: string | null;
          }
        | undefined;
    if (!row) throw new Error("Missing ownership sync state");
    return {
        lastAttemptAt: row.last_attempt_at,
        lastSuccessAt: row.last_success_at,
        lastError: row.last_error ?? null,
    };
}

export function markOwnershipSyncAttempt(): void {
    db.raw
        .prepare(
            `UPDATE ownership_sync_state
             SET last_attempt_at = unixepoch('now')
             WHERE id = 1`,
        )
        .run();
}

export function markOwnershipSyncSuccess(): void {
    db.raw
        .prepare(
            `UPDATE ownership_sync_state
             SET last_success_at = unixepoch('now'),
                 last_error = NULL
             WHERE id = 1`,
        )
        .run();
}

export function markOwnershipSyncFailure(error: string): void {
    db.raw
        .prepare(
            `UPDATE ownership_sync_state
             SET last_error = ?
             WHERE id = 1`,
        )
        .run(error.slice(0, 500));
}

export function createTempOwnershipTable(): void {
    db.exec(`
    CREATE TEMP TABLE temp_ownership (
      token_mint_addr TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      onchain_owner TEXT NOT NULL,
      listed_owner TEXT
    ) WITHOUT ROWID;
  `);
}

export function dropTempOwnershipTable(): void {
    db.exec("DROP TABLE IF EXISTS temp_ownership;");
}

export function loadTempOwnershipRows(rows: NormalizedOwnership[]): void {
    const stmt = db.raw.prepare(
        `INSERT OR REPLACE INTO temp_ownership
           (token_mint_addr, owner, onchain_owner, listed_owner)
         VALUES
           (@token_mint_addr, @owner, @onchain_owner, @listed_owner)`,
    );
    const insertMany = db.raw.transaction((batch: NormalizedOwnership[]) => {
        for (const row of batch) {
            stmt.run({
                ...row,
                listed_owner: row.listed_owner ?? null,
            });
        }
    });
    insertMany(rows);
}

export function getActiveOwnershipVersionId(): number | null {
    const row = db.raw
        .prepare("SELECT id FROM ownership_versions WHERE active = 1 LIMIT 1")
        .get() as { id?: number } | undefined;
    return row?.id ?? null;
}

export function ensureActiveOwnershipVersionId(): number {
    const existingId = getActiveOwnershipVersionId();
    if (existingId) return existingId;
    db.raw
        .prepare(
            `INSERT INTO ownership_versions (created_at, total, active)
             VALUES (unixepoch('now'), 0, 1)`,
        )
        .run();
    const seededId = getActiveOwnershipVersionId();
    if (!seededId)
        throw new Error("Failed to seed active ownership_versions row");
    return seededId;
}

export function countOwnershipDiffs(activeVersionId: number): {
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
                     FROM temp_ownership tmp
                     LEFT JOIN ownership_current oc
                       ON oc.version_id = ? AND oc.token_mint_addr = tmp.token_mint_addr
                     WHERE oc.token_mint_addr IS NULL`,
                )
                .get(activeVersionId) as { c: number }
        ).c | 0;

    const updated =
        (
            db.raw
                .prepare(
                    `SELECT COUNT(*) AS c
                     FROM temp_ownership tmp
                     JOIN ownership_current oc
                       ON oc.version_id = ? AND oc.token_mint_addr = tmp.token_mint_addr
                     WHERE tmp.owner <> oc.owner
                        OR tmp.onchain_owner <> oc.onchain_owner
                        OR COALESCE(tmp.listed_owner, '') <> COALESCE(oc.listed_owner, '')`,
                )
                .get(activeVersionId) as { c: number }
        ).c | 0;

    const deleted =
        (
            db.raw
                .prepare(
                    `SELECT COUNT(*) AS c
                     FROM ownership_current oc
                     LEFT JOIN temp_ownership tmp
                       ON tmp.token_mint_addr = oc.token_mint_addr
                     WHERE oc.version_id = ? AND tmp.token_mint_addr IS NULL`,
                )
                .get(activeVersionId) as { c: number }
        ).c | 0;

    const total =
        (
            db.raw
                .prepare("SELECT COUNT(*) AS c FROM temp_ownership")
                .get() as { c: number }
        ).c | 0;

    return { inserted, updated, deleted, total };
}

export function createInactiveOwnershipVersion(total: number): number {
    db.raw
        .prepare(
            `INSERT INTO ownership_versions (created_at, total, active)
             VALUES (unixepoch('now'), ?, 0)`,
        )
        .run(total);
    const row = db.raw.prepare("SELECT last_insert_rowid() AS id").get() as {
        id: number;
    };
    return row.id;
}

export function insertOwnershipSnapshotFromTemp(newVersionId: number): number {
    const res = db.raw
        .prepare(
            `INSERT INTO ownership_current
               (version_id, token_mint_addr, owner, onchain_owner, listed_owner, created_at)
             SELECT ?, token_mint_addr, owner, onchain_owner, listed_owner, unixepoch('now')
             FROM temp_ownership`,
        )
        .run(newVersionId);
    return res.changes | 0;
}

export function activateOwnershipVersion(newVersionId: number): void {
    db.exec("BEGIN IMMEDIATE");
    try {
        db.raw
            .prepare(
                "UPDATE ownership_versions SET active = 0 WHERE active = 1",
            )
            .run();
        db.raw
            .prepare("UPDATE ownership_versions SET active = 1 WHERE id = ?")
            .run(newVersionId);
        db.exec("COMMIT");
    } catch (e) {
        db.exec("ROLLBACK");
        throw e;
    }
}

export function cleanupNonActiveOwnership(newVersionId: number): void {
    db.raw
        .prepare("DELETE FROM ownership_current WHERE version_id <> ?")
        .run(newVersionId);
    db.raw.prepare("DELETE FROM ownership_versions WHERE active = 0").run();
}

export function deleteOwnershipVersionCascade(versionId: number): void {
    db.raw
        .prepare("DELETE FROM ownership_versions WHERE id = ?")
        .run(versionId);
}
