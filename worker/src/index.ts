import { promises as fs } from "node:fs";
import path from "node:path";
import { fetchAllListings } from "./fetcher.js";
import { syncMarketEvents } from "./market-events.js";
import { syncOwnershipIfDue } from "./ownership.js";
import { syncListings } from "./sync.js";

const LOGS_DIR = path.resolve(process.cwd(), "logs");
const WORKER_LOG = path.join(LOGS_DIR, "worker.log");
let ownershipMissingKeyLogged = false;

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

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getIntervalMs(): number {
    const raw = process.env.DRIFELLASCAPE_SYNC_INTERVAL_MS;
    const parsed = raw ? Number(raw) : NaN;
    const val = Number.isFinite(parsed) ? Math.max(5_000, parsed) : 30_000;
    return val;
}

async function runOnce(): Promise<void> {
    const started = Date.now();
    await logLine("Worker run started");
    const res = await fetchAllListings();
    if (!res.ok) {
        await logLine(`Fetch failed: ${res.error}`);
        return;
    }
    const sync = await syncListings(res.listings);
    if (sync.changed) {
        const c = sync.counts!;
        await logLine(
            `Applied version ${sync.versionId} (ins=${c.inserted}, upd=${c.updated}, del=${c.deleted}, total=${c.total}); pages=${res.pages}, skipped=${res.skipped}`,
        );
    } else {
        const c = sync.counts!;
        await logLine(
            `No change (ins=${c.inserted}, upd=${c.updated}, del=${c.deleted}, total=${c.total}); pages=${res.pages}, skipped=${res.skipped}`,
        );
    }
    try {
        const ownership = await syncOwnershipIfDue(res.listings);
        if (ownership.skipped) {
            if (
                ownership.reason === "missing_key" &&
                !ownershipMissingKeyLogged
            ) {
                ownershipMissingKeyLogged = true;
                await logLine("Ownership sync skipped: missing Helius API key");
            }
        } else if (ownership.changed) {
            const c = ownership.counts!;
            await logLine(
                `Ownership sync applied version ${ownership.versionId} (ins=${c.inserted}, upd=${c.updated}, del=${c.deleted}, total=${c.total}); pages=${ownership.pages}, fetched=${ownership.fetched}, skipped=${ownership.skippedRows}`,
            );
        } else {
            const c = ownership.counts!;
            await logLine(
                `Ownership sync no change (ins=${c.inserted}, upd=${c.updated}, del=${c.deleted}, total=${c.total}); pages=${ownership.pages}, fetched=${ownership.fetched}, skipped=${ownership.skippedRows}`,
            );
        }
    } catch (err) {
        await logLine(
            `Ownership sync failed: ${String((err as any)?.message || err)}`,
        );
    }
    try {
        const marketSummaries = await syncMarketEvents();
        for (const summary of marketSummaries) {
            await logLine(
                `Market ${summary.type} events: pages=${summary.pages}, fetched=${summary.fetched}, inserted=${summary.inserted}, skipped=${summary.skipped}, backfillOffset=${summary.backfillOffset}, backfillComplete=${summary.backfillComplete ? 1 : 0}`,
            );
        }
    } catch (err) {
        await logLine(
            `Market event sync failed: ${String((err as any)?.message || err)}`,
        );
    }
    const tookMs = Date.now() - started;
    await logLine(`Worker run finished in ${tookMs}ms`);
}

async function mainLoop() {
    const interval = getIntervalMs();
    await logLine(`Starting worker loop: interval=${interval}ms`);
    let running = true;
    const onStop = async (sig: string) => {
        running = false;
        await logLine(`Received ${sig}, stopping after current cycle...`);
    };
    process.on("SIGINT", () => void onStop("SIGINT"));
    process.on("SIGTERM", () => void onStop("SIGTERM"));

    while (running) {
        try {
            await runOnce();
        } catch (err) {
            await logLine(
                `Unhandled run error: ${String((err as any)?.message || err)}`,
            );
        }
        if (!running) break;
        await sleep(interval);
    }
    await logLine("Worker loop stopped");
}

// Start loop
mainLoop().catch(async (err) => {
    await logLine(
        `Fatal worker error: ${String((err as any)?.message || err)}`,
    );
    process.exit(1);
});
