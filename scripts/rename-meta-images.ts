#!/usr/bin/env ts-node
import fs from "node:fs/promises";
import path from "node:path";

const CSV_PATH = path.resolve("logs", "token_num_to_mint.csv");
const META_DIR = path.resolve("static", "meta");

async function ensureDir() {
    await fs.mkdir(META_DIR, { recursive: true });
}

async function renameMetaImages() {
    await ensureDir();
    const csvRaw = await fs.readFile(CSV_PATH, "utf8");
    const lines = csvRaw.trim().split(/\r?\n/);
    if (lines.length <= 1) {
        console.log("No rows found in CSV (beyond header).");
        return;
    }

    let renamed = 0;
    let missing = 0;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const [tokenNumRaw, tokenMint] = line.split(",");
        if (!tokenNumRaw || !tokenMint) continue;
        const tokenNum = tokenNumRaw.trim();
        const mint = tokenMint.trim();
        if (!tokenNum || !mint) continue;

        const source = path.join(META_DIR, `${mint}.jpg`);
        const target = path.join(META_DIR, `${tokenNum}.jpg`);

        try {
            await fs.access(source);
        } catch {
            console.warn(`Source missing for mint ${mint} -> ${source}`);
            missing++;
            continue;
        }

        await fs.rename(source, target);
        renamed++;
    }

    console.log(
        `Renamed ${renamed} file(s); ${missing} source image(s) missing.`,
    );
}

renameMetaImages().catch((error) => {
    console.error("Rename script failed:", error);
    process.exit(1);
});
