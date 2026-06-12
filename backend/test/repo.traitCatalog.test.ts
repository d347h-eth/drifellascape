import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { db, initializeDatabase, setDbPath } from "@drifellascape/database";
import { loadTraitCatalog } from "../src/repo.js";

async function createTempDbPath(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "drifellascape-test-"));
    return path.join(dir, "test.db");
}

describe("loadTraitCatalog", () => {
    beforeEach(async () => {
        setDbPath(await createTempDbPath());
        await initializeDatabase();
    });

    it("returns all non-none type/value buckets with counts and rarity", () => {
        const seed = db.raw.transaction(() => {
            const insertToken = db.raw.prepare(
                "INSERT INTO tokens (id, token_mint_addr, token_num, name, image_url) VALUES (?, ?, ?, ?, ?)",
            );
            for (let i = 1; i <= 4; i++) {
                insertToken.run(
                    i,
                    `Mint${i.toString().padStart(40, "0")}`,
                    i - 1,
                    `Drifella III #${i - 1}`,
                    `https://example.com/${i}.png`,
                );
            }

            db.raw
                .prepare(
                    `INSERT INTO trait_types
                       (id, name, tokens_with_type, spatial_group, purpose_class)
                     VALUES (?, ?, ?, ?, ?)`,
                )
                .run(1, "Background", 4, "middle", "decor");
            db.raw
                .prepare(
                    `INSERT INTO trait_types
                       (id, name, tokens_with_type, spatial_group, purpose_class)
                     VALUES (?, ?, ?, ?, ?)`,
                )
                .run(2, "Eyes", 1, "left", "special");

            db.raw
                .prepare(
                    "INSERT INTO trait_values (id, value, tokens_with_value) VALUES (?, ?, ?)",
                )
                .run(10, "Blue", 3);
            db.raw
                .prepare(
                    "INSERT INTO trait_values (id, value, tokens_with_value) VALUES (?, ?, ?)",
                )
                .run(11, "Red", 1);
            db.raw
                .prepare(
                    "INSERT INTO trait_values (id, value, tokens_with_value) VALUES (?, ?, ?)",
                )
                .run(217, "None", 1);

            const insertTypeValue = db.raw.prepare(
                "INSERT INTO trait_types_values (type_id, value_id, tokens_with_type_value) VALUES (?, ?, ?)",
            );
            insertTypeValue.run(1, 10, 3);
            insertTypeValue.run(1, 11, 1);
            insertTypeValue.run(2, 217, 1);
        });
        seed();

        const catalog = loadTraitCatalog();

        expect(catalog.total_tokens).toBe(4);
        expect(catalog.buckets).toEqual([
            {
                type_id: 1,
                type_name: "Background",
                spatial_group: "middle",
                purpose_class: "decor",
                tokens_with_type: 4,
                values: [
                    {
                        value_id: 10,
                        value: "Blue",
                        tokens_with_type_value: 3,
                        rarity_pct: 75,
                    },
                    {
                        value_id: 11,
                        value: "Red",
                        tokens_with_type_value: 1,
                        rarity_pct: 25,
                    },
                ],
            },
        ]);
    });
});
