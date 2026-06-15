import {
    initRuntimeMetrics,
    noopMetrics,
    type Metrics,
    type RuntimeMetricsHandle,
} from "@drifellascape/shared/observability/metrics";

const SERVICE_NAME = "drifellascape";
const WORKER_NAME = "backend-api";
const DEFAULT_METRICS_PORT = 42840;

let metrics: Metrics = noopMetrics;
let metricsHandle: RuntimeMetricsHandle | null = null;
let inflightRequests = 0;

export async function initBackendObservability(): Promise<RuntimeMetricsHandle> {
    metricsHandle = await initRuntimeMetrics({
        enabled: envFlag("BACKEND_METRICS_ENABLED", false),
        host: process.env.BACKEND_METRICS_HOST || "127.0.0.1",
        port: envInt("BACKEND_METRICS_PORT", DEFAULT_METRICS_PORT, 1, 65535),
        prefix: "drifellascape_backend_",
        service: SERVICE_NAME,
        worker: WORKER_NAME,
        logComponent: "BackendMetrics",
    });
    metrics = metricsHandle.metrics;
    return metricsHandle;
}

export function backendMetrics(): Metrics {
    return metrics;
}

export function recordHttpRequestStarted(): void {
    inflightRequests += 1;
    metrics.gauge("http.inflight.requests", inflightRequests);
}

export function recordHttpRequestFinished(args: {
    method: string;
    route: string;
    statusCode: number;
    durationMs: number;
}): void {
    inflightRequests = Math.max(0, inflightRequests - 1);
    metrics.gauge("http.inflight.requests", inflightRequests);
    const labels = {
        method: args.method,
        route: args.route,
        status_code: String(args.statusCode),
        status_class: `${Math.floor(args.statusCode / 100)}xx`,
    };
    metrics.increment("http.request", 1, labels);
    metrics.histogram("http.request.duration_ms", args.durationMs, labels);
}

export async function stopBackendObservability(): Promise<void> {
    await metricsHandle?.stop();
    metricsHandle = null;
    metrics = noopMetrics;
    inflightRequests = 0;
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
