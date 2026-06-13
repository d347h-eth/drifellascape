import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { db, initializeDatabase, setDbPath } from "@drifellascape/database";
import { loadMarketEvents } from "../src/repo.js";

async function createTempDbPath(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "drifellascape-test-"));
    return path.join(dir, "test.db");
}

describe("loadMarketEvents", () => {
    beforeEach(async () => {
        setDbPath(await createTempDbPath());
        await initializeDatabase();
    });

    it("loads newest events with optional type filtering and token enrichment", () => {
        db.raw
            .prepare(
                "INSERT INTO tokens (id, token_mint_addr, token_num, name, image_url) VALUES (?, ?, ?, ?, ?)",
            )
            .run(
                1,
                "Mint111111111111111111111111111111111111111",
                920,
                "Drifella III #920",
                "https://example.com/token.png",
            );

        const insertEvent = db.raw.prepare(
            `INSERT INTO market_events
               (event_type, signature, source, slot, block_time, token_mint_addr,
                price, seller, buyer, image_url, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch('now'))`,
        );
        insertEvent.run(
            "listing",
            "SigList",
            "magiceden_v2",
            10,
            100,
            "Mint111111111111111111111111111111111111111",
            3_440_999_833,
            "Seller1111111111111111111111111111111111111",
            null,
            null,
        );
        insertEvent.run(
            "sale",
            "SigSale",
            "mmm",
            12,
            120,
            "Mint111111111111111111111111111111111111111",
            2_981_400_000,
            "Seller2222222222222222222222222222222222222",
            "Buyer22222222222222222222222222222222222222",
            "https://example.com/sale.png",
        );

        const all = loadMarketEvents("all", 0, 10);
        expect(all.total).toBe(2);
        expect(all.items.map((item) => item.event_type)).toEqual([
            "sale",
            "listing",
        ]);
        expect(all.items[0]).toMatchObject({
            token_num: 920,
            token_name: "Drifella III #920",
            image_url: "https://example.com/sale.png",
        });
        expect(all.items[1]).toMatchObject({
            image_url: "https://example.com/token.png",
        });

        const listings = loadMarketEvents("listing", 0, 10);
        expect(listings.total).toBe(1);
        expect(listings.items[0].signature).toBe("SigList");
    });
});
