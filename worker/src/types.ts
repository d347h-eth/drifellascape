export type NormalizedListing = {
    token_mint_addr: string; // canonical SPL mint address
    token_num?: number; // optional numeric display index (e.g., from name)
    price: number; // integer: SOL raw amount with 9 decimals
    seller: string;
    image_url: string;
    listing_source: string;
};

export type SyncResult = {
    changed: boolean;
    versionId?: number;
    counts?: {
        inserted: number;
        updated: number;
        deleted: number;
        total: number;
    };
};

export const PRICE_EPSILON = 10_000_000; // 0.01 SOL in raw units

export type NormalizedOwnership = {
    token_mint_addr: string;
    owner: string;
    onchain_owner: string;
    listed_owner?: string;
};

export type OwnershipSyncResult = {
    changed: boolean;
    skipped?: boolean;
    reason?: "missing_key" | "interval";
    versionId?: number;
    counts?: {
        inserted: number;
        updated: number;
        deleted: number;
        total: number;
    };
    fetched?: number;
    pages?: number;
    skippedRows?: number;
    nextRunInMs?: number;
};

export type MarketEventType = "listing" | "sale";

export type NormalizedMarketEvent = {
    event_type: MarketEventType;
    signature: string;
    source: string;
    slot: number;
    block_time: number;
    token_mint_addr: string;
    price: number; // integer: SOL raw amount with 9 decimals
    seller?: string;
    buyer?: string;
    image_url?: string;
};
