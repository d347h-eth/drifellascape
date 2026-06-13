import { readFileSync } from "node:fs";
import path from "node:path";
import { initializeDatabase } from "@drifellascape/database";
import {
    activateOwnershipVersion,
    cleanupNonActiveOwnership,
    countOwnershipDiffs,
    createInactiveOwnershipVersion,
    createTempOwnershipTable,
    deleteOwnershipVersionCascade,
    dropTempOwnershipTable,
    ensureActiveOwnershipVersionId,
    ensureOwnershipSyncState,
    insertOwnershipSnapshotFromTemp,
    loadTempOwnershipRows,
    markOwnershipSyncAttempt,
    markOwnershipSyncFailure,
    markOwnershipSyncSuccess,
} from "./repo.js";
import type {
    NormalizedListing,
    NormalizedOwnership,
    OwnershipSyncResult,
} from "./types.js";

const HELIUS_RPC_URL = "https://mainnet.helius-rpc.com/";
const DRIFELLA_COLLECTION_GROUP =
    "ArqtvxDZ1nfWgnGiHYCFTLj4FSVuyf7tmkAetQ9SScyQ";
const HELIUS_PAGE_LIMIT = 1000;
const DEFAULT_OWNERSHIP_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const MIN_OWNERSHIP_SYNC_INTERVAL_MS = 60 * 1000;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const REQ_TIMEOUT_MS = 30000;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getOwnershipIntervalMs(): number {
    const raw = process.env.DRIFELLASCAPE_OWNERSHIP_SYNC_INTERVAL_MS;
    const parsed = raw ? Number(raw) : NaN;
    if (!Number.isFinite(parsed)) return DEFAULT_OWNERSHIP_SYNC_INTERVAL_MS;
    return Math.max(MIN_OWNERSHIP_SYNC_INTERVAL_MS, Math.floor(parsed));
}

function readEnvFileKey(): string | null {
    try {
        const envPath = path.resolve(process.cwd(), ".env");
        const raw = readFileSync(envPath, "utf8");
        for (const line of raw.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const idx = trimmed.indexOf("=");
            if (idx <= 0) continue;
            const key = trimmed.slice(0, idx).trim();
            if (key !== "HELIUS_KEY" && key !== "DRIFELLASCAPE_HELIUS_KEY")
                continue;
            const value = trimmed
                .slice(idx + 1)
                .trim()
                .replace(/^['"]|['"]$/g, "");
            if (value) return value;
        }
    } catch {
        // Optional local convenience only.
    }
    return null;
}

function getHeliusKey(): string | null {
    const raw =
        process.env.HELIUS_KEY ||
        process.env.DRIFELLASCAPE_HELIUS_KEY ||
        readEnvFileKey();
    return raw && raw.trim().length > 0 ? raw.trim() : null;
}

type HeliusAsset = {
    id?: unknown;
    ownership?: {
        owner?: unknown;
    };
};

function normalizeHeliusAsset(item: HeliusAsset): {
    token_mint_addr: string;
    onchain_owner: string;
} | null {
    const mint = item?.id;
    const owner = item?.ownership?.owner;
    if (!mint || typeof mint !== "string" || mint.length > 44) return null;
    if (!owner || typeof owner !== "string" || owner.length > 44) return null;
    return { token_mint_addr: mint, onchain_owner: owner };
}

async function fetchHeliusPage(
    apiKey: string,
    page: number,
): Promise<{
    rows: { token_mint_addr: string; onchain_owner: string }[];
    skipped: number;
}> {
    const url = new URL(HELIUS_RPC_URL);
    url.searchParams.set("api-key", apiKey);
    const body = {
        jsonrpc: "2.0",
        id: `drifella-ownership-${page}`,
        method: "getAssetsByGroup",
        params: {
            groupKey: "collection",
            groupValue: DRIFELLA_COLLECTION_GROUP,
            page,
            limit: HELIUS_PAGE_LIMIT,
        },
    };

    let backoff = INITIAL_BACKOFF_MS;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQ_TIMEOUT_MS);
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            clearTimeout(timer);
            const text = await res.text();
            if (!res.ok) {
                const msg = `Helius HTTP ${res.status} ${res.statusText} ${text.slice(0, 200)}`;
                if (res.status === 429 || res.status >= 500) {
                    lastErr = new Error(msg);
                } else {
                    throw new Error(msg);
                }
            } else {
                const json = JSON.parse(text) as any;
                if (json.error) {
                    throw new Error(
                        `Helius JSON-RPC ${json.error.code}: ${json.error.message}`,
                    );
                }
                const items = json?.result?.items;
                if (!Array.isArray(items)) {
                    throw new Error("Helius response missing result.items");
                }
                const rows: {
                    token_mint_addr: string;
                    onchain_owner: string;
                }[] = [];
                let skipped = 0;
                for (const item of items) {
                    const normalized = normalizeHeliusAsset(item);
                    if (normalized) rows.push(normalized);
                    else skipped += 1;
                }
                return { rows, skipped };
            }
        } catch (err) {
            clearTimeout(timer);
            lastErr = err;
        }
        if (attempt < MAX_RETRIES) {
            await sleep(backoff);
            backoff *= 2;
        }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function fetchAllHeliusOwnership(apiKey: string): Promise<{
    rows: { token_mint_addr: string; onchain_owner: string }[];
    pages: number;
    skipped: number;
}> {
    const all: { token_mint_addr: string; onchain_owner: string }[] = [];
    let skipped = 0;
    let pages = 0;
    for (let page = 1; ; page++) {
        const result = await fetchHeliusPage(apiKey, page);
        pages += 1;
        all.push(...result.rows);
        skipped += result.skipped;
        if (result.rows.length + result.skipped < HELIUS_PAGE_LIMIT) break;
        await sleep(500);
    }
    return { rows: all, pages, skipped };
}

export function mergeOwnershipRows(
    heliusRows: { token_mint_addr: string; onchain_owner: string }[],
    listings: NormalizedListing[],
): NormalizedOwnership[] {
    const listedOwners = new Map<string, string>();
    for (const listing of listings) {
        listedOwners.set(listing.token_mint_addr, listing.seller);
    }
    const byMint = new Map<string, NormalizedOwnership>();
    for (const row of heliusRows) {
        const listed_owner = listedOwners.get(row.token_mint_addr);
        byMint.set(row.token_mint_addr, {
            token_mint_addr: row.token_mint_addr,
            onchain_owner: row.onchain_owner,
            listed_owner,
            owner: listed_owner ?? row.onchain_owner,
        });
    }
    return Array.from(byMint.values());
}

export function syncOwnershipRows(
    rows: NormalizedOwnership[],
): OwnershipSyncResult {
    const activeId = ensureActiveOwnershipVersionId();
    createTempOwnershipTable();
    try {
        loadTempOwnershipRows(rows);
        const counts = countOwnershipDiffs(activeId);
        if (counts.inserted + counts.updated + counts.deleted === 0) {
            return { changed: false, counts };
        }
        const newVersionId = createInactiveOwnershipVersion(counts.total);
        const inserted = insertOwnershipSnapshotFromTemp(newVersionId);
        if (inserted !== counts.total) {
            deleteOwnershipVersionCascade(newVersionId);
            throw new Error(
                `Ownership snapshot insert mismatch: expected ${counts.total}, inserted ${inserted}`,
            );
        }
        activateOwnershipVersion(newVersionId);
        cleanupNonActiveOwnership(newVersionId);
        return { changed: true, versionId: newVersionId, counts };
    } finally {
        dropTempOwnershipTable();
    }
}

export async function syncOwnershipIfDue(
    listings: NormalizedListing[],
): Promise<OwnershipSyncResult> {
    await initializeDatabase();
    const apiKey = getHeliusKey();
    if (!apiKey) {
        return { changed: false, skipped: true, reason: "missing_key" };
    }

    const intervalMs = getOwnershipIntervalMs();
    const state = ensureOwnershipSyncState();
    const nowMs = Date.now();
    const lastAttemptMs = state.lastAttemptAt * 1000;
    const nextRunAt = lastAttemptMs + intervalMs;
    if (lastAttemptMs > 0 && nowMs < nextRunAt) {
        return {
            changed: false,
            skipped: true,
            reason: "interval",
            nextRunInMs: nextRunAt - nowMs,
        };
    }

    markOwnershipSyncAttempt();
    try {
        const fetched = await fetchAllHeliusOwnership(apiKey);
        const rows = mergeOwnershipRows(fetched.rows, listings);
        const sync = syncOwnershipRows(rows);
        markOwnershipSyncSuccess();
        return {
            ...sync,
            fetched: rows.length,
            pages: fetched.pages,
            skippedRows: fetched.skipped,
        };
    } catch (err) {
        markOwnershipSyncFailure(String((err as any)?.message || err));
        throw err;
    }
}
