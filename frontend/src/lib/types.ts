export type ListingTrait = {
    type_id: number;
    type_name: string;
    spatial_group: string | null;
    purpose_class: string | null;
    value_id: number;
    value: string;
};

export type BaseRow = {
    token_mint_addr: string;
    token_num: number | null;
    image_url: string;
    token_id: number;
    token_name: string | null;
    traits?: ListingTrait[];
};

export type ListingRow = BaseRow & {
    price: number;
    seller: string;
    listing_source: string;
};

export type TokenRow = BaseRow;

export type Row = ListingRow | TokenRow;

export type DataSource = "listings" | "tokens";

export type ApiResponse<T> = {
    versionId: number | null;
    total: number;
    offset: number;
    limit: number;
    sort: string;
    items: T[];
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
    anchorMint?: string;
};

export type TraitCatalogValue = {
    value_id: number;
    value: string;
    tokens_with_type_value: number;
    rarity_pct: number;
};

export type TraitCatalogBucket = {
    type_id: number;
    type_name: string;
    spatial_group: string | null;
    purpose_class: string | null;
    tokens_with_type: number;
    values: TraitCatalogValue[];
};

export type TraitsCatalog = {
    total_tokens: number;
    buckets: TraitCatalogBucket[];
};
