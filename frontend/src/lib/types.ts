export type ListingTrait = {
  type_id: number;
  type_name: string;
  spatial_group: string | null;
  purpose_class: string | null;
  value_id: number;
  value: string;
};

export type ListingRow = {
  token_mint_addr: string;
  token_num: number | null;
  price: number;
  seller: string;
  image_url: string;
  listing_source: string;
  token_id: number;
  token_name: string | null;
  traits?: ListingTrait[];
};

export type ApiResponse = {
  versionId: number;
  total: number;
  offset: number;
  limit: number;
  sort: string;
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
};

