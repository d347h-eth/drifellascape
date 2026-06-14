import { initializeDatabase } from "@drifellascape/database";
import { fetchMarketEventsPage, PAGE_LIMIT } from "./fetcher.js";
import {
    ensureMarketEventSyncState,
    insertMarketEvents,
    updateMarketEventSyncState,
} from "./repo.js";
import type { MarketEventType } from "./types.js";

const MARKET_EVENT_TYPES: MarketEventType[] = ["listing", "sale"];
const DEFAULT_RECENT_PAGES = 2;
const DEFAULT_BACKFILL_PAGES = 5;

export type MarketEventSyncSummary = {
    type: MarketEventType;
    pages: number;
    fetched: number;
    inserted: number;
    skipped: number;
    backfillOffset: number;
    backfillComplete: boolean;
};

function envInt(name: string, fallback: number, min: number, max: number) {
    const raw = process.env[name];
    const n = raw ? Number(raw) : NaN;
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(n)));
}

async function fetchAndInsert(type: MarketEventType, offset: number) {
    const page = await fetchMarketEventsPage(type, offset, PAGE_LIMIT);
    if (!page.ok) throw new Error(page.error);
    const inserted = insertMarketEvents(page.events);
    return {
        rawCount: page.rawCount,
        skipped: page.skipped,
        inserted,
        fetched: page.events.length,
    };
}

async function syncType(type: MarketEventType): Promise<MarketEventSyncSummary> {
    const recentPages = envInt(
        "MARKET_EVENT_RECENT_PAGES",
        DEFAULT_RECENT_PAGES,
        0,
        10,
    );
    const backfillPages = envInt(
        "MARKET_EVENT_BACKFILL_PAGES",
        DEFAULT_BACKFILL_PAGES,
        0,
        25,
    );

    let state = ensureMarketEventSyncState(type);
    let pages = 0;
    let fetched = 0;
    let inserted = 0;
    let skipped = 0;

    for (let pageIndex = 0; pageIndex < recentPages; pageIndex++) {
        const offset = pageIndex * PAGE_LIMIT;
        const page = await fetchAndInsert(type, offset);
        pages += 1;
        fetched += page.fetched;
        inserted += page.inserted;
        skipped += page.skipped;
        if (page.rawCount < PAGE_LIMIT) break;
        if (state.backfillComplete && page.inserted === 0) break;
    }

    if (!state.backfillComplete) {
        let backfillOffset = state.backfillOffset;
        let backfillComplete: boolean = state.backfillComplete;
        for (let pageIndex = 0; pageIndex < backfillPages; pageIndex++) {
            const page = await fetchAndInsert(type, backfillOffset);
            pages += 1;
            fetched += page.fetched;
            inserted += page.inserted;
            skipped += page.skipped;

            if (page.rawCount < PAGE_LIMIT) {
                backfillComplete = true;
                updateMarketEventSyncState(type, backfillOffset, true);
                break;
            }

            backfillOffset += PAGE_LIMIT;
            updateMarketEventSyncState(type, backfillOffset, false);
        }
        state = {
            eventType: type,
            backfillOffset,
            backfillComplete,
        };
    }

    return {
        type,
        pages,
        fetched,
        inserted,
        skipped,
        backfillOffset: state.backfillOffset,
        backfillComplete: state.backfillComplete,
    };
}

export async function syncMarketEvents(): Promise<MarketEventSyncSummary[]> {
    await initializeDatabase();
    const summaries: MarketEventSyncSummary[] = [];
    for (const type of MARKET_EVENT_TYPES) {
        summaries.push(await syncType(type));
    }
    return summaries;
}
