import type { DataSource, Row } from "./types";
import { buildSearchBody, postSearch } from "./search";

export type PageResult = {
    items: Row[];
    baseOffset: number;
    total: number;
    versionId: number | null;
};

export function dedupeAppend(existing: Row[], incoming: Row[]): Row[] {
    const have = new Set(existing.map((r) => r.token_mint_addr));
    return incoming.filter((r) => !have.has(r.token_mint_addr));
}

export function dedupePrepend(existing: Row[], incoming: Row[]): Row[] {
    const have = new Set(existing.map((r) => r.token_mint_addr));
    return incoming.filter((r) => !have.has(r.token_mint_addr));
}

export async function loadInitialPage(params: {
    source: DataSource;
    valueIds: number[];
    limit: number;
    includeTraits: boolean;
    anchorMint?: string;
    offset?: number;
}): Promise<PageResult> {
    const body = buildSearchBody({
        source: params.source,
        valueIds: params.valueIds,
        limit: params.limit,
        includeTraits: params.includeTraits,
        anchorMint: params.anchorMint,
        offset: params.offset ?? 0,
    });
    const data = await postSearch(params.source, body);
    return {
        items: data.items ?? [],
        baseOffset: Number(data.offset || 0),
        total: Number(data.total || 0),
        versionId: (data as any).versionId ?? null,
    };
}

export async function loadNextPage(params: {
    source: DataSource;
    valueIds: number[];
    limit: number;
    includeTraits: boolean;
    baseOffset: number;
    currentLength: number;
}): Promise<{ newItems: Row[]; newTotal: number }> {
    const offset = params.baseOffset + params.currentLength;
    const body = buildSearchBody({
        source: params.source,
        valueIds: params.valueIds,
        limit: params.limit,
        includeTraits: params.includeTraits,
        offset,
    });
    const data = await postSearch(params.source, body);
    return { newItems: data.items ?? [], newTotal: Number(data.total || 0) };
}

export async function loadPrevPage(params: {
    source: DataSource;
    valueIds: number[];
    limit: number;
    includeTraits: boolean;
    baseOffset: number;
}): Promise<{ newItems: Row[]; newBaseOffset: number } | null> {
    const newOffset = Math.max(0, params.baseOffset - params.limit);
    if (newOffset === params.baseOffset) return null;
    const body = buildSearchBody({
        source: params.source,
        valueIds: params.valueIds,
        limit: params.limit,
        includeTraits: params.includeTraits,
        offset: newOffset,
    });
    const data = await postSearch(params.source, body);
    return { newItems: data.items ?? [], newBaseOffset: newOffset };
}
