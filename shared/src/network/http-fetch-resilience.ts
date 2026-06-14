export type HttpFetchRetryPolicy = {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
};

export type HttpFetchResilienceConfig = {
    requestTimeoutMs: number;
    retryPolicy: HttpFetchRetryPolicy;
};

export type HttpFetchAttemptCompleteContext = {
    attempt: number;
    durationMs: number;
    response?: Response;
    error?: unknown;
};

export type HttpFetchRetryScheduledContext = {
    attempt: number;
    nextAttempt: number;
    delayMs: number;
    error: unknown;
};

export type FetchWithHttpResilienceOptions = {
    input: RequestInfo | URL;
    init?: RequestInit;
    config: HttpFetchResilienceConfig;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    onAttemptComplete?: (
        context: HttpFetchAttemptCompleteContext,
    ) => void | Promise<void>;
    onRetryScheduled?: (
        context: HttpFetchRetryScheduledContext,
    ) => void | Promise<void>;
};

const HTTP_FETCH_REQUEST_TIMEOUT_ERROR_MESSAGE = "HTTP request timed out";

export class HttpFetchRequestTimeoutError extends Error {
    constructor(timeoutMs: number, cause?: unknown) {
        super(`${HTTP_FETCH_REQUEST_TIMEOUT_ERROR_MESSAGE} after ${timeoutMs}ms`);
        this.name = "HttpFetchRequestTimeoutError";
        this.cause = cause;
    }
}

export class HttpFetchRetryableStatusError extends Error {
    constructor(readonly status: number) {
        super(`HTTP ${status}`);
        this.name = "HttpFetchRetryableStatusError";
    }
}

export async function fetchWithHttpResilience(
    options: FetchWithHttpResilienceOptions,
): Promise<Response> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const sleep = options.sleep ?? sleepMs;
    const maxAttempts = Math.max(1, options.config.retryPolicy.maxAttempts);
    let attempt = 1;

    for (;;) {
        const startedAt = Date.now();
        try {
            const response = await fetchWithHttpRequestTimeout(
                fetchImpl,
                options.input,
                options.init ?? {},
                options.config.requestTimeoutMs,
            );
            await options.onAttemptComplete?.({
                attempt,
                durationMs: Date.now() - startedAt,
                response,
            });
            if (isHttpFetchRetryableStatus(response.status)) {
                await response.body?.cancel().catch(() => undefined);
                throw new HttpFetchRetryableStatusError(response.status);
            }
            return response;
        } catch (error) {
            if (!(error instanceof HttpFetchRetryableStatusError)) {
                await options.onAttemptComplete?.({
                    attempt,
                    durationMs: Date.now() - startedAt,
                    error,
                });
            }
            if (
                attempt >= maxAttempts ||
                options.init?.signal?.aborted === true
            ) {
                throw error;
            }
            const delayMs = getHttpFetchRetryDelayMs(
                attempt,
                options.config.retryPolicy,
            );
            await options.onRetryScheduled?.({
                attempt,
                nextAttempt: attempt + 1,
                delayMs,
                error,
            });
            await sleep(delayMs);
            attempt += 1;
        }
    }
}

export async function fetchWithHttpRequestTimeout(
    fetchImpl: typeof fetch,
    input: RequestInfo | URL,
    init: RequestInit,
    timeoutMs: number,
): Promise<Response> {
    if (timeoutMs <= 0) {
        return fetchImpl(input, init);
    }

    const controller = new AbortController();
    const externalSignal = init.signal;
    const abortFromExternalSignal = () => controller.abort();
    if (externalSignal?.aborted) {
        controller.abort();
    } else {
        externalSignal?.addEventListener("abort", abortFromExternalSignal, {
            once: true,
        });
    }

    let didTimeout = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedInit = {
        ...init,
        signal: controller.signal,
    };
    const timeoutPromise = new Promise<Response>((_, reject) => {
        timeout = setTimeout(() => {
            didTimeout = true;
            controller.abort();
            reject(new HttpFetchRequestTimeoutError(timeoutMs));
        }, timeoutMs);
    });
    const fetchPromise = fetchImpl(input, timedInit);

    try {
        return await Promise.race([fetchPromise, timeoutPromise]);
    } catch (error) {
        if (didTimeout && !(error instanceof HttpFetchRequestTimeoutError)) {
            throw new HttpFetchRequestTimeoutError(timeoutMs, error);
        }
        throw error;
    } finally {
        externalSignal?.removeEventListener("abort", abortFromExternalSignal);
        if (timeout) clearTimeout(timeout);
    }
}

export function getHttpFetchRetryDelayMs(
    attempt: number,
    policy: HttpFetchRetryPolicy,
): number {
    const exp = Math.max(0, attempt - 1);
    const delay = policy.baseDelayMs * Math.pow(2, exp);
    return Math.min(delay, policy.maxDelayMs);
}

export function isHttpFetchRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
}

function sleepMs(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
