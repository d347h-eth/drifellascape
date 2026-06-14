import { logger } from "@drifellascape/shared/utils/logger";
import { fetchAllListings } from "./fetcher.js";
import { syncMarketEvents } from "./market-events.js";
import {
    initWorkerObservability,
    stopWorkerObservability,
    workerMetrics,
} from "./observability.js";
import { syncOwnershipIfDue } from "./ownership.js";
import { syncListings } from "./sync.js";

let ownershipMissingKeyLogged = false;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getIntervalMs(): number {
    const raw = process.env.WORKER_SYNC_INTERVAL_MS;
    const parsed = raw ? Number(raw) : NaN;
    const val = Number.isFinite(parsed) ? Math.max(5_000, parsed) : 30_000;
    return val;
}

async function runOnce(): Promise<void> {
    const started = Date.now();
    let result = "success";
    logger.info("Worker run started", {
        component: "WorkerLoop",
        action: "run_started",
    });
    try {
        const res = await fetchAllListings();
        if (!res.ok) {
            result = "fetch_failed";
            logger.error("Fetch failed", {
                component: "WorkerLoop",
                action: "fetch_failed",
                error: res.error,
            });
            workerMetrics().increment("listings_sync.result", 1, {
                result: "fetch_failed",
            });
            return;
        }
        const sync = await syncListings(res.listings);
        if (sync.changed) {
            const c = sync.counts!;
            logger.info("Applied listing version", {
                component: "WorkerLoop",
                action: "listings_version_applied",
                versionId: sync.versionId,
                inserted: c.inserted,
                updated: c.updated,
                deleted: c.deleted,
                total: c.total,
                pages: res.pages,
                skipped: res.skipped,
            });
            workerMetrics().increment("listings_sync.result", 1, {
                result: "changed",
            });
            workerMetrics().gauge("listings.active_total", c.total);
        } else {
            const c = sync.counts!;
            logger.info("No listing change", {
                component: "WorkerLoop",
                action: "listings_no_change",
                inserted: c.inserted,
                updated: c.updated,
                deleted: c.deleted,
                total: c.total,
                pages: res.pages,
                skipped: res.skipped,
            });
            workerMetrics().increment("listings_sync.result", 1, {
                result: "no_change",
            });
            workerMetrics().gauge("listings.active_total", c.total);
        }
        try {
            const ownership = await syncOwnershipIfDue(res.listings);
            if (ownership.skipped) {
                if (
                    ownership.reason === "missing_key" &&
                    !ownershipMissingKeyLogged
                ) {
                    ownershipMissingKeyLogged = true;
                    logger.warn("Ownership sync skipped", {
                        component: "WorkerLoop",
                        action: "ownership_skipped",
                        reason: "missing_key",
                    });
                }
                workerMetrics().increment("ownership_sync.result", 1, {
                    result: ownership.reason ?? "skipped",
                });
            } else if (ownership.changed) {
                const c = ownership.counts!;
                logger.info("Ownership sync applied version", {
                    component: "WorkerLoop",
                    action: "ownership_version_applied",
                    versionId: ownership.versionId,
                    inserted: c.inserted,
                    updated: c.updated,
                    deleted: c.deleted,
                    total: c.total,
                    pages: ownership.pages,
                    fetched: ownership.fetched,
                    skipped: ownership.skippedRows,
                });
                workerMetrics().increment("ownership_sync.result", 1, {
                    result: "changed",
                });
            } else {
                const c = ownership.counts!;
                logger.info("Ownership sync no change", {
                    component: "WorkerLoop",
                    action: "ownership_no_change",
                    inserted: c.inserted,
                    updated: c.updated,
                    deleted: c.deleted,
                    total: c.total,
                    pages: ownership.pages,
                    fetched: ownership.fetched,
                    skipped: ownership.skippedRows,
                });
                workerMetrics().increment("ownership_sync.result", 1, {
                    result: "no_change",
                });
            }
        } catch (err) {
            result = "partial_failure";
            logger.error("Ownership sync failed", {
                component: "WorkerLoop",
                action: "ownership_failed",
                error: String((err as any)?.message || err),
            });
            workerMetrics().increment("ownership_sync.result", 1, {
                result: "failed",
            });
        }
        try {
            const marketSummaries = await syncMarketEvents();
            for (const summary of marketSummaries) {
                logger.info("Market events synced", {
                    component: "WorkerLoop",
                    action: "market_events_synced",
                    eventType: summary.type,
                    pages: summary.pages,
                    fetched: summary.fetched,
                    inserted: summary.inserted,
                    skipped: summary.skipped,
                    backfillOffset: summary.backfillOffset,
                    backfillComplete: summary.backfillComplete,
                });
                workerMetrics().increment("market_events_sync.result", 1, {
                    result: "success",
                    event_type: summary.type,
                });
                workerMetrics().gauge(
                    "market_events.backfill_offset",
                    summary.backfillOffset,
                    { event_type: summary.type },
                );
            }
        } catch (err) {
            result = "partial_failure";
            logger.error("Market event sync failed", {
                component: "WorkerLoop",
                action: "market_events_failed",
                error: String((err as any)?.message || err),
            });
            workerMetrics().increment("market_events_sync.result", 1, {
                result: "failed",
                event_type: "all",
            });
        }
    } finally {
        const tookMs = Date.now() - started;
        const nowSeconds = Math.floor(Date.now() / 1000);
        workerMetrics().increment("worker.run", 1, { result });
        workerMetrics().histogram("worker.run.duration_ms", tookMs, {
            result,
        });
        workerMetrics().gauge("worker.last_run_unix_seconds", nowSeconds);
        if (result === "success") {
            workerMetrics().gauge(
                "worker.last_success_unix_seconds",
                nowSeconds,
            );
        }
        logger.info("Worker run finished", {
            component: "WorkerLoop",
            action: "run_finished",
            result,
            durationMs: tookMs,
        });
    }
}

async function mainLoop() {
    await initWorkerObservability();
    const interval = getIntervalMs();
    logger.info("Starting worker loop", {
        component: "WorkerLoop",
        action: "loop_started",
        intervalMs: interval,
    });
    let running = true;
    const onStop = async (sig: string) => {
        running = false;
        logger.info("Stopping after current cycle", {
            component: "WorkerLoop",
            action: "stop_requested",
            signal: sig,
        });
    };
    process.on("SIGINT", () => void onStop("SIGINT"));
    process.on("SIGTERM", () => void onStop("SIGTERM"));

    while (running) {
        try {
            await runOnce();
        } catch (err) {
            logger.error("Unhandled run error", {
                component: "WorkerLoop",
                action: "run_unhandled_error",
                error: String((err as any)?.message || err),
            });
        }
        if (!running) break;
        await sleep(interval);
    }
    logger.info("Worker loop stopped", {
        component: "WorkerLoop",
        action: "loop_stopped",
    });
    await stopWorkerObservability();
}

// Start loop
mainLoop().catch(async (err) => {
    logger.error("Fatal worker error", {
        component: "WorkerLoop",
        action: "fatal_error",
        error: String((err as any)?.message || err),
    });
    await stopWorkerObservability();
    process.exit(1);
});
