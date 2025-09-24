# API Reference — Listings

Base URL: `http://localhost:3000`

## GET /listings

Retrieve the current in‑memory snapshot of marketplace listings.

Query parameters:

- `offset` (int, default 0): starting index, `>= 0`
- `limit` (int, default 50): number of items, `1..200`
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
- Sorting applies to `price` only; tie‑breakers may be added later.

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
- The backend excludes the special `None` value (`trait_values.id = 217`) from filtering and traits to reduce noise.
- Consistent read: results are anchored to the active snapshot.

Errors:

- 400 invalid JSON
- 500 `{ "error": "message" }`

 CORS & Preflight:

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET,POST,OPTIONS`
- `Access-Control-Allow-Headers: content-type`
