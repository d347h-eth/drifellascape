import { promises as fs } from "node:fs";
import path from "node:path";
import { fetchAllListings } from "./fetcher.js";
import { syncListings } from "./sync.js";

const LOGS_DIR = path.resolve(process.cwd(), "logs");
const WORKER_LOG = path.join(LOGS_DIR, "worker.log");

async function ensureLogsDir(): Promise<void> {
    await fs.mkdir(LOGS_DIR, { recursive: true });
}

async function logLine(message: string): Promise<void> {
    try {
        await ensureLogsDir();
        await fs.appendFile(
            WORKER_LOG,
            `[${new Date().toISOString()}] ${message}\n`,
            "utf8",
        );
    } catch {
        // non-fatal
    }
}

async function main() {
    const started = Date.now();
    await logLine("Worker run started");

    const res = await fetchAllListings();
    if (!res.ok) {
        await logLine(`Fetch failed: ${res.error}`);
        process.exitCode = 1;
        return;
    }

    const sync = await syncListings(res.listings);
    if (sync.changed) {
        const c = sync.counts!;
        await logLine(
            `Applied version ${sync.versionId} (ins=${c.inserted}, upd=${c.updated}, del=${c.deleted}, total=${c.total})`,
        );
    } else {
        const c = sync.counts!;
        await logLine(
            `No change (ins=${c.inserted}, upd=${c.updated}, del=${c.deleted}, total=${c.total})`,
        );
    }

    const tookMs = Date.now() - started;
    await logLine(`Worker run finished in ${tookMs}ms`);
}

// Run once
main().catch(async (err) => {
    await logLine(`Fatal worker error: ${String((err as any)?.message || err)}`);
    process.exit(1);
});

