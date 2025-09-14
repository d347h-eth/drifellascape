import { db } from "@drifellascape/database";
import type { ListingRow } from "./types.js";
import type { ListingsSnapshot } from "./types.js";

export function getActiveVersionId(): number | null {
    const row = db.raw
        .prepare("SELECT id FROM listing_versions WHERE active = 1 LIMIT 1")
        .get() as { id?: number } | undefined;
    return row?.id ?? null;
}

export function loadActiveSnapshotConsistent(): ListingsSnapshot {
    const getVid = db.raw.prepare(
        "SELECT id FROM listing_versions WHERE active = 1 LIMIT 1",
    );
    const getRows = db.raw.prepare(
        `SELECT token_mint_addr, token_num, price, seller, image_url, listing_source
         FROM listings_current
         WHERE version_id = ?`,
    );
    const tx = db.raw.transaction((): ListingsSnapshot => {
        const row = getVid.get() as { id?: number } | undefined;
        if (!row?.id) throw new Error("No active version in listing_versions");
        const items = getRows.all(row.id) as ListingRow[];
        return { versionId: row.id, items };
    });
    return tx();
}
