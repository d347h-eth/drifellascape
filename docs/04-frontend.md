# Frontend — Technical Guide

This document explains the Drifellascape frontend: stack, configuration, data flow, the listings view, and the full‑screen image exploration mode (Leaflet), with an emphasis on behavior and rationale rather than low‑level code.

## Stack & Goals

- Vite + Svelte (TypeScript)
- Aim: render current listings with minimal latency and provide a crisp, pixel‑perfect exploration experience for high‑resolution artwork.
- Keep client logic simple and responsive; rely on the backend’s in‑memory snapshot for data.

## Project Structure

- `frontend/index.html` — Vite entry
- `frontend/vite.config.ts` — Vite + Svelte configuration (with svelte‑preprocess)
- `frontend/src/main.ts` — mounts the Svelte app
- `frontend/src/App.svelte` — orchestrator (data fetch + polling, hotkeys, wiring components, URL token param integration)
- `frontend/src/components/GalleryScroller.svelte` — slides, wheel Y→X, finalize snap, scrollbar‑release snap
- `frontend/src/components/HelpOverlay.svelte` — keyboard help overlay
- `frontend/src/components/TraitBar/TraitBar.svelte` — purpose pills + trait strip (fixed paging)
- `frontend/src/components/TraitBar/ToggleButton.svelte` — centered ▲/▼ toggle strip (transparent)
- `frontend/src/ImageExplorer.svelte` — full‑screen map‑like viewer (Leaflet)
- `frontend/public/` — static assets
  - `2560/{token_mint_addr}.jpg` — locally hosted 2560‑wide images per token mint
  - `icon-magic_eden.svg`, `icon-tensor.svg` — (present but currently unused)

## Configuration

- `VITE_API_BASE` — backend base URL (default same‑origin; `http://localhost:3000` in dev, `https://api.drifellascape.art` in production)
- `VITE_POLL_MS` — listings poll interval (ms), default `30000`
- Default page size — 50 (client sends `limit=50` unless overridden)

## Data Flow

- On mount, the app requests `{source}/search` (default source: listings) with `{ mode: "value", valueIds: [], sort: default, limit: 50, includeTraits: true }` and stores `items`, `versionId`.
- A periodic poll (default 30s) posts again for listings; if `versionId` changed, the result is staged and applied when the user is at the start (≤ 50px), preventing jumps.
- Price shown is fee‑inclusive (see below) and rendered in the main bar. Marketplace links `[ME] [TS]` are shown next to the price. The Gallery image footer is removed.
- Data source toggle — `T`: switches between current listings and canon tokens (both sources support identical filtering, anchoring, and grid paging).

## Horizontal Gallery (Continuous Travel)

Goal: a desktop‑first horizontal “travel” experience where wide, landscape images flow side‑by‑side. Default rendering preserves 1:1 pixels (max‑width 2560px); images are pinned to the top (no vertical centering).

- Layout

  - One slide per viewport: a flex row scroller with `overflow-x: auto`, each slide `flex: 0 0 100vw`.
  - Images: `width: 100%`, `max-width: 2560px`, `height: auto`, centered horizontally, top‑aligned vertically.
  - Edge navigation bands: fixed left/right buttons (25px wide) to jump ±1; height equals current image height, anchored to the top (recomputed on image load).

- Scrolling & Snap Logic

  - Mouse wheel maps vertical delta to horizontal travel (desktop only); tuned internally (default multiplier 1.5).
  - No CSS scroll‑snap. Instead, a small JS “finalize to center” runs on scroll‑idle when motion is on:
    - Directional finalize: if you moved at least a threshold (default 50% of viewport width) away from the last centered slide, snap to the adjacent slide in the direction of travel. Never snap back to the same slide.
    - Debounce: `FINALIZE_DELAY_MS` (0 ms) — finalize immediately once scrolling idles.
    - Post‑snap block: ignore wheel for `BLOCK_SCROLL_MS` (150 ms) to avoid accidental re‑scrolls right after landing.
  - Native scrollbar drag: snapping is disabled while dragging the native horizontal scrollbar and a snap decision is executed immediately on release (threshold‑based to the nearest slide center).
  - Mobile entry overlay: while visible, it must absorb pointer events (no scroll‑through). The overlay re‑arms on token jumps so users scroll to hide the browser address bar consistently.
  - Animation toggle: users can toggle animation with `M`. When animation is off, there is no automated snap at all (pure linear scrolling). With `prefers‑reduced‑motion`, auto‑snap is also disabled.
  - Autosnap toggle: users can disable auto finalize‑to‑center. On mobile, autosnap defaults off.

- Animation (when motion is on)

  - Custom rAF tween (no CSS snap) with ease‑in‑out cubic.
  - Distance‑based duration: about 0.233 ms/px with caps → min 80 ms, max 160 ms.
  - Interrupt handling: while animating, wheel input is ignored; finalize never triggers mid‑tween; indices update on landing.

- Hotkeys — Gallery

  - Previous/Next image — Left/Right or `A`/`D`
  - Focus current — `F`
  - Enter exploration — `W`
  - Toggle motion — `M`
  - Toggle trait bar — `V`
  - Purpose class (left/right) — `Z` / `C` (wrap; skips empty)
  - Next trait page (wrap) — `X`
  - Jump to first/last — `Home` / `End`
  - Horizontal travel — mouse wheel; click screen edges to prev/next

- Help Overlay
  - Opaque modal with grouped shortcuts for Gallery and Exploration.
  - Open/close with `H` or `F1`; `ESC` closes; clicking backdrop closes.

### Near‑edge Paging (Gallery)

- After user interaction (wheel/keys/click), when the centered slide moves near the left/right end (small threshold), the Gallery fetches the next/prev page by recentring around the current mint (`anchorMint`) — no offset math, no jumps.
- Works for both wheel and `A`/`D` hotkeys (trigger runs when an animation finishes or scroll idles).
- The focused token remains in view after the fetch; the response includes the effective `offset` for subsequent paging symmetry with Grid.

## Trait Bar (Bottom Overlay)

- Toggle: `V`. Semi‑transparent bar pinned slightly above the native scrollbar (bar height 50px; gap ~22px so the native scrollbar is fully accessible). A centered ▲/▼ toggle strip (fully transparent by default) is always visible and lights up on hover. The arrow attempts to invert against the backdrop via `mix-blend-mode: difference` (falls back to white where unsupported).
- Purpose classes (pills) centered above the bar: `left`, `middle`, `right`, `decor`, `items`, `special`, `undefined`.
  - Default selected: `middle`.
  - Pills show counts for the current token (e.g., `middle (5)`); empty pills are disabled and skipped by keyboard nav.
  - Hotkeys: `Z` / `C` cycle purpose left/right (wrap; skip empties).
- Trait boxes strip within the bar:
  - Shows only traits for the selected purpose class of the current token in focus.
  - Box size 150×50; head: `spatial_group. type_name`; value wraps to two lines as needed.
  - Fixed page size: a single right arrow (50×50) advances to the next page; hotkey `X` performs the same action. Pagination wraps to the start.
- Clicking a box toggles value‑based filtering (adds/removes that `value_id`) and immediately refreshes listings via `POST /listings/search`.
  - The frontend keeps the same token in focus across filter changes (by mint), including when removing the last/only filter.

## Listings View

- Layout: single column, each row contains a centered artwork image.
- Images:
  - Source: `/2560/{token_mint_addr}.jpg` served from `frontend/public`.
  - Behavior: 100% width, max‑width 2560px, never upscaled, centered horizontally, landscape preserved.
- Price:
  - Final price = nominal + maker fee (2%) + royalty fee (5%), computed in integer base units (rawAmount, 9 decimals) with ceiling per fee.
  - Displayed as SOL rounded up to 2 decimals.
  - The price text itself is the link (no icons, no underline; same style for visited).
- Marketplace link:
  - Magic Eden for sources `M2`, `MMM`, `M3` (and `HADESWAP_AMM` fallback).
  - Tensor for sources `TENSOR_LISTING`, `TENSOR_CNFT_LISTING`, `TENSOR_MARKETPLACE_LISTING`, `TENSOR_AMM`, `TENSOR_AMM_V2`.
- Accessibility:
  - The image is wrapped in a `<button>` (not a naked clickable `<img>`) to satisfy Svelte a11y constraints.
  - Edge navigation bands recompute height on image `load` and are anchored to the top.

## Exploration Mode (Leaflet)

A full‑screen, map‑like viewer for the original PNG (`image_url` from the marketplace). Goals: hard‑pixel rendering, precise fit behaviors, smooth navigation.

### Key Techniques

- Leaflet CRS.Simple + ImageOverlay
- Hard‑pixel rendering at any zoom via CSS on the image layer:
  - `image-rendering: -webkit-optimize-contrast; image-rendering: crisp-edges; image-rendering: pixelated;`
- Fractional zoom (no snap): `zoomSnap: 0`, `zoomDelta: 0.1`, `wheelDebounceTime: 0`, `zoomAnimation: false` for immediate response.
- Black backdrop; overlay opacity is set to 0 during a source swap to avoid flicker, restored on image `load`.
- Navigation state always fresh on entry: the app derives the current index by mint and freezes `items` for the session.

### Default View

- Fit‑by‑width precisely:
  - Base zoom = `log2(containerWidth / IMG_WIDTH)`.
  - `minZoom = base`, `maxZoom = base + log2(maxZoomFactor)`.
  - Center view at image midpoint `(IMG_HEIGHT/2, IMG_WIDTH/2)`.
- Double‑click resets to this centered fit‑by‑width view.

### Hotkeys — Exploration

- Previous/Next — Left/Right or `A`/`D`
- Close exploration — `Esc`
- Fit‑by‑width centered — `S`
- Fit entire height (middle/left/right) — `W` / `Q` / `E` (capped at 1:1)
- Fit 1006 px band (left/middle/right) — `1` / `2` / `3`
  - Region math: `IMG_WIDTH = 3125`, `IMG_HEIGHT = 1327`, `REGION_HEIGHT = 1006`, `REGION_TOP = (IMG_HEIGHT − 1006)/2 + 36`
  - Region zoom: `log2(containerHeight / REGION_HEIGHT) - epsilon`
- Toggle debug overlay — `O` (cyan rectangle for the 1006 px band)

### Grid Mode

- Activation — `G` from any mode.
- Layout — 3 columns (33% width each), vertical scroll.
- Click any image to return to the horizontal gallery centered on that token.
- On enter, the grid scrolls to the last focused token and briefly flashes a cyan outline to anchor attention.
- Paging — Infinite scroll up/down with real‑interaction arming. Observers attach only after user wheel/click/keydown to avoid surprise requests on entry. Paging uses server‑returned effective `offset`.
- Refocus — Press `F` in Grid to refocus the last anchored token (from Gallery/Explore).
- Images — grid uses downsized assets from `/540h/{mint}.jpg` for faster loads.
- Mobile — hoverless price pills are hidden.
- Source symmetry — Listings and Tokens behave identically for filtering, anchoring, and paging.

### Image Swapping & Flicker Control

- On next/prev, the viewer:
  - Hides the current overlay (opacity 0)
  - Recomputes and applies the intended view (fit‑by‑width for defaults; region/height logic for hotkeys)
  - Swaps URL; on `load`, shows the overlay again (opacity 1)

### Why Fractional Zoom Works With Hard Pixels

- The CSS `image-rendering` hints instruct the browser to avoid smoothing during scaling.
- We keep zoom fractional for exact fit calculations while always rendering crisp pixels — integer zoom is not required.

## Performance Considerations

- Listing page only fetches 100 items; sorting and pagination are trivial on the client.
- Exploration mode renders a single large image; no preloading by default (can be added later for next/prev).
- Hard‑pixel mode trades off anti‑aliasing for sharpness by design.

## Build & Run

- Dev: `yarn workspace @drifellascape/frontend dev`
- Configure API base: `VITE_API_BASE=http://localhost:3000` (prod builds set `https://api.drifellascape.art` via the release script)
- Optional poll override: `VITE_POLL_MS=15000`

## Extensibility

- Deep‑linking the explorer to `/explore/:mint` for shareable links.
- Filters UI: value‑based and trait‑based modes backed by `POST /listings/search`.
- Preload or double‑buffer next/prev artwork for instant transitions.
- Virtualize the listing grid if we ever render many more rows per page.

## Debugging

## Main Bar (Reworked)

- Persistent bottom strip stacked with the trait bar.
- Buttons (left → right):
  - Source (Listings ⇄ Tokens)
  - Mode (Grid ⇄ Gallery). Enter Exploration from Gallery with `W`.
  - Sorting (Price ↑/↓ for Listings; Token ↑/↓ for Tokens). Resets to first page.
  - Animation (enable/disable snap animation)
  - Autosnap (enable/disable auto finalize to center). Default off on mobile.
  - Traits (show/hide trait bar)
  - Hotkeys (open helper overlay)
  - About (open about overlay)
- Token search — `#NUM` (0–1332). Enter jumps to that token (Tokens mode). The main bar shows price and `[ME] [TS]` links; the Gallery image footer is removed.
- Indicators:
  - Gallery: index/total (1‑based across the full filtered set)
  - Grid: Page X/Y and Total N (always for Listings; for Tokens only when filtered)
  - Network activity dot on the right
- Mobile:
  - The bar uses wrap‑around sections: ☰ (collapsed) → toggles → → pagination/search → ✕ (collapse). The control button is a 28px square.
  - Page indicator renders at the right edge.
  - Bottom offset invariant: 15px in Gallery (to not block horizontal scroll), 0 in Grid/Exploration.

## Trait Bar Stack (Reworked)

- The trait stack now composes three rows in a vertical stack above the main bar:
  1. Selected filters (pills)
  2. Purpose pills
  3. Trait boxes (paginated)
- Each row is a simple, static block; the stack sits above the main bar inside a bottom container.

## Mobile Enhancements

- Autosnap default: disabled.
- Always‑visible chevrons: subtle left/right chevrons on gallery edges signal horizontal navigation.
- Landscape overlay: on mobile portrait, an overlay asks to rotate to landscape; tap anywhere to dismiss.
- Grid prices: price pills are hidden on touch devices (hoverless).

- Global debug helper under `frontend/src/debug.ts` (`DEBUG=false` by default). Import `dbg(label, data?)` and flip `DEBUG=true` for development logs.
