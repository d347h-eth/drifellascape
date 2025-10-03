# Architectural Decisions (ADR Summary)

## ADR-001: Canonical Token Key

- Decision: Use `token_mint_addr` (Solana mint) as the canonical key everywhere.
- Rationale: Marketplace APIs and activity endpoints reference mint; robust across sources.

## ADR-002: Append-only Snapshots with Atomic Flip

- Decision: Store listings in versioned snapshots; create new snapshot only if diffs exist; atomically flip active version, then clean stale rows.
- Rationale: Readers never observe partial writes; cleanup is idempotent; simplifies race handling.

## ADR-003: Diff Epsilon on Price

- Decision: Ignore price changes < 0.01 SOL (10,000,000 raw units).
- Rationale: Avoid churn from market‑maker micro relists; focus on material changes.

## ADR-004: In-memory Cache for Backend

- Decision: Backend keeps the active snapshot in memory and reloads only when version changes.
- Rationale: Low latency, low cost; reads are DB‑independent.

## ADR-005: Hard-pixel Rendering + Fractional Zoom

- Decision: Use CSS `image-rendering` hints to avoid smoothing and allow fractional zoom for exact fits.
- Rationale: Crisp pixels at any zoom without snapping; precise fit‑to‑width and region‑fit behaviors.

## ADR-006: Staged Frontend Updates

- Decision: Poll for new snapshots; stage results; apply only when user is near the top.
- Rationale: Avoid viewport jumps; respect user’s scroll position.

## ADR-007: Listings Normalization (Primary Fields Only)

- Decision: Accept only `tokenMint`, `priceInfo.solPrice.rawAmount`, `seller`, `extra.img`, `listingSource`.
- Rationale: Simplify invariants; avoid fragile fallbacks; skip invalid rows explicitly.

## ADR-008: Horizontal Gallery Scroll + Snap

- Decision: Implement desktop‑first horizontal browsing with linear wheel scrolling, no CSS snap, and a small JS finalize‑to‑center that only triggers after moving far enough from the last center and always in the direction of travel. Provide a motion toggle to disable auto‑snap completely.
- Rationale: Achieves a continuous “travel” feel across wide artwork while retaining precise centering on demand. Avoids CSS snap stickiness and snap‑back. Keeps logic simple and tunable (threshold, debounce, easing, duration) and respects reduced‑motion.
- Key parameters:
  - `WHEEL_MULTIPLIER` (default 1.5), `LEAVE_THRESHOLD_FRAC` (0.5 viewport width), `FINALIZE_DELAY_MS` (0 ms), `BLOCK_SCROLL_MS` (100–150 ms)
  - Easing: ease‑in‑out cubic; duration ≈ 0.233 ms/px (80–160 ms caps)
  - Motion off: no automated snap; keys/edges are instant
  - Reduced motion: disables auto‑snap

## ADR-009: Enriched Listings + Trait Search API

- Decision: Add `POST /listings/search` with value‑based and trait‑based modes using numeric IDs, with pagination and price sorting. Return enriched listings (token + traits) by default.
- Rationale: Keep the API uniform and explicit, expose the DB “as is” for exploration, and avoid GET query limits.
- Notes: Unknown IDs are ignored; consistent reads on active snapshot; value `trait_values.id=217` (None) is excluded from filters and attached traits.

## ADR-010: Trait Bar UX & Token Focus

- Decision: Show a bottom trait bar toggled by `V` with fixed‑size boxes and purpose pills. Filtering by clicking a box always keeps the same token in focus across list changes (anchored by mint).
- Rationale: Provide fast, bottom‑up value discovery while preserving user context; avoid disorientation when list size changes.

## ADR-011: Anchor-based Pagination & Exclusive Params

- Decision: Use anchor‑by‑mint for deterministic pagination across Listings and Tokens. Requests provide either `anchorMint` or `offset` (exclusive). When `anchorMint` is present, the server computes an effective `offset` so the mint appears (centered when possible) and returns it in the response.
- Rationale: Preserve focus across filter and mode transitions without client heuristics. Avoid surprise jumps and extra requests.
- Notes: Grid paging uses the server‑returned `offset` for up/down requests; observers arm only after user interaction (wheel/pointer/keydown) to avoid accidental requests on entry.

## ADR-012: Static Serving via Caddy + Release Symlink

- Decision: Serve the built frontend as static files from Caddy, mounted under `/srv/releases/current`; serve heavy images from `/srv/static` under `/static/art/...`.
- Rationale: Zero‑downtime swaps, small bundles, and simplified production footprint. Verified side‑by‑side via a `caddy-verify` profile on `:8080`.

## ADR-013: Tokens‑only Quick Jump + URL Param

- Decision: Token quick search (Enter) always anchors via Tokens to guarantee the token exists, then enters Gallery centered on it. Deep link `?token=NUM` (0–1332) opens Gallery on that token; param updates during Gallery navigation and is removed when entering Grid.
- Rationale: Deterministic behavior independent of current listings; shareable links that encode Gallery focus only.

## ADR-014: Mobile Entry Overlay Captures Gestures

- Decision: The Gallery entry overlay uses `pointer-events: auto` and re‑arms on token jumps. While visible, it absorbs gestures so the scroller doesn’t map vertical wheel to horizontal travel.
- Rationale: Prevents subtle left‑offset drift and keeps the “enter gate” interaction predictable across devices.

## ADR-015: Main Bar Wrap‑around on Mobile

- Decision: The main bar on mobile is split into two sections (toggles; pagination/search) navigated by a 28px control button: ☰ → → → ✕.
- Rationale: Avoid overlap and maintain a compact, touch‑friendly interface.
