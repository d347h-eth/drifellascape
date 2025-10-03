import { writable } from "svelte/store";
import type { ApiResponse, DataSource, ListingsSearchBody, Row } from "./types";

const configuredBase = (import.meta as any).env?.VITE_API_BASE;
const API_BASE =
    typeof configuredBase === "string" && configuredBase.length > 0
        ? configuredBase
        : (typeof window === "undefined"
              ? "http://localhost:3000"
              : "");


export const pendingRequests = writable(0);

function incrementPending() { pendingRequests.update((n) => n + 1); }
function decrementPending() { pendingRequests.update((n) => (n > 0 ? n - 1 : 0)); }

export function defaultSortForSource(source: DataSource): string {
    return source === "tokens" ? "token_asc" : "price_asc";
}

// Single source of truth for default page size in search requests
export const DEFAULT_SEARCH_LIMIT = 50;

export type BuildParams = {
    source: DataSource;
    valueIds?: number[];
    traits?: { typeId: number; valueIds: number[] }[];
    includeTraits?: boolean;
    limit?: number;
    offset?: number; // used only when no anchorMint
    anchorMint?: string; // exclusive with offset
    mode?: "value" | "trait"; // optional override
    sort?: string; // optional override
};

export function buildSearchBody(p: BuildParams): ListingsSearchBody {
    const mode =
        p.mode ?? (p.traits && p.traits.length > 0 ? "trait" : "value");
    const includeTraits = p.includeTraits ?? true;
    const limit = p.limit ?? DEFAULT_SEARCH_LIMIT;
    const sort = (p.sort ?? defaultSortForSource(p.source)).toLowerCase();
    const body: any = { mode, includeTraits, limit, sort };
    if (mode === "trait") body.traits = p.traits ?? [];
    else body.valueIds = p.valueIds ?? [];
    if (p.anchorMint) body.anchorMint = p.anchorMint;
    else body.offset = p.offset ?? 0;
    return body as ListingsSearchBody;
}

export async function postSearch(
    source: DataSource,
    body: ListingsSearchBody,
): Promise<ApiResponse<Row>> {
    const path = source === "tokens" ? "/tokens/search" : "/listings/search";
    incrementPending();
    try {
        const res = await fetch(`${API_BASE}${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as ApiResponse<Row>;
    } finally {
        decrementPending();
    }
}
