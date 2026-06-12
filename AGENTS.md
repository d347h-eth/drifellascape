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
- Frontend: preserve hard‑pixel rendering and hotkeys contract in the exploration mode. Main bar on mobile uses a two‑step “wrap‑around” menu (☰ → toggles → → pagination/search → ✕ collapse). Token quick search lives in the bar (Enter to jump; no magnifier on mobile). Pagination/search text uses non‑breaking spacing.
- Hotkeys: `T` toggles data source (Listings/Tokens); `G`/`Esc` enter Grid; `F` refocuses last anchored token in Grid; `O` toggles debug overlay in Explore.

## How to Work

- Plan: For multi‑step work, outline a short plan and update as steps complete.
- Scope: Implement what’s requested without opportunistic refactors. Mention unrelated issues in your summary instead of changing them.
- Validation: Prefer targeted tests around the code you touch. For DB logic, use temp DBs and run migrations.
- Logging: Append to `logs/` files; keep logs concise and actionable.

## Static Serving & Releases

- Frontend build is a static bundle served by Caddy from `releases/current`.
- Heavy images are mounted under `/static/art/{2560,540h}/…`; the app requests `/static/art/...` paths.
- Use the one‑shot `frontend-build` container via `./scripts/release/build-frontend-release.sh`; flip `releases/current` symlink and `caddy reload`. A `caddy-verify` profile exists for side‑by‑side checks on `:8080` without touching live traffic.

## URL & Navigation

- `?token=NUM` (0–1332) deep‑links Gallery to a token (Tokens mode). Param updates as Gallery focus changes; it is removed on entering Grid.
- Token quick search always anchors via Tokens (then enters Gallery centered on the token).

## Mobile Overlay & Input

- The Gallery entry overlay must capture pointer events (no Y→X wheel leakage). Overlay re‑arms on token jumps so users scroll to hide the address bar consistently.
- Inside the token search input: `E` focuses and selects all; `Esc` refills with the current token and blurs. Never overwrite the field while it is focused.

## DO / DON’T

- DO keep queries simple (joins on keys; no CTE pyramids). DON’T add an ORM.
- DO ensure one writer (the worker) and short transactions. DON’T hold long transactions in the backend.
- DO align any new endpoints with `docs/06-api-reference.md`. DON’T change response shapes silently.
- DO keep deploy image assets under `frontend/static/art/{2560,540h}/`. DON’T add heavy asset pipelines.
- DO use `anchorMint` or `offset` exclusively in search calls; `anchorMint` takes precedence and the server returns the effective `offset`.

## Ingestion Notes

- `scripts/traits/ingest-traits.ts` consumes `logs/mint_to_image.csv` and `metadata/`.
- Duplicate images are expected: the script maps `image_url → [mints...]` and assigns in FIFO order so all 1,333 mints are inserted (uniqueness enforced on mint/num, not image_url).

## Quick Commands

- Full local stack: `yarn dev`
- Worker loop: `yarn worker:run`
- Backend: `yarn backend:run`
- Frontend (dev): `yarn workspace @drifellascape/frontend dev`
- Tests (Vitest): `yarn vitest run`

If something feels ambiguous, add a brief note to `docs/07-decisions.md` and reference the change.
