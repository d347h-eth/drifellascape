# API Reference — Listings

Base URL: `http://localhost:3000`

## GET /listings

Retrieve the current in‑memory snapshot of marketplace listings.

Query parameters:
- `offset` (int, default 0): starting index, `>= 0`
- `limit` (int, default 50): number of items, `1..200`
- `sort`  (string, default `price_asc`): `price_asc` | `price_desc`

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
