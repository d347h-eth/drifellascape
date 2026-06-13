# API Reference — Listings

Base URL: `http://localhost:3000` in local backend dev, or `https://api.drifellascape.art` for the deployed API.

## GET /listings

Retrieve the current in‑memory snapshot of marketplace listings.

Query parameters:

- `offset` (int, default 0): starting index, `>= 0`
- `limit` (int, default 100): number of items, `1..200`
- `sort` (string, default `price_asc`): `price_asc` | `price_desc`

Response 200 (application/json):

```json
{
  "versionId": 123,
  "total": 100,
  "offset": 0,
  "limit": 50,
  "sort": "price_asc",
  "items": [
    {
      "token_mint_addr": "…",
      "token_num": 42,
      "price": 1799000000,
      "seller": "…",
      "image_url": "https://…",
      "listing_source": "TENSOR_MARKETPLACE_LISTING"
    }
  ]
}
```

Notes:

- `price` is an integer in raw SOL units (9 decimals).
- `versionId` changes only when a new snapshot is activated by the worker.
- Sorting applies to `price` only; `GET /listings` does not enforce a secondary tie-breaker.

Errors:

- 500 `{ "error": "message" }`

CORS:

- `Access-Control-Allow-Origin: *`

## POST /listings/search

Search listings from the active snapshot with DB‑side filtering. Returns enriched items (token + traits) by default.

Body (application/json):

- `mode` (string, required): `"value" | "trait"`
- `valueIds` (number[], optional): value‑based mode — list of `trait_values.id` to AND together (token must have all)
- `traits` (array, optional): trait‑based mode — list of `{ typeId: number, valueIds: number[] }`
  - AND across types; OR within each type’s `valueIds`
- `sort` (string, default `price_asc`): `price_asc` | `price_desc`
- `offset` (int, default 0), `limit` (int, default 100; max 200)
- `includeTraits` (bool, default true): include full traits per token
- `ownerAddress` (string, optional): filter to tokens whose active ownership snapshot has `owner = ownerAddress`
- `anchorMint` (string, optional): exclusive with `offset`. When provided, the server computes the page so that this mint appears (centered when possible) and returns the effective `offset` used in the response.

Response 200 (application/json):

```json
{
  "versionId": 123,
  "total": 51,
  "offset": 0,
  "limit": 100,
  "sort": "price_asc",
  "items": [
    {
      "token_mint_addr": "…",
      "token_num": 1058,
      "price": 1799000000,
      "seller": "…",
      "image_url": "https://…",
      "listing_source": "…",
      "owner": "…",
      "onchain_owner": "…",
      "listed_owner": "…",
      "token_id": 999,
      "token_name": "Drifella III #1058",
      "traits": [
        {
          "type_id": 12,
          "type_name": "…",
          "spatial_group": "left",
          "purpose_class": "decor",
          "value_id": 345,
          "value": "…"
        }
      ]
    }
  ]
}
```

Notes:

- Unknown IDs are ignored (no results error).
- `ownerAddress` is optional and uses the active ownership snapshot. Before ownership sync runs, owner-filtered results are empty.
- The backend excludes the special `None` value (`trait_values.id = 217`) from filtering and traits to reduce noise.
- Consistent read: results are anchored to the active snapshot.
- Exclusive params: provide either `anchorMint` or `offset`. When `anchorMint` is present, `offset` is ignored and the response `offset` reflects the computed effective offset.
- Debug: if `DRIFELLASCAPE_DEBUG` is set, the response includes `anchorDebug: { anchorMint, effectiveOffset, pageContainsAnchor }`.

## POST /tokens/search

Search tokens with DB‑side filtering. Returns enriched items (token + traits) by default.

Body (application/json):

- `mode` (string, required): `"value" | "trait"`
- `valueIds` (number[], optional)
- `traits` (array, optional): `{ typeId, valueIds[] }[]`
- `sort` (string, default `token_asc`): `token_asc` | `token_desc`
- `offset` (int, default 0), `limit` (int, default 100; max 100)
- `includeTraits` (bool, default true)
- `ownerAddress` (string, optional): filter to tokens whose active ownership snapshot has `owner = ownerAddress`
- `anchorMint` (string, optional): exclusive with `offset`. When provided, the server computes the page so that this mint appears (centered when possible) and returns the effective `offset` used in the response.

Notes:

- `tokens` represents the canon dataset; response `versionId` is always `null`.
- Search rows include `owner`, `onchain_owner`, and `listed_owner` when ownership data exists.
- The server still returns an effective `offset` and honors `anchorMint`.
- Exclusive params: provide either `anchorMint` or `offset`.
- Debug: if `DRIFELLASCAPE_DEBUG` is set, the response includes `anchorDebug: { anchorMint, effectiveOffset, pageContainsAnchor }`.

Errors:

- 400 invalid JSON
- 500 `{ "error": "message" }`

CORS & Preflight:

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET,POST,OPTIONS`
- `Access-Control-Allow-Headers: content-type`

## GET /traits/catalog

Retrieve the static trait bucket/value catalog for the collection.

Response 200 (application/json):

```json
{
  "total_tokens": 1333,
  "buckets": [
    {
      "type_id": 12,
      "type_name": "Background",
      "spatial_group": "middle",
      "purpose_class": "decor",
      "tokens_with_type": 1333,
      "values": [
        {
          "value_id": 345,
          "value": "Blue",
          "tokens_with_type_value": 42,
          "rarity_pct": 3.150787696924231
        }
      ]
    }
  ]
}
```

Notes:

- The special `None` value (`trait_values.id = 217`) is excluded.
- The endpoint is read-only catalog data; applying filters still uses `POST /listings/search` or `POST /tokens/search` with `valueIds`.

## GET /market/events

Retrieve listing and sale activity events, newest first.

Query parameters:

- `type` (string, default `all`): `all` | `listing` | `sale`
- `offset` (int, default 0): starting index, `>= 0`
- `limit` (int, default 50): number of items, `1..100`

Response 200 (application/json):

```json
{
  "type": "sale",
  "total": 612,
  "offset": 0,
  "limit": 50,
  "items": [
    {
      "id": 42,
      "event_type": "sale",
      "signature": "…",
      "source": "magiceden_v2",
      "slot": 426066496,
      "block_time": 1781301192,
      "token_mint_addr": "…",
      "token_num": 920,
      "token_name": "Drifella III #920",
      "price": 2981400000,
      "seller": "…",
      "buyer": "…",
      "image_url": "https://…"
    }
  ]
}
```

Notes:

- `event_type` is normalized to `listing` or `sale`. Magic Eden remote activity types are `list` and `buyNow`.
- `price` is an integer in raw SOL units (9 decimals), matching listing rows.
- `token_num`, `token_name`, and image fallback come from the static `tokens` table when available.
