# Drifellascape — Cheat Sheet

## Collection Facts

- Tokens: 1,333 (Drifella III)
- Artwork dimensions (original PNG): 3125 × 1327
- Local display assets: `frontend/public/2560/{token_mint_addr}.jpg`

## Keys & Fields

- Canonical key: `token_mint_addr` (Solana mint, ≤ 44 chars)
- Optional: `token_num` (parsed from name; best‑effort)
- Listing fields of interest: `seller`, `priceInfo.solPrice.rawAmount`, `extra.img`, `listingSource`

## Pricing

- Raw units: SOL with 9 decimals (integer `rawAmount`)
- Epsilon for diffs: 0.01 SOL = 10,000,000 (raw units)
- Final price shown: nominal + maker 2% + royalty 5% (each `ceil`) → SOL rounded up to 2 decimals

## Snapshots

- Append‑only rows in `listings_current`, keyed by `(version_id, token_mint_addr)`
- Single active version in `listing_versions` (unique partial index on `active=1`)
- Worker cycle: stage → diff → new version → atomic flip → cleanup

## Rate Limits & Intervals

- Marketplace limits: ≤ 2 requests/second, ≤ 120 requests/minute
- Worker interval: default 30s (`DRIFELLASCAPE_SYNC_INTERVAL_MS`)
- Backend refresh: default 30s (`DRIFELLASCAPE_BACKEND_REFRESH_MS`)

## Endpoints

- Backend: `GET /listings?offset&limit&sort=price_asc|price_desc`
- Returns: `{ versionId, total, offset, limit, sort, items }`

## Frontend Hotkeys (Exploration)

- Navigation: Left/Right or `A`/`D` (prev/next), `ESC` (close)
- Default view: `S` (fit‑by‑width centered), double‑click to reset
- Height‑fit: `W` (middle), `Q` (left), `E` (right), capped at 1:1
- Region‑fit (1006 px band): `1` (left), `2` (middle), `3` (right)
  - Region math: `REGION_HEIGHT=1006`, `REGION_TOP=(IMG_HEIGHT−1006)/2 + 36`
- Debug overlay: `G` (cyan rectangle for region‑fit)

## Env Vars

- Worker: `DRIFELLASCAPE_SYNC_INTERVAL_MS`
- Backend: `DRIFELLASCAPE_BACKEND_REFRESH_MS`, `DRIFELLASCAPE_PORT`
- Frontend: `VITE_API_BASE`, `VITE_POLL_MS`

## Scripts

- Download metadata JSON (sequential, ≤1 req/s, retries):
  - `yarn tsx scripts/download-metadata.ts`
- Download originals and produce 2560px JPGs (if needed locally):
  - `yarn tsx scripts/download-images.ts`
  - `yarn tsx scripts/resize-to-2560.ts`
- Ingest traits (CSV + metadata → DB):
  - `yarn tsx scripts/ingest-traits.ts`
