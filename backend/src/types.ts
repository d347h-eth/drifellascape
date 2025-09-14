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
