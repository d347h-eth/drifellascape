import {
    HttpFetchRetryableStatusError,
    type HttpFetchAttemptCompleteContext,
    type HttpFetchRetryScheduledContext,
} from "@drifellascape/shared/network/http-fetch-resilience";
import { logger } from "@drifellascape/shared/utils/logger";
import { workerMetrics } from "./observability.js";

export type ExternalApiProvider = "magic_eden" | "helius";

export type ExternalApiRequestContext = {
    provider: ExternalApiProvider;
    endpoint: string;
    method: "GET" | "POST";
};

type RequestMetricLabels = {
    provider: string;
    endpoint: string;
    method: string;
    result: string;
    status_code: string;
    status_class: string;
    error_class: string;
};

export function recordExternalApiAttempt(
    context: ExternalApiRequestContext,
    attempt: HttpFetchAttemptCompleteContext,
): void {
    const labels = requestLabels(context, attempt);
    const metrics = workerMetrics();
    metrics.increment("external_api.request", 1, labels);
    metrics.histogram(
        "external_api.request.duration_ms",
        attempt.durationMs,
        labels,
    );
    if (attempt.response?.status === 429) {
        metrics.increment("external_api.rate_limited", 1, labels);
    }
}

export function recordExternalApiRetryScheduled(
    context: ExternalApiRequestContext,
    retry: HttpFetchRetryScheduledContext,
): void {
    const labels = {
        provider: context.provider,
        endpoint: context.endpoint,
        method: context.method,
        error_class: errorClass(retry.error),
        next_attempt: String(retry.nextAttempt),
    };
    const metrics = workerMetrics();
    metrics.increment("external_api.retry_scheduled", 1, labels);
    metrics.histogram("external_api.retry_delay_ms", retry.delayMs, labels);
    logger.warn("External API retry scheduled", {
        component: "ExternalApi",
        action: "retry_scheduled",
        provider: context.provider,
        endpoint: context.endpoint,
        method: context.method,
        attempt: retry.attempt,
        nextAttempt: retry.nextAttempt,
        delayMs: retry.delayMs,
        errorClass: errorClass(retry.error),
        error: errorMessage(retry.error),
    });
}

export function recordExternalApiLogicalError(
    context: ExternalApiRequestContext,
    error: unknown,
): void {
    workerMetrics().increment("external_api.logical_error", 1, {
        provider: context.provider,
        endpoint: context.endpoint,
        method: context.method,
        error_class: errorClass(error),
    });
}

export function recordExternalApiRateLimiterWait(
    provider: ExternalApiProvider,
    waitMs: number,
): void {
    if (waitMs <= 0) return;
    workerMetrics().histogram("external_api.rate_limiter.wait_ms", waitMs, {
        provider,
    });
}

export function errorClass(error: unknown): string {
    if (error instanceof HttpFetchRetryableStatusError) {
        return `HTTP_${error.status}`;
    }
    if (error instanceof Error && error.name) return error.name;
    return "UnknownError";
}

function requestLabels(
    context: ExternalApiRequestContext,
    attempt: HttpFetchAttemptCompleteContext,
): RequestMetricLabels {
    const status = attempt.response?.status;
    const result =
        status === undefined
            ? "error"
            : attempt.response?.ok
              ? "success"
              : "http_error";
    return {
        provider: context.provider,
        endpoint: context.endpoint,
        method: context.method,
        result,
        status_code: status === undefined ? "none" : String(status),
        status_class: statusClass(status),
        error_class: attempt.error ? errorClass(attempt.error) : "none",
    };
}

function statusClass(status: number | undefined): string {
    if (status === undefined) return "network_error";
    return `${Math.floor(status / 100)}xx`;
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}
