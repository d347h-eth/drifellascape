export type ListingRow = {
    token_mint_addr: string;
    token_num: number | null;
    price: number; // integer raw units
    seller: string;
    image_url: string;
    listing_source: string;
};

export type ListingsSnapshot = {
    versionId: number;
    items: ListingRow[];
};

export type TraitFilterGroup = { typeId: number; valueIds: number[] };

export type ListingsSearchBody = {
    mode: "value" | "trait";
    valueIds?: number[];
    traits?: TraitFilterGroup[];
    sort?: "price_asc" | "price_desc" | string;
    offset?: number;
    limit?: number;
    includeTraits?: boolean;
    // Exclusive with `offset`: when provided, the server computes the page
    // so that this mint appears (centered when possible) and returns the
    // effective `offset` in the response. If both are provided, `anchorMint`
    // takes precedence and `offset` is ignored.
    anchorMint?: string;
};

export type ListingTrait = {
    type_id: number;
    type_name: string;
    spatial_group: string | null;
    purpose_class: string | null;
    value_id: number;
    value: string;
};

export type EnrichedListingRow = ListingRow & {
    token_id: number;
    token_name: string | null;
    traits?: ListingTrait[];
};

// Tokens (static canon dataset — no price/seller/source/version)
export type TokenRow = {
    token_mint_addr: string;
    token_num: number;
    image_url: string;
};

export type EnrichedTokenRow = TokenRow & {
    token_id: number;
    token_name: string | null;
    traits?: ListingTrait[];
};
