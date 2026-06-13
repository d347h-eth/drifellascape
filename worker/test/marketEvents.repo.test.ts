import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { initializeDatabase, setDbPath, db } from "@drifellascape/database";
import {
    ensureMarketEventSyncState,
    insertMarketEvents,
    updateMarketEventSyncState,
} from "../src/repo.js";
import type { NormalizedMarketEvent } from "../src/types.js";

async function createTempDbPath(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "drifellascape-test-"));
    return path.join(dir, "test.db");
}

const sale: NormalizedMarketEvent = {
    event_type: "sale",
    signature: "Sig111111111111111111111111111111111111111111",
    source: "magiceden_v2",
    slot: 10,
    block_time: 1_781_301_192,
    token_mint_addr: "Mint111111111111111111111111111111111111111",
    price: 2_981_400_000,
    seller: "Seller1111111111111111111111111111111111111",
    buyer: "Buyer11111111111111111111111111111111111111",
    image_url: "https://example.com/sale.png",
};

describe("market event repo", () => {
    beforeEach(async () => {
        setDbPath(await createTempDbPath());
        await initializeDatabase();
    });

    it("idempotently inserts market events", () => {
        expect(insertMarketEvents([sale])).toBe(1);
        expect(insertMarketEvents([sale])).toBe(0);

        const row = db.raw
            .prepare("SELECT event_type, price, buyer FROM market_events")
            .get() as { event_type: string; price: number; buyer: string };

        expect(row).toEqual({
            event_type: "sale",
            price: 2_981_400_000,
            buyer: sale.buyer,
        });
    });

    it("persists per-type backfill state", () => {
        expect(ensureMarketEventSyncState("listing")).toEqual({
            eventType: "listing",
            backfillOffset: 0,
            backfillComplete: false,
        });

        updateMarketEventSyncState("listing", 500, true);

        expect(ensureMarketEventSyncState("listing")).toEqual({
            eventType: "listing",
            backfillOffset: 500,
            backfillComplete: true,
        });
    });
});
