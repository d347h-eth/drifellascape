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

- `GET /listings?offset&limit&sort=price_asc|price_desc` — in‑memory snapshot
- `POST /listings/search` — DB‑side filtering (value/trait modes), enriched listings

## Frontend Hotkeys (Gallery)

- Previous/Next image — Left/Right or `A`/`D`
- Focus current — `F`
- Enter exploration — `W`
- Enter grid view — `G` or `Esc`
- Toggle motion — `M`
- Toggle trait bar — `V`
- Purpose class (left/right) — `Z` / `C` (wrap; skips empty)
- Next trait page (wrap) — `X`
- Jump to first/last — `Home` / `End`
- Help — `H` or `F1`
- Horizontal travel — mouse wheel; click screen edges to prev/next

## Frontend Hotkeys (Exploration)

- Previous/Next — Left/Right or `A`/`D`
- Close exploration — `Esc`
- Fit‑by‑width centered — `S`
- Fit entire height (middle/left/right) — `W` / `Q` / `E` (capped at 1:1)
- Fit 1006 px band (left/middle/right) — `1` / `2` / `3` (region top = `(IMG_HEIGHT−1006)/2 + 36`)
- Reset to fit‑by‑width — Double‑click
- Toggle debug overlay — `O`

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
