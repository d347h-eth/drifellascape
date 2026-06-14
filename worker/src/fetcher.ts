import { fetchWithHttpResilience } from "@drifellascape/shared/network/http-fetch-resilience";
import { logger } from "@drifellascape/shared/utils/logger";
import {
    recordExternalApiAttempt,
    recordExternalApiRateLimiterWait,
    recordExternalApiRetryScheduled,
    type ExternalApiRequestContext,
} from "./external-api-observability.js";
import { getWorkerHttpFetchResilienceConfig } from "./http-resilience.js";
import type {
    MarketEventType,
    NormalizedListing,
    NormalizedMarketEvent,
} from "./types.js";

const COLLECTION = "drifella_iii";
const COLLECTION_BASE_URL = `https://api-mainnet.magiceden.dev/v2/collections/${COLLECTION}`;
const LISTINGS_URL = `${COLLECTION_BASE_URL}/listings`;
const ACTIVITIES_URL = `${COLLECTION_BASE_URL}/activities`;
export const PAGE_LIMIT = 100; // per API contract
const SOL_LAMPORTS = 1_000_000_000;

// Rate limits: <= 2 RPS and <= 120 RPM
const MIN_INTERVAL_MS = 500; // 2 per second
const MAX_PER_MINUTE = 120;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

class RateLimiter {
    private lastAt = 0;
    private window: number[] = [];

    async waitNext(): Promise<number> {
        let waitedMs = 0;
        const now = Date.now();
        const elapsed = now - this.lastAt;
        if (elapsed < MIN_INTERVAL_MS) {
            const wait = MIN_INTERVAL_MS - elapsed;
            await sleep(wait);
            waitedMs += wait;
        }
        // minute window control
        const now2 = Date.now();
        // keep only timestamps within last 60s
        this.window = this.window.filter((t) => now2 - t < 60_000);
        if (this.window.length >= MAX_PER_MINUTE) {
            const oldest = this.window[0];
            const wait = Math.max(0, 60_000 - (now2 - oldest));
            await sleep(wait);
            waitedMs += wait;
            // trim again after sleep
            const now3 = Date.now();
            this.window = this.window.filter((t) => now3 - t < 60_000);
        }
        this.lastAt = Date.now();
        this.window.push(this.lastAt);
        return waitedMs;
    }
}

const limiter = new RateLimiter();

async function fetchWithRetry(
    url: URL,
    context: ExternalApiRequestContext,
): Promise<any[]> {
    const res = await fetchWithHttpResilience({
        input: url,
        init: {
            method: "GET",
            headers: {
                accept: "application/json",
                "user-agent": "Drifellascape",
            },
        },
        fetchImpl: async (input, init) => {
            const waitedMs = await limiter.waitNext();
            recordExternalApiRateLimiterWait("magic_eden", waitedMs);
            return fetch(input, init);
        },
        config: getWorkerHttpFetchResilienceConfig(),
        onAttemptComplete: (attempt) =>
            recordExternalApiAttempt(context, attempt),
        onRetryScheduled: (retry) =>
            recordExternalApiRetryScheduled(context, retry),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(
            `HTTP ${res.status} ${res.statusText} ${body.slice(0, 200)}`,
        );
    }
    const data = (await res.json()) as any[];
    if (!Array.isArray(data)) {
        throw new Error("Expected array response");
    }
    return data;
}

function buildListingsUrl(offset: number, limit = PAGE_LIMIT): URL {
    const url = new URL(LISTINGS_URL);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("sort", "listPrice");
    url.searchParams.set("listingAggMode", "true");
    url.searchParams.set("sort_direction", "asc");
    return url;
}

function remoteActivityType(eventType: MarketEventType): "list" | "buyNow" {
    return eventType === "sale" ? "buyNow" : "list";
}

function buildActivitiesUrl(
    eventType: MarketEventType,
    offset: number,
    limit = PAGE_LIMIT,
): URL {
    const url = new URL(ACTIVITIES_URL);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("type", remoteActivityType(eventType));
    return url;
}

function parseTokenNum(name: unknown): number | undefined {
    if (typeof name !== "string") return undefined;
    const m = name.match(/#(\d+)/);
    if (!m) return undefined;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : undefined;
}

export function normalizeItem(item: any): NormalizedListing | null {
    const mint = item?.tokenMint;
    const seller = item?.seller;
    const raw = item?.priceInfo?.solPrice?.rawAmount;
    const image = item?.extra?.img;
    const source = item?.listingSource;
    const name = item?.token?.name;

    if (!mint || typeof mint !== "string") return null;
    if (!raw || typeof raw !== "string") return null;
    if (!seller || typeof seller !== "string") return null;
    if (!image || typeof image !== "string") return null;
    if (!source || typeof source !== "string") return null;

    // rawAmount is integer in string; convert to number (may exceed 2^53-1?)
    // For SOL 9 decimals, typical prices fit in JS number safely. If needed, switch to bigint later.
    const price = Number(raw);
    if (!Number.isFinite(price)) return null;

    return {
        token_mint_addr: mint,
        token_num: parseTokenNum(name),
        price,
        seller,
        image_url: image,
        listing_source: source,
    };
}

function normalizeActivityPrice(item: any): number | null {
    const price = item?.price;
    if (typeof price === "number" && Number.isFinite(price) && price >= 0) {
        return Math.round(price * SOL_LAMPORTS);
    }

    const raw = item?.priceInfo?.solPrice?.rawAmount;
    if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
    try {
        let amount = BigInt(raw);
        // Magic Eden activities currently return rawAmount at 1e18 scale while
        // listings return lamports. Store all prices as 1e9 SOL base units.
        if (amount > 1_000_000_000_000_000n) {
            amount = (amount + 500_000_000n) / 1_000_000_000n;
        }
        if (amount > BigInt(Number.MAX_SAFE_INTEGER)) return null;
        return Number(amount);
    } catch {
        return null;
    }
}

export function normalizeMarketEvent(
    item: any,
    eventType: MarketEventType,
): NormalizedMarketEvent | null {
    if (item?.type !== remoteActivityType(eventType)) return null;

    const signature = item?.signature;
    const source = item?.source;
    const tokenMint = item?.tokenMint;
    const slot = item?.slot;
    const blockTime = item?.blockTime;
    const seller = item?.seller;
    const buyer = item?.buyer;
    const image = item?.image;
    const price = normalizeActivityPrice(item);

    if (!signature || typeof signature !== "string") return null;
    if (!source || typeof source !== "string") return null;
    if (!tokenMint || typeof tokenMint !== "string") return null;
    if (!Number.isInteger(slot) || slot < 0) return null;
    if (!Number.isInteger(blockTime) || blockTime < 0) return null;
    if (price === null) return null;
    if (!seller || typeof seller !== "string") return null;
    if (eventType === "sale" && (!buyer || typeof buyer !== "string")) {
        return null;
    }

    return {
        event_type: eventType,
        signature,
        source,
        slot,
        block_time: blockTime,
        token_mint_addr: tokenMint,
        price,
        seller,
        buyer: typeof buyer === "string" ? buyer : undefined,
        image_url: typeof image === "string" ? image : undefined,
    };
}

export type FetchListingsResult =
    | {
          ok: true;
          listings: NormalizedListing[];
          pages: number;
          skipped: number;
      }
    | { ok: false; error: string };

export async function fetchAllListings(): Promise<FetchListingsResult> {
    const all: NormalizedListing[] = [];
    let skipped = 0;
    let offset = 0;
    let page = 0;
    try {
        for (;;) {
            const url = buildListingsUrl(offset, PAGE_LIMIT);
            const arr = await fetchWithRetry(url, {
                provider: "magic_eden",
                endpoint: "listings",
                method: "GET",
            });
            page += 1;
            for (const item of arr) {
                const norm = normalizeItem(item);
                if (!norm) {
                    skipped += 1;
                    continue;
                }
                all.push(norm);
            }
            if (arr.length < PAGE_LIMIT) break;
            offset += PAGE_LIMIT;
        }
        logger.info("Fetched listings", {
            component: "WorkerFetcher",
            action: "fetch_listings",
            pages: page,
            total: all.length,
            skipped,
        });
        return { ok: true, listings: all, pages: page, skipped };
    } catch (err) {
        const msg = `Fetch listings failed after page=${page}, offset=${offset}: ${String((err as any)?.message || err)}`;
        logger.error(msg, {
            component: "WorkerFetcher",
            action: "fetch_listings_failed",
            page,
            offset,
            error: String((err as any)?.message || err),
        });
        return { ok: false, error: msg };
    }
}

export type FetchMarketEventsPageResult =
    | {
          ok: true;
          eventType: MarketEventType;
          events: NormalizedMarketEvent[];
          rawCount: number;
          skipped: number;
      }
    | { ok: false; eventType: MarketEventType; error: string };

export async function fetchMarketEventsPage(
    eventType: MarketEventType,
    offset: number,
    limit = PAGE_LIMIT,
): Promise<FetchMarketEventsPageResult> {
    try {
        const url = buildActivitiesUrl(eventType, offset, limit);
        const arr = await fetchWithRetry(url, {
            provider: "magic_eden",
            endpoint: "activities",
            method: "GET",
        });
        const events: NormalizedMarketEvent[] = [];
        let skipped = 0;
        for (const item of arr) {
            const norm = normalizeMarketEvent(item, eventType);
            if (!norm) {
                skipped += 1;
                continue;
            }
            events.push(norm);
        }
        return {
            ok: true,
            eventType,
            events,
            rawCount: arr.length,
            skipped,
        };
    } catch (err) {
        const msg = `Fetch ${eventType} events failed at offset=${offset}: ${String((err as any)?.message || err)}`;
        logger.error(msg, {
            component: "WorkerFetcher",
            action: "fetch_market_events_failed",
            eventType,
            offset,
            error: String((err as any)?.message || err),
        });
        return { ok: false, eventType, error: msg };
    }
}
