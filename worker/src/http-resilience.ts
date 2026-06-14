import type { HttpFetchResilienceConfig } from "@drifellascape/shared/network/http-fetch-resilience";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 2_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 8_000;

export function getWorkerHttpFetchResilienceConfig(): HttpFetchResilienceConfig {
    return {
        requestTimeoutMs: envInt(
            "COMMON_HTTP_FETCH_TIMEOUT_MS",
            DEFAULT_REQUEST_TIMEOUT_MS,
            1,
            Number.MAX_SAFE_INTEGER,
        ),
        retryPolicy: {
            maxAttempts: envInt(
                "COMMON_HTTP_FETCH_RETRY_MAX_ATTEMPTS",
                DEFAULT_RETRY_MAX_ATTEMPTS,
                1,
                20,
            ),
            baseDelayMs: envInt(
                "COMMON_HTTP_FETCH_RETRY_BASE_DELAY_MS",
                DEFAULT_RETRY_BASE_DELAY_MS,
                0,
                Number.MAX_SAFE_INTEGER,
            ),
            maxDelayMs: envInt(
                "COMMON_HTTP_FETCH_RETRY_MAX_DELAY_MS",
                DEFAULT_RETRY_MAX_DELAY_MS,
                0,
                Number.MAX_SAFE_INTEGER,
            ),
        },
    };
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
