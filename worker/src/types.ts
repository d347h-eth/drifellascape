export type NormalizedListing = {
  token_id: number;
  price: number; // integer: SOL raw amount with 9 decimals
  seller: string;
  image_url: string;
  listing_source: string;
};

export type SyncResult = {
  changed: boolean;
  versionId?: number;
  counts?: { inserted: number; updated: number; deleted: number; total: number };
};

export const PRICE_EPSILON = 10_000_000; // 0.01 SOL in raw units

