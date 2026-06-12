# Drifellascape — Cheat Sheet

## Collection Facts

- Tokens: 1,333 (Drifella III)
- Artwork dimensions (original PNG): 3125 × 1327
- Display assets: `frontend/static/art/{2560,540h}/{token_mint_addr}.jpg` for the Caddy mount; current frontend image components request `https://app.drifellascape.art/static/art/...`.

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
- `POST /listings/search` — DB‑side filtering (value/trait modes), enriched listings from the active snapshot
- `POST /tokens/search` — DB‑side filtering over the static canon token dataset (`versionId: null`)
- `GET /traits/catalog` — full trait bucket/value catalog with counts and rarity percentages

## Frontend Hotkeys (Gallery)

- Previous/Next image — Left/Right or `A`/`D`
- Focus current — `F`
- Focus token search — `E`
- Enter exploration — `W`
- Enter grid view — `G` or `Esc`
- Toggle data source (Listings/Tokens) — `T`
- Toggle motion — `M`
- Toggle filter panel — `V`
- Purpose class (left/right) — `Z` / `C` (wrap; skips empty)
- Next trait page (wrap) — `X`
- Jump to first/last — `Home` / `End`
- Help — `H` or `F1`
- Horizontal travel — mouse wheel; click screen edges to prev/next

## Frontend Hotkeys (Exploration)

- Previous/Next — Left/Right or `A`/`D`
- Close exploration — `Esc` or `G`
- Fit‑by‑width centered — `S`
- Fit entire height (middle/left/right) — `W` / `Q` / `E` (capped at 1:1)
- Fit 1007 px band (left/middle/right) — `1` / `2` / `3` (region top = `(IMG_HEIGHT−1007)/2 + 36`)
- Reset to fit‑by‑width — Double‑click
- Toggle debug overlay — `O`

## Frontend Hotkeys (Grid)

- Refocus last anchored token — `F`
- Enter gallery — `G`
- Focus token search — `E`
- Toggle data source (Listings/Tokens) — `T`

## Main Bar (Toggles & Indicators)

- Source toggle — Listings ⇄ Tokens
- Mode toggle — Grid ⇄ Gallery (Exploration is entered from Gallery with `W`)
- Sorting — Price ↑/↓ (Listings), Token ↑/↓ (Tokens); resets to the first page
- Animation — enable/disable snap animation
- Autosnap — enable/disable auto finalize to center
- Traits — show/hide the left traits explorer
- Filter — show/hide the bottom filter panel
- Hotkeys — show/hide hotkeys helper overlay
- About — show project/about overlay
- Token search — input accepts `#NUM` (0–1332). Enter jumps to the token (Tokens mode). Price and [ME]/[TS] links render in the bar; the Gallery image footer is removed.
- Indicators
  - Gallery: index/total (1‑based across full result set)
  - Grid: Page X/Y; Total N (always for Listings; for Tokens only when filtered)
  - Network activity dot (right)

Mobile specifics

- Main bar uses wrap‑around sections: ☰ (collapsed) → toggles → → pagination/search → ✕ (collapse). Control button is a 28px square.
- Page indicator moves to the right edge
- Gallery shows left/right chevrons at edges
- Autosnap is disabled by default
- Grid hides price pills (hoverless)
- Gallery entry overlay must absorb pointer events; it re‑arms on token jumps so users scroll to hide the browser address bar consistently.

## Deep Links

- `?token=NUM` (0–1332) deep‑links Gallery to a token (Tokens mode). The param updates as you browse in Gallery and is removed when you enter Grid.

## Static & Releases

- Images are served from `/static/art/{2560,540h}/{mint}.jpg` by Caddy; Gallery/Grid currently use the absolute `https://app.drifellascape.art/static/...` base.
- Frontend is a static bundle served by Caddy from `releases/current`. Use the `frontend-build` container and symlink flip; verify on `:8080` via the `caddy-verify` compose profile.

## Env Vars

- Worker: `DRIFELLASCAPE_SYNC_INTERVAL_MS`
- Backend: `DRIFELLASCAPE_BACKEND_REFRESH_MS`, `DRIFELLASCAPE_PORT`
- Frontend: `VITE_API_BASE`, `VITE_POLL_MS`

## Scripts

- Download metadata JSON (sequential, ≤1 req/s, retries):
  - `yarn tsx scripts/download-metadata.ts`
- Download originals and produce resized JPGs:
  - `yarn tsx scripts/download-images.ts`
  - `yarn tsx scripts/resize-images.ts width`
  - `yarn tsx scripts/resize-images.ts height`
  - `yarn tsx scripts/resize-images.ts meta`
- Ingest traits (CSV + metadata → DB):
  - `yarn tsx scripts/ingest-traits.ts`
- Update trait type grouping/class labels:
  - `yarn tsx scripts/update-trait-types.ts`
