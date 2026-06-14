import {
    initRuntimeMetrics,
    noopMetrics,
    type Metrics,
    type RuntimeMetricsHandle,
} from "@drifellascape/shared/observability/metrics";

const SERVICE_NAME = "drifellascape";
const WORKER_NAME = "sync-worker";
const DEFAULT_METRICS_PORT = 42841;

let metrics: Metrics = noopMetrics;
let metricsHandle: RuntimeMetricsHandle | null = null;

export async function initWorkerObservability(): Promise<RuntimeMetricsHandle> {
    metricsHandle = await initRuntimeMetrics({
        enabled: envFlag("WORKER_METRICS_ENABLED", false),
        host: process.env.WORKER_METRICS_HOST || "127.0.0.1",
        port: envInt("WORKER_METRICS_PORT", DEFAULT_METRICS_PORT, 1, 65535),
        prefix: "drifellascape_worker_",
        service: SERVICE_NAME,
        worker: WORKER_NAME,
        logComponent: "WorkerMetrics",
    });
    metrics = metricsHandle.metrics;
    return metricsHandle;
}

export function workerMetrics(): Metrics {
    return metrics;
}

export async function stopWorkerObservability(): Promise<void> {
    await metricsHandle?.stop();
    metricsHandle = null;
    metrics = noopMetrics;
}

function envFlag(name: string, fallback: boolean): boolean {
    const raw = process.env[name];
    if (raw === undefined || raw === "") return fallback;
    return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function envInt(
    name: string,
    fallback: number,
    min: number,
    max: number,
): number {
    const raw = process.env[name];
    const parsed = raw ? Number(raw) : NaN;
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(parsed)));
}
