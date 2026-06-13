import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { db, initializeDatabase, setDbPath } from "@drifellascape/database";
import { searchListingsByValues, searchTokensByValues } from "../src/repo.js";

async function createTempDbPath(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "drifellascape-test-"));
    return path.join(dir, "test.db");
}

const mintA = "Mint111111111111111111111111111111111111111";
const mintB = "Mint222222222222222222222222222222222222222";
const mintC = "Mint333333333333333333333333333333333333333";
const ownerA = "Owner1111111111111111111111111111111111111";
const ownerB = "Owner2222222222222222222222222222222222222";

function seedTokensAndOwnership() {
    const insertToken = db.raw.prepare(
        "INSERT INTO tokens (id, token_mint_addr, token_num, name, image_url) VALUES (?, ?, ?, ?, ?)",
    );
    insertToken.run(
        1,
        mintA,
        0,
        "Drifella III #0",
        "https://example.com/a.png",
    );
    insertToken.run(
        2,
        mintB,
        1,
        "Drifella III #1",
        "https://example.com/b.png",
    );
    insertToken.run(
        3,
        mintC,
        2,
        "Drifella III #2",
        "https://example.com/c.png",
    );

    const ownershipVersion = db.raw
        .prepare("SELECT id FROM ownership_versions WHERE active = 1 LIMIT 1")
        .get() as { id: number };
    const insertOwnership = db.raw.prepare(
        `INSERT INTO ownership_current
           (version_id, token_mint_addr, owner, onchain_owner, listed_owner, created_at)
         VALUES (?, ?, ?, ?, ?, unixepoch('now'))`,
    );
    insertOwnership.run(ownershipVersion.id, mintA, ownerA, ownerA, null);
    insertOwnership.run(ownershipVersion.id, mintB, ownerB, ownerB, null);
    insertOwnership.run(ownershipVersion.id, mintC, ownerA, ownerA, null);
}

function seedListings() {
    const listingVersion = db.raw
        .prepare("SELECT id FROM listing_versions WHERE active = 1 LIMIT 1")
        .get() as { id: number };
    const insertListing = db.raw.prepare(
        `INSERT INTO listings_current
           (version_id, token_mint_addr, token_num, price, seller, image_url, listing_source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch('now'))`,
    );
    insertListing.run(
        listingVersion.id,
        mintA,
        0,
        2_000_000_000,
        ownerA,
        "https://example.com/a.png",
        "M2",
    );
    insertListing.run(
        listingVersion.id,
        mintB,
        1,
        1_000_000_000,
        ownerB,
        "https://example.com/b.png",
        "M2",
    );
}

describe("owner-filtered search", () => {
    beforeEach(async () => {
        setDbPath(await createTempDbPath());
        await initializeDatabase();
        seedTokensAndOwnership();
        seedListings();
    });

    it("filters canon tokens by active ownership owner", () => {
        const result = searchTokensByValues(
            [],
            "token_asc",
            0,
            100,
            undefined,
            ownerA,
        );

        expect(result.total).toBe(2);
        expect(result.items.map((item) => item.token_mint_addr)).toEqual([
            mintA,
            mintC,
        ]);
        expect(result.items.map((item) => item.owner)).toEqual([
            ownerA,
            ownerA,
        ]);
    });

    it("filters active listings by active ownership owner", () => {
        const result = searchListingsByValues(
            [],
            "price_asc",
            0,
            100,
            undefined,
            ownerA,
        );

        expect(result.total).toBe(1);
        expect(result.items[0]).toMatchObject({
            token_mint_addr: mintA,
            owner: ownerA,
        });
    });
});
