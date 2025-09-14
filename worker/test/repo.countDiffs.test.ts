import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import { initializeDatabase, setDbPath, db } from "@drifellascape/database";
import {
    ensureActiveVersionId,
    createTempTable,
    dropTempTable,
    loadTempRows,
    countDiffs,
} from "../src/repo.js";
import { PRICE_EPSILON, type NormalizedListing } from "../src/types.js";

async function createTempDbPath(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "drifellascape-test-"));
    return path.join(dir, "test.db");
}

async function seedActiveRows(rows: NormalizedListing[]): Promise<number> {
    const activeId = ensureActiveVersionId();
    const insert = db.raw.prepare(
        `INSERT INTO listings_current
         (version_id, token_mint_addr, token_num, price, seller, image_url, listing_source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch('now'))`,
    );
    const tx = db.raw.transaction((batch: NormalizedListing[]) => {
        for (const r of batch) {
            insert.run(
                activeId,
                r.token_mint_addr,
                r.token_num ?? null,
                r.price,
                r.seller,
                r.image_url,
                r.listing_source,
            );
        }
    });
    tx(rows);
    return activeId;
}

function tempStage(rows: NormalizedListing[]) {
    createTempTable();
    loadTempRows(rows);
}

describe("repo.countDiffs", () => {
    beforeEach(async () => {
        const dbPath = await createTempDbPath();
        setDbPath(dbPath);
        await initializeDatabase();
    });

    it("no-op when identical", async () => {
        const base: NormalizedListing[] = [
            {
                token_mint_addr: "Mint111111111111111111111111111111111111111",
                token_num: 1,
                price: 1_000_000_000,
                seller: "Seller1111111111111111111111111111111111111",
                image_url: "https://example.com/a.png",
                listing_source: "TENSOR_MARKETPLACE_LISTING",
            },
            {
                token_mint_addr: "Mint222222222222222222222222222222222222222",
                token_num: 2,
                price: 2_000_000_000,
                seller: "Seller2222222222222222222222222222222222222",
                image_url: "https://example.com/b.png",
                listing_source: "TENSOR_AMM",
            },
        ];

        const activeId = await seedActiveRows(base);
        tempStage(base);
        const diffs = countDiffs(activeId, PRICE_EPSILON);
        expect(diffs).toEqual({
            inserted: 0,
            updated: 0,
            deleted: 0,
            total: 2,
        });
        dropTempTable();
    });

    it("inserts only when base is empty", async () => {
        const temp: NormalizedListing[] = [
            {
                token_mint_addr: "Mint333333333333333333333333333333333333333",
                token_num: 3,
                price: 3_000_000_000,
                seller: "Seller3333333333333333333333333333333333333",
                image_url: "https://example.com/c.png",
                listing_source: "M2",
            },
        ];
        const activeId = ensureActiveVersionId();
        tempStage(temp);
        const diffs = countDiffs(activeId, PRICE_EPSILON);
        expect(diffs).toEqual({
            inserted: 1,
            updated: 0,
            deleted: 0,
            total: 1,
        });
        dropTempTable();
    });

    it("price change below epsilon is not an update", async () => {
        const base: NormalizedListing[] = [
            {
                token_mint_addr: "Mint444444444444444444444444444444444444444",
                token_num: 4,
                price: 1_000_000_000,
                seller: "Seller4444444444444444444444444444444444444",
                image_url: "https://example.com/d.png",
                listing_source: "TENSOR_AMM_V2",
            },
        ];
        const activeId = await seedActiveRows(base);
        const temp: NormalizedListing[] = [
            { ...base[0], price: base[0].price + (PRICE_EPSILON - 1) },
        ];
        tempStage(temp);
        const diffs = countDiffs(activeId, PRICE_EPSILON);
        expect(diffs).toEqual({
            inserted: 0,
            updated: 0,
            deleted: 0,
            total: 1,
        });
        dropTempTable();
    });

    it("price change at/over epsilon is an update", async () => {
        const base: NormalizedListing[] = [
            {
                token_mint_addr: "Mint555555555555555555555555555555555555555",
                token_num: 5,
                price: 1_000_000_000,
                seller: "Seller5555555555555555555555555555555555555",
                image_url: "https://example.com/e.png",
                listing_source: "MMM",
            },
        ];
        const activeId = await seedActiveRows(base);
        const temp: NormalizedListing[] = [
            { ...base[0], price: base[0].price + PRICE_EPSILON },
        ];
        tempStage(temp);
        const diffs = countDiffs(activeId, PRICE_EPSILON);
        expect(diffs).toEqual({
            inserted: 0,
            updated: 1,
            deleted: 0,
            total: 1,
        });
        dropTempTable();
    });

    it("deletes when base missing in temp", async () => {
        const base: NormalizedListing[] = [
            {
                token_mint_addr: "Mint666666666666666666666666666666666666666",
                token_num: 6,
                price: 1_000_000_000,
                seller: "Seller6666666666666666666666666666666666666",
                image_url: "https://example.com/f.png",
                listing_source: "M3",
            },
        ];
        const activeId = await seedActiveRows(base);
        tempStage([]);
        const diffs = countDiffs(activeId, PRICE_EPSILON);
        expect(diffs).toEqual({
            inserted: 0,
            updated: 0,
            deleted: 1,
            total: 0,
        });
        dropTempTable();
    });
});
