import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { db, initializeDatabase, setDbPath } from "@drifellascape/database";
import { mergeOwnershipRows, syncOwnershipRows } from "../src/ownership.js";
import type { NormalizedListing } from "../src/types.js";

async function createTempDbPath(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "drifellascape-test-"));
    return path.join(dir, "test.db");
}

const listedMint = "Mint111111111111111111111111111111111111111";
const unlistedMint = "Mint222222222222222222222222222222222222222";
const escrowOwner = "Escrow111111111111111111111111111111111111";
const sellerOwner = "Seller111111111111111111111111111111111111";
const holderOwner = "Holder222222222222222222222222222222222222";

function listingForListedMint(): NormalizedListing {
    return {
        token_mint_addr: listedMint,
        token_num: 0,
        price: 1_000_000_000,
        seller: sellerOwner,
        image_url: "https://example.com/listed.png",
        listing_source: "M2",
    };
}

describe("ownership snapshots", () => {
    beforeEach(async () => {
        setDbPath(await createTempDbPath());
        await initializeDatabase();
    });

    it("overlays active listing sellers and writes append-only snapshots", () => {
        const rows = mergeOwnershipRows(
            [
                { token_mint_addr: listedMint, onchain_owner: escrowOwner },
                { token_mint_addr: unlistedMint, onchain_owner: holderOwner },
            ],
            [listingForListedMint()],
        );

        expect(rows).toEqual([
            {
                token_mint_addr: listedMint,
                owner: sellerOwner,
                onchain_owner: escrowOwner,
                listed_owner: sellerOwner,
            },
            {
                token_mint_addr: unlistedMint,
                owner: holderOwner,
                onchain_owner: holderOwner,
                listed_owner: undefined,
            },
        ]);

        const first = syncOwnershipRows(rows);
        expect(first.changed).toBe(true);
        expect(first.counts).toEqual({
            inserted: 2,
            updated: 0,
            deleted: 0,
            total: 2,
        });

        const activeRows = db.raw
            .prepare(
                `SELECT token_mint_addr, owner, onchain_owner, listed_owner
                 FROM ownership_current
                 WHERE version_id = (SELECT id FROM ownership_versions WHERE active = 1)
                 ORDER BY token_mint_addr`,
            )
            .all();
        expect(activeRows).toEqual([
            {
                token_mint_addr: listedMint,
                owner: sellerOwner,
                onchain_owner: escrowOwner,
                listed_owner: sellerOwner,
            },
            {
                token_mint_addr: unlistedMint,
                owner: holderOwner,
                onchain_owner: holderOwner,
                listed_owner: null,
            },
        ]);

        const second = syncOwnershipRows(rows);
        expect(second.changed).toBe(false);
        expect(second.counts).toEqual({
            inserted: 0,
            updated: 0,
            deleted: 0,
            total: 2,
        });
    });
});
