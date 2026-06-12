# Gallery Infinite Scroll — Plan & Progress

Goal: Add near‑edge pagination in the horizontal Gallery to mirror Grid’s vertical paging, without surprises.

Principles

- Keep behavior deterministic and identical across Listings/Tokens.
- Do not trigger requests until real user interaction (keys/wheel/click).
- Preserve the focused token when fetching near either edge.
- Recenter around the current mint with `anchorMint` for Gallery edge paging; keep offset-based up/down paging in Grid.

Phased Steps

1. Scroller edge detection + events (no wiring in App)
   - Add threshold‑based detection in `GalleryScroller.svelte`.
   - Dispatch `loadPrev` / `loadMore` with a short cooldown.
   - Add a prop `galleryPagingEnabled` (default false) to guard dispatch.
2. App wiring
   - Handle `on:loadPrev` / `on:loadMore` in `App.svelte` by re-querying the current source around the focused mint with `anchorMint`.
   - Replace the current Gallery page with the server-centered page and update `baseOffset` from the returned effective `offset`.
3. Preserve horizontal focus
   - After the centered page arrives, scroll instantly to the same focused mint inside the new items.
4. Interaction gating
   - Add a `galleryPagingArmed` flag (wheel/pointerdown/keydown) and pass it as `galleryPagingEnabled`.
   - Reset arming after anchorMint fetch and on Gallery entry.
5. Docs update
   - Update `docs/04-frontend.md` to note Gallery near‑edge paging (anchorMint recentre; works for wheel and A/D).

Status

- [x] Step 1 — Edge detection + events added in Scroller (guarded behind prop)
- [x] Step 2 — Wire `loadPrev` / `loadMore` in App via anchorMint requests
- [x] Step 3 — Preserve horizontal viewport after prepend (superseded by KISS approach)
- [x] Step 4 — Interaction gating for Gallery
- [x] Step 5 — Docs

Implementation note (final approach)

- To keep behavior simple and deterministic, Gallery near‑edge paging re‑centres around the current mint using `anchorMint` rather than offset‑based append/prepend. This guarantees the focused token remains in view with one request and avoids fragile pixel math or race conditions. Grid continues to use offset‑based paging up/down.
