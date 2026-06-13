import { promises as fs } from "node:fs";
import path from "node:path";
import { db, initializeDatabase } from "@drifellascape/database";

type CsvRow = {
    group: string;
    type_id: number;
    type_name: string;
    // order_index: string; // ignored
    category: string;
};

function splitCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                // escaped quote
                cur += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === "," && !inQuotes) {
            out.push(cur);
            cur = "";
        } else {
            cur += ch;
        }
    }
    out.push(cur);
    return out.map((s) => s.trim().replace(/^"|"$/g, ""));
}

async function readCsv(file: string): Promise<CsvRow[]> {
    const buf = await fs.readFile(file, "utf8");
    const lines = buf.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return [];
    const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
    const idx = {
        group: header.indexOf("group"),
        type_id: header.indexOf("type_id"),
        type_name: header.indexOf("type_name"),
        order_index: header.indexOf("order_index"),
        category: header.indexOf("category"),
    };
    const required = ["group", "type_id", "type_name", "category"] as const;
    for (const k of required) {
        if ((idx as any)[k] === -1) {
            throw new Error(`CSV missing required column: ${k}`);
        }
    }
    const rows: CsvRow[] = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = splitCsvLine(lines[i]);
        const typeIdStr = cols[idx.type_id] ?? "";
        const type_id = Number(typeIdStr);
        if (!Number.isFinite(type_id)) continue;
        const row: CsvRow = {
            group: cols[idx.group] ?? "",
            type_id,
            type_name: cols[idx.type_name] ?? "",
            category: cols[idx.category] ?? "",
        };
        rows.push(row);
    }
    return rows;
}

async function main() {
    await initializeDatabase();
    const csvPath = path.resolve(process.cwd(), "logs", "trait_groups.csv");
    const rows = await readCsv(csvPath);
    if (rows.length === 0) {
        console.log("No rows found in logs/trait_groups.csv");
        return;
    }

    const updateStmt = db.raw.prepare(
        `UPDATE trait_types
     SET name = ?, spatial_group = ?, purpose_class = ?
     WHERE id = ?`,
    );

    const txn = db.raw.transaction((batch: CsvRow[]) => {
        for (const r of batch) {
            updateStmt.run(r.type_name, r.group, r.category, r.type_id);
        }
    });

    txn(rows);
    console.log(
        `Updated ${rows.length} trait_types rows from trait_groups.csv`,
    );
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
