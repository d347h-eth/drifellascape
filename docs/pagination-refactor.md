# Pagination & Anchoring Refactor

Goal: make pagination, anchoring, and grid/gallery interactions deterministic, DRY, and identical across Listings and Tokens — with a clear server contract and a thinner, reusable client.

## Scope & Principles

- One contract: request uses either `anchorMint` or `offset`, not both; server returns the effective `offset` actually used.
- Same behavior for Listings and Tokens (filtering, paging, anchoring, up/down paging).
- Single code path for building search requests and for paging logic on the client.
- Deterministic server rank/offset computation with clear tie‑breakers.
- Lightweight, observable debug (behind an env flag) while we iterate.

## Plan (Phased)

1) Server: shared offset helper + exclusive params (Phase 1)
   - Extract `computePageOffset` helper used by all repo functions (listings/tokens; value/trait).
   - Implement rank calculation with identical WHERE/JOIN shape as the items query and deterministic tie‑breaker (mint) for ties.
   - Exclusive params: when `anchorMint` present, ignore `offset` and use anchor; otherwise use `offset`.
   - Response: always return effective `offset` used; add optional debug `{ anchorMint, effectiveOffset, pageContainsAnchor }` behind `DRIFELLASCAPE_DEBUG=1`.

2) FE API: single request builder (Phase 2)
   - `buildSearchBody({ source, filters, anchorMint?, offset? })` enforces the exclusive rule.
   - `postSearch({ source, body })` chooses `/listings/search` or `/tokens/search`, returns typed response with `offset` (effective).
   - Apply across current call sites (initial load, filter changes, mode toggles).

3) FE Pager: unify paging logic (Phase 3)
   - Tiny pager module (or store) that owns: `items`, `baseOffset`, `total`, `session` and methods `reset(anchorMint?)`, `fetchNext()`, `fetchPrev()`.
   - Dedup by mint, session guard, and viewport‑stable prepend (for `fetchPrev`).
   - Source‑agnostic: internally picks sort and endpoint based on `source`.
   - Extract viewport anchoring into `lib/viewport.ts` to keep App lean.

4) FE Anchor: centralize anchor state (Phase 4)
   - Single `anchor` store: `{ armed, lastMint }`. Arm on first Gallery/Explore entry; track last focused mint in Gallery/Explore.
   - Filter apply uses anchor iff (Gallery/Explore) or (Grid && armed), else uses offset.
   - Replace ad‑hoc branches in `App.svelte` with this store.

5) FE Interactions & toggles (Phase 5)
   - Replace `scrollY` gating with a simple `userInteracted` flag (wheel/pointer/key) to arm paging.
   - Consolidate Grid/Gallery toggle into one function (keeps last focused mint).

6) Cleanup & Docs (Phase 6)
   - Remove debug from server responses unless `DRIFELLASCAPE_DEBUG=1`.
   - Update API comments (“either `anchorMint` or `offset`; response returns effective `offset`”).
   - Short client README on Pager + SearchBody builder + Anchor store.

## Acceptance Criteria

- Server returns pages centered around `anchorMint` (when provided) with `offset` set to the actual used offset; identical for Listings and Tokens.
- FE sends anchor‑only (no offset) when anchoring; sends offset‑only when paging; never both.
- Grid up/down paging works the same for both sources, with stable viewport on prepends.
- Toggling filters/data source preserves focus deterministically.

## Risks / Mitigations

- Risk: mismatch between rank query and items query.
  - Mitigation: share a helper to build WHERE/JOIN and comparators; add a unit test for each path.
- Risk: FE sends both `anchorMint` and `offset`.
  - Mitigation: builder enforces exclusivity; server ignores `offset` when `anchorMint` present.

## Test Outline

- Server unit tests for `computePageOffset` across: (listings/tokens) × (value/trait) × (asc/desc) × (edge pages).
- FE smoke tests: initial load (single request), filter→anchor, tokens/listings symmetry, grid up/down paging, mode toggles.

## Status

- Current: plan staged; partial anchor + paging improvements exist in code; refactor will consolidate and simplify.

---

## Worklog / Progress

- [ ] Phase 1 — Server helper + exclusive params + effective offset
- [ ] Phase 2 — FE builder + unified postSearch
- [x] Phase 3 — Pager module (next/prev, dedup, viewport anchor)
- [x] Phase 4 — Anchor store; remove ad‑hoc branches
- [ ] Phase 5 — Interactions/toggles cleanup
- [ ] Phase 6 — Remove debug (prod) + docs update

Notes:
- Phase 1 keeps behavior; introduces helper and consistent offset reporting, and ensures requests are unambiguous.
- Following phases are mostly mechanical refactors with small integration points.
