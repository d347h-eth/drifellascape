import { db } from "@drifellascape/database";
import type { ListingRow, ListingsSnapshot, TraitFilterGroup, EnrichedListingRow, ListingTrait, TokenRow, EnrichedTokenRow } from "./types.js";

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

function sortSql(sort: string | undefined): string {
    return sort === "price_desc" ? "ORDER BY lc.price DESC" : "ORDER BY lc.price ASC";
}

function sortTokensSql(sort: string | undefined): string {
    return sort === "token_desc" ? "ORDER BY t.token_num DESC" : "ORDER BY t.token_num ASC";
}

export function searchListingsByValues(
    valueIds: number[],
    sort: string,
    offset: number,
    limit: number,
): { versionId: number; total: number; items: (ListingRow & { token_id: number; token_name: string | null })[] } {
    const tx = db.raw.transaction(() => {
        const row = db.raw
            .prepare("SELECT id FROM listing_versions WHERE active = 1 LIMIT 1")
            .get() as { id?: number } | undefined;
        if (!row?.id) throw new Error("No active version in listing_versions");
        const vid = row.id;

        if (!valueIds || valueIds.length === 0) {
            const countRow = db.raw
                .prepare("SELECT COUNT(*) AS c FROM listings_current WHERE version_id = ?")
                .get(vid) as { c: number };
            const items = db.raw
                .prepare(
                    `SELECT lc.token_mint_addr, lc.token_num, lc.price, lc.seller, lc.image_url, lc.listing_source,
                            t.id AS token_id, t.name AS token_name
                     FROM listings_current lc
                     JOIN tokens t ON t.token_mint_addr = lc.token_mint_addr
                     WHERE lc.version_id = ? ${sortSql(sort)}
                     LIMIT ? OFFSET ?`,
                )
                .all(vid, limit, offset) as (ListingRow & { token_id: number; token_name: string | null })[];
            return { versionId: vid, total: countRow.c, items };
        }

        const ph = valueIds.map(() => "?").join(",");
        const havingN = valueIds.length;
        const paramsBase = [...valueIds, vid];

        const countSql = `
          SELECT COUNT(*) AS c
          FROM listings_current lc
          JOIN tokens t ON t.token_mint_addr = lc.token_mint_addr
          JOIN (
            SELECT token_id FROM token_traits
            WHERE value_id IN (${ph}) AND value_id <> 217
            GROUP BY token_id
            HAVING COUNT(DISTINCT value_id) = ${havingN}
          ) ft ON ft.token_id = t.id
          WHERE lc.version_id = ?`;
        const countRow = db.raw.prepare(countSql).get(...paramsBase) as { c: number };

        const itemsSql = `
          SELECT lc.token_mint_addr, lc.token_num, lc.price, lc.seller, lc.image_url, lc.listing_source,
                 t.id AS token_id, t.name AS token_name
          FROM listings_current lc
          JOIN tokens t ON t.token_mint_addr = lc.token_mint_addr
          JOIN (
            SELECT token_id FROM token_traits
            WHERE value_id IN (${ph}) AND value_id <> 217
            GROUP BY token_id
            HAVING COUNT(DISTINCT value_id) = ${havingN}
          ) ft ON ft.token_id = t.id
          WHERE lc.version_id = ?
          ${sortSql(sort)}
          LIMIT ? OFFSET ?`;
        const items = db.raw
            .prepare(itemsSql)
            .all(...paramsBase, limit, offset) as (ListingRow & { token_id: number; token_name: string | null })[];
        return { versionId: vid, total: countRow.c, items };
    });
    return tx();
}

export function searchListingsByTraits(
    groups: TraitFilterGroup[],
    sort: string,
    offset: number,
    limit: number,
): { versionId: number; total: number; items: (ListingRow & { token_id: number; token_name: string | null })[] } {
    // Sanitize: drop empty value arrays
    const g = (groups || []).map((x) => ({
        typeId: Number(x.typeId),
        valueIds: (x.valueIds || []).map((v) => Number(v)).filter((v) => Number.isFinite(v)),
    })).filter((x) => Number.isFinite(x.typeId) && x.valueIds.length > 0);

    const tx = db.raw.transaction(() => {
        const row = db.raw
            .prepare("SELECT id FROM listing_versions WHERE active = 1 LIMIT 1")
            .get() as { id?: number } | undefined;
        if (!row?.id) throw new Error("No active version in listing_versions");
        const vid = row.id;

        if (g.length === 0) {
            const countRow = db.raw
                .prepare("SELECT COUNT(*) AS c FROM listings_current WHERE version_id = ?")
                .get(vid) as { c: number };
            const items = db.raw
                .prepare(
                    `SELECT lc.token_mint_addr, lc.token_num, lc.price, lc.seller, lc.image_url, lc.listing_source,
                            t.id AS token_id, t.name AS token_name
                     FROM listings_current lc
                     JOIN tokens t ON t.token_mint_addr = lc.token_mint_addr
                     WHERE lc.version_id = ? ${sortSql(sort)}
                     LIMIT ? OFFSET ?`,
                )
                .all(vid, limit, offset) as (ListingRow & { token_id: number; token_name: string | null })[];
            return { versionId: vid, total: countRow.c, items };
        }

        // Build OR-of-ANDs for selected type groups
        const whereParts: string[] = [];
        const paramsCore: any[] = [];
        for (const gr of g) {
            const phVals = gr.valueIds.map(() => "?").join(",");
            whereParts.push(`(type_id = ? AND value_id IN (${phVals}))`);
            paramsCore.push(gr.typeId, ...gr.valueIds);
        }
        const whereUnion = whereParts.join(" OR ");
        const needDistinctTypes = g.length;

        const countSql = `
          SELECT COUNT(*) AS c
          FROM listings_current lc
          JOIN tokens t ON t.token_mint_addr = lc.token_mint_addr
          JOIN (
            SELECT token_id FROM token_traits
            WHERE (${whereUnion}) AND value_id <> 217
            GROUP BY token_id
            HAVING COUNT(DISTINCT type_id) = ${needDistinctTypes}
          ) ft ON ft.token_id = t.id
          WHERE lc.version_id = ?`;

        const countRow = db.raw.prepare(countSql).get(...paramsCore, vid) as { c: number };

        const itemsSql = `
          SELECT lc.token_mint_addr, lc.token_num, lc.price, lc.seller, lc.image_url, lc.listing_source,
                 t.id AS token_id, t.name AS token_name
          FROM listings_current lc
          JOIN tokens t ON t.token_mint_addr = lc.token_mint_addr
          JOIN (
            SELECT token_id FROM token_traits
            WHERE (${whereUnion}) AND value_id <> 217
            GROUP BY token_id
            HAVING COUNT(DISTINCT type_id) = ${needDistinctTypes}
          ) ft ON ft.token_id = t.id
          WHERE lc.version_id = ?
          ${sortSql(sort)}
          LIMIT ? OFFSET ?`;
        const items = db.raw
            .prepare(itemsSql)
            .all(...paramsCore, vid, limit, offset) as (ListingRow & { token_id: number; token_name: string | null })[];
        return { versionId: vid, total: countRow.c, items };
    });
    return tx();
}

export function attachTraits(
    items: (ListingRow & { token_id: number; token_name: string | null })[],
): EnrichedListingRow[] {
    return attachTraitsGeneric(items) as EnrichedListingRow[];
}

export function attachTraitsGeneric<T extends { token_id: number }>(
    items: T[],
): (T & { traits: ListingTrait[] })[] {
    if (!items.length) return [] as any;
    const tokenIds = Array.from(new Set(items.map((it) => it.token_id)));
    const ph = tokenIds.map(() => "?").join(",");
    const traitRows = db.raw
        .prepare(
            `SELECT tt.token_id, tt.type_id, ty.name AS type_name, ty.spatial_group, ty.purpose_class,
                    tt.value_id, tv.value
             FROM token_traits tt
             JOIN trait_types ty ON ty.id = tt.type_id
             JOIN trait_values tv ON tv.id = tt.value_id
             WHERE tt.token_id IN (${ph}) AND tt.value_id <> 217`,
        )
        .all(...tokenIds) as Array<{ token_id: number } & ListingTrait>;
    const byToken = new Map<number, ListingTrait[]>();
    for (const r of traitRows) {
        let arr = byToken.get(r.token_id);
        if (!arr) { arr = []; byToken.set(r.token_id, arr); }
        arr.push({
            type_id: r.type_id,
            type_name: r.type_name,
            spatial_group: r.spatial_group ?? null,
            purpose_class: r.purpose_class ?? null,
            value_id: r.value_id,
            value: r.value,
        });
    }
    return items.map((it) => ({ ...it, traits: byToken.get(it.token_id) ?? [] }));
}

// --- Tokens (static) search ---
export function searchTokensByValues(
    valueIds: number[],
    sort: string,
    offset: number,
    limit: number,
): { total: number; items: (TokenRow & { token_id: number; token_name: string | null })[] } {
    const tx = db.raw.transaction(() => {
        if (!valueIds || valueIds.length === 0) {
            const countRow = db.raw
                .prepare("SELECT COUNT(*) AS c FROM tokens")
                .get() as { c: number };
            const items = db.raw
                .prepare(
                    `SELECT t.token_mint_addr, t.token_num, t.image_url,
                            t.id AS token_id, t.name AS token_name
                     FROM tokens t
                     ${sortTokensSql(sort)}
                     LIMIT ? OFFSET ?`,
                )
                .all(limit, offset) as (TokenRow & { token_id: number; token_name: string | null })[];
            return { total: countRow.c, items };
        }

        const ph = valueIds.map(() => "?").join(",");
        const havingN = valueIds.length;
        const paramsBase = [...valueIds];

        const countSql = `
          SELECT COUNT(*) AS c
          FROM tokens t
          JOIN (
            SELECT token_id FROM token_traits
            WHERE value_id IN (${ph}) AND value_id <> 217
            GROUP BY token_id
            HAVING COUNT(DISTINCT value_id) = ${havingN}
          ) ft ON ft.token_id = t.id`;
        const countRow = db.raw.prepare(countSql).get(...paramsBase) as { c: number };

        const itemsSql = `
          SELECT t.token_mint_addr, t.token_num, t.image_url,
                 t.id AS token_id, t.name AS token_name
          FROM tokens t
          JOIN (
            SELECT token_id FROM token_traits
            WHERE value_id IN (${ph}) AND value_id <> 217
            GROUP BY token_id
            HAVING COUNT(DISTINCT value_id) = ${havingN}
          ) ft ON ft.token_id = t.id
          ${sortTokensSql(sort)}
          LIMIT ? OFFSET ?`;
        const items = db.raw
            .prepare(itemsSql)
            .all(...paramsBase, limit, offset) as (TokenRow & { token_id: number; token_name: string | null })[];
        return { total: countRow.c, items };
    });
    return tx();
}

export function searchTokensByTraits(
    groups: TraitFilterGroup[],
    sort: string,
    offset: number,
    limit: number,
): { total: number; items: (TokenRow & { token_id: number; token_name: string | null })[] } {
    const g = (groups || []).map((x) => ({
        typeId: Number(x.typeId),
        valueIds: (x.valueIds || []).map((v) => Number(v)).filter((v) => Number.isFinite(v)),
    })).filter((x) => Number.isFinite(x.typeId) && x.valueIds.length > 0);

    const tx = db.raw.transaction(() => {
        if (g.length === 0) {
            const countRow = db.raw
                .prepare("SELECT COUNT(*) AS c FROM tokens")
                .get() as { c: number };
            const items = db.raw
                .prepare(
                    `SELECT t.token_mint_addr, t.token_num, t.image_url,
                            t.id AS token_id, t.name AS token_name
                     FROM tokens t
                     ${sortTokensSql(sort)}
                     LIMIT ? OFFSET ?`,
                )
                .all(limit, offset) as (TokenRow & { token_id: number; token_name: string | null })[];
            return { total: countRow.c, items };
        }

        const whereParts: string[] = [];
        const paramsCore: any[] = [];
        for (const gr of g) {
            const phVals = gr.valueIds.map(() => "?").join(",");
            whereParts.push(`(type_id = ? AND value_id IN (${phVals}))`);
            paramsCore.push(gr.typeId, ...gr.valueIds);
        }
        const whereUnion = whereParts.join(" OR ");
        const needDistinctTypes = g.length;

        const countSql = `
          SELECT COUNT(*) AS c
          FROM tokens t
          JOIN (
            SELECT token_id FROM token_traits
            WHERE (${whereUnion}) AND value_id <> 217
            GROUP BY token_id
            HAVING COUNT(DISTINCT type_id) = ${needDistinctTypes}
          ) ft ON ft.token_id = t.id`;
        const countRow = db.raw.prepare(countSql).get(...paramsCore) as { c: number };

        const itemsSql = `
          SELECT t.token_mint_addr, t.token_num, t.image_url,
                 t.id AS token_id, t.name AS token_name
          FROM tokens t
          JOIN (
            SELECT token_id FROM token_traits
            WHERE (${whereUnion}) AND value_id <> 217
            GROUP BY token_id
            HAVING COUNT(DISTINCT type_id) = ${needDistinctTypes}
          ) ft ON ft.token_id = t.id
          ${sortTokensSql(sort)}
          LIMIT ? OFFSET ?`;
        const items = db.raw
            .prepare(itemsSql)
            .all(...paramsCore, limit, offset) as (TokenRow & { token_id: number; token_name: string | null })[];
        return { total: countRow.c, items };
    });
    return tx();
}
