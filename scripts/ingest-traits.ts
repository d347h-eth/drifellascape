import { promises as fs } from "node:fs";
import path from "node:path";
import { db, initializeDatabase } from "@drifellascape/database";

// Paths
const LOGS_DIR = path.resolve(process.cwd(), "logs");
const LOG_FILE = path.join(LOGS_DIR, "traits-ingest.log");
const CSV_PATH = path.resolve(process.cwd(), "logs", "mint_to_image.csv");
const METADATA_DIR = path.resolve(process.cwd(), "metadata");

type TokenTraits = {
    token_num: number;
    token_mint_addr: string;
    name: string | null;
    image_url: string;
    traits: Array<{ type: string; value: string }>;
};

async function ensureLogsDir(): Promise<void> {
    await fs.mkdir(LOGS_DIR, { recursive: true });
}

async function logLine(message: string): Promise<void> {
    try {
        await ensureLogsDir();
        await fs.appendFile(
            LOG_FILE,
            `[${new Date().toISOString()}] ${message}\n`,
            "utf8",
        );
    } catch {
        // ignore
    }
}

function parseCsvLine(line: string): [string, string] | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("token_mint_addr")) return null; // header or blank
    // Handle quoted pair: "mint","image"
    const m = trimmed.match(/^"([^"]*)","([^"]*)"$/);
    if (m) return [m[1], m[2]];
    // Fallback: simple split by first comma
    const idx = trimmed.indexOf(",");
    if (idx === -1) return null;
    const left = trimmed.slice(0, idx).replace(/^"|"$/g, "");
    const right = trimmed.slice(idx + 1).replace(/^"|"$/g, "");
    return [left, right];
}

async function loadMintToImageMap(): Promise<Map<string, string>> {
    const map = new Map<string, string>(); // image_url -> token_mint_addr
    const buf = await fs.readFile(CSV_PATH, "utf8");
    const lines = buf.split(/\r?\n/);
    for (const line of lines) {
        const parsed = parseCsvLine(line);
        if (!parsed) continue;
        const [mint, image] = parsed;
        if (mint && image) {
            map.set(image, mint);
        }
    }
    return map;
}

async function readJson(filePath: string): Promise<any | null> {
    try {
        const raw = await fs.readFile(filePath, "utf8");
        return JSON.parse(raw);
    } catch (e: any) {
        if (e && e.code === "ENOENT") return null;
        throw e;
    }
}

async function collectTokens(mapImageToMint: Map<string, string>): Promise<{
    tokens: TokenTraits[];
    missingMap: number;
    missingFiles: number;
}> {
    const tokens: TokenTraits[] = [];
    let missingMap = 0;
    let missingFiles = 0;

    const START = 0;
    const END = 1332; // inclusive
    for (let id = START; id <= END; id++) {
        const file = path.join(METADATA_DIR, `${id}.json`);
        const json = await readJson(file);
        if (!json) {
            missingFiles++;
            await logLine(
                `Missing metadata file: ${path.relative(process.cwd(), file)}`,
            );
            continue;
        }
        const image: string | undefined =
            json.image || json.properties?.files?.[0]?.uri;
        const name: string | undefined = json.name;
        if (!image) {
            await logLine(`No image URL in metadata ${id}.json`);
            continue;
        }
        const mint = mapImageToMint.get(image);
        if (!mint) {
            missingMap++;
            await logLine(
                `No mint mapping for image in metadata ${id}.json: ${image}`,
            );
            continue;
        }
        const attributes: any[] = Array.isArray(json.attributes)
            ? json.attributes
            : [];
        const pairs: Array<{ type: string; value: string }> = [];
        for (const a of attributes) {
            const t = a?.trait_type;
            const v = a?.value;
            if (typeof t === "string" && typeof v === "string") {
                pairs.push({ type: t.trim(), value: v.trim() });
            }
        }
        tokens.push({
            token_num: id,
            token_mint_addr: mint,
            name: typeof name === "string" ? name : null,
            image_url: image,
            traits: pairs,
        });
    }

    return { tokens, missingMap, missingFiles };
}

function upsertTokensAndTraits(tokens: TokenTraits[]) {
    const insertToken = db.raw.prepare(
        `INSERT INTO tokens (token_mint_addr, token_num, name, image_url)
         VALUES (@token_mint_addr, @token_num, @name, @image_url)
         ON CONFLICT(token_mint_addr) DO UPDATE SET
           token_num=excluded.token_num,
           name=excluded.name,
           image_url=excluded.image_url`,
    );
    const selectTokenId = db.raw.prepare(
        `SELECT id FROM tokens WHERE token_mint_addr = ?`,
    );

    const insertType = db.raw.prepare(
        `INSERT OR IGNORE INTO trait_types (name) VALUES (?)`,
    );
    const selectTypeId = db.raw.prepare(
        `SELECT id FROM trait_types WHERE name = ?`,
    );

    const insertValue = db.raw.prepare(
        `INSERT OR IGNORE INTO trait_values (value) VALUES (?)`,
    );
    const selectValueId = db.raw.prepare(
        `SELECT id FROM trait_values WHERE value = ?`,
    );

    const insertTypeValue = db.raw.prepare(
        `INSERT OR IGNORE INTO trait_types_values (type_id, value_id) VALUES (?, ?)`,
    );

    const upsertTokenTrait = db.raw.prepare(
        `INSERT INTO token_traits (token_id, type_id, value_id)
         VALUES (?, ?, ?)
         ON CONFLICT(token_id, type_id) DO UPDATE SET value_id=excluded.value_id`,
    );

    // 1) Ensure all trait types and values exist
    const typeIdMap = new Map<string, number>();
    const valueIdMap = new Map<string, Map<string, number>>();

    // Collect unique types/values
    const uniqueTypes = new Set<string>();
    const valuesByType = new Map<string, Set<string>>();
    for (const t of tokens) {
        for (const { type, value } of t.traits) {
            uniqueTypes.add(type);
            let set = valuesByType.get(type);
            if (!set) {
                set = new Set<string>();
                valuesByType.set(type, set);
            }
            set.add(value);
        }
    }

    // Insert and map type ids
    for (const typeName of uniqueTypes) {
        insertType.run(typeName);
        const row = selectTypeId.get(typeName) as { id: number } | undefined;
        if (!row?.id)
            throw new Error(`Failed to resolve type id for '${typeName}'`);
        typeIdMap.set(typeName, row.id);
    }

    // Insert and map value ids
    for (const [typeName, set] of valuesByType) {
        const typeId = typeIdMap.get(typeName)!;
        const inner = new Map<string, number>();
        valueIdMap.set(typeName, inner);
        for (const value of set) {
            insertValue.run(value);
            const row = selectValueId.get(value) as { id: number } | undefined;
            if (!row?.id)
                throw new Error(
                    `Failed to resolve value id for value='${value}'`,
                );
            insertTypeValue.run(typeId, row.id);
            inner.set(value, row.id);
        }
    }

    // 2) Upsert tokens and their trait mappings
    for (const t of tokens) {
        insertToken.run({
            token_mint_addr: t.token_mint_addr,
            token_num: t.token_num,
            name: t.name,
            image_url: t.image_url,
        });
        const tok = selectTokenId.get(t.token_mint_addr) as
            | { id: number }
            | undefined;
        if (!tok?.id)
            throw new Error(
                `Failed to resolve token id for ${t.token_mint_addr}`,
            );
        for (const { type, value } of t.traits) {
            const typeId = typeIdMap.get(type)!;
            const valueId = valueIdMap.get(type)!.get(value)!;
            upsertTokenTrait.run(tok.id, typeId, valueId);
        }
    }

    // 3) Recompute counts (exact; idempotent)
    db.exec(
        `UPDATE trait_values
         SET tokens_with_value = (
           SELECT COUNT(DISTINCT token_id) FROM token_traits tt WHERE tt.value_id = trait_values.id
         )`,
    );
    db.exec(
        `UPDATE trait_types
         SET tokens_with_type = (
           SELECT COUNT(DISTINCT token_id) FROM token_traits tt WHERE tt.type_id = trait_types.id
         )`,
    );
    db.exec(
        `UPDATE trait_types_values AS tv
         SET tokens_with_type_value = (
           SELECT COUNT(DISTINCT token_id) FROM token_traits tt
           WHERE tt.type_id = tv.type_id AND tt.value_id = tv.value_id
         )`,
    );
}

async function main() {
    await initializeDatabase();
    await logLine("Traits ingest started");

    const map = await loadMintToImageMap();
    await logLine(`Loaded CSV mappings: ${map.size}`);

    const { tokens, missingMap, missingFiles } = await collectTokens(map);
    await logLine(
        `Collected tokens=${tokens.length}, missingFiles=${missingFiles}, missingMap=${missingMap}`,
    );

    const tx = db.raw.transaction((rows: TokenTraits[]) => {
        upsertTokensAndTraits(rows);
    });
    tx(tokens);

    await logLine("Traits ingest finished successfully");
    // eslint-disable-next-line no-console
    console.log(
        `Ingested ${tokens.length} tokens. Missing files: ${missingFiles}. Missing mappings: ${missingMap}.`,
    );
}

// Run if invoked directly
main().catch(async (err) => {
    await logLine(`Fatal error: ${String((err as any)?.message || err)}`);
    // eslint-disable-next-line no-console
    console.error("Fatal error:", err);
    process.exit(1);
});
