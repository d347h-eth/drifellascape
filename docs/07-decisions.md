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

