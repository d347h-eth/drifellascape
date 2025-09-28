# Drifellascape — AGENTS.md

High‑signal guidance for agents working in this repo. Follow these rules to keep changes focused, deterministic, and aligned with the docs.

## Golden Rules

- Read the docs first: start with `docs/01-product-overview.md`, then the relevant technical doc (`02-05`), plus the Cheatsheet.
- Preserve the snapshot model: append‑only inserts, atomic version flip, idempotent cleanup. Never mutate rows in place.
- Keep it simple: prefer small, explicit TypeScript modules and raw SQL over frameworks/ORMs.
- Respect rate limits: worker must stay ≤ 2 RPS and ≤ 120 RPM; retries only for 429/5xx.
- Consistent reads: any backend load of the active snapshot must be transactionally consistent (see `loadActiveSnapshotConsistent`).
- Gallery paging: near‑edge pagination recenters around the current mint using `anchorMint` (no offset math). Grid paging remains offset‑based up/down.
- Tests first when changing diff logic or normalization. Use temp DB paths via `setDbPath()` and run migrations per test.

## Conventions

- Tooling: Yarn Berry (PnP), Node ≥ 24, TypeScript ESM. Use `tsx` for scripts/entrypoints.
- Packages: `database`, `worker`, `backend`, `frontend`, `shared`. Keep boundaries sharp; database access goes through `@drifellascape/database`.
- Database: better‑sqlite3 with pragmas (`WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`). Migrations live in `database/migrations`.
- Listings schema: primary key is `(version_id, token_mint_addr)`. Ignore price deltas < 0.01 SOL (`PRICE_EPSILON`).
- Frontend: preserve hard‑pixel rendering and hotkeys contract in the exploration mode.
 - Hotkeys: `T` toggles data source (Listings/Tokens); `G`/`Esc` enter Grid; `F` refocuses last anchored token in Grid; `O` toggles debug overlay in Explore.

## How to Work

- Plan: For multi‑step work, outline a short plan and update as steps complete.
- Scope: Implement what’s requested without opportunistic refactors. Mention unrelated issues in your summary instead of changing them.
- Validation: Prefer targeted tests around the code you touch. For DB logic, use temp DBs and run migrations.
- Logging: Append to `logs/` files; keep logs concise and actionable.

## DO / DON’T

- DO keep queries simple (joins on keys; no CTE pyramids). DON’T add an ORM.
- DO ensure one writer (the worker) and short transactions. DON’T hold long transactions in the backend.
- DO align any new endpoints with `docs/06-api-reference.md`. DON’T change response shapes silently.
- DO keep public images under `frontend/public/2560/`. DON’T add heavy asset pipelines.
 - DO use `anchorMint` or `offset` exclusively in search calls; `anchorMint` takes precedence and the server returns the effective `offset`.

## Ingestion Notes

- `scripts/ingest-traits.ts` consumes `logs/mint_to_image.csv` and `metadata/`.
- Duplicate images are expected: the script maps `image_url → [mints...]` and assigns in FIFO order so all 1,333 mints are inserted (uniqueness enforced on mint/num, not image_url).

## Quick Commands

- Worker loop: `yarn worker:run`
- Backend: `yarn backend:run`
- Frontend (dev): `yarn workspace @drifellascape/frontend dev`
- Tests (Vitest): `yarn vitest run`

If something feels ambiguous, add a brief note to `docs/07-decisions.md` and reference the change.
