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
- `frontend/src/App.svelte` — main UI (listings + exploration overlay)
- `frontend/src/ImageExplorer.svelte` — full‑screen map‑like viewer (Leaflet)
- `frontend/public/` — static assets
  - `2560/{token_mint_addr}.jpg` — locally hosted 2560‑wide images per token mint
  - `icon-magic_eden.svg`, `icon-tensor.svg` — (present but currently unused)

## Configuration

- `VITE_API_BASE` — backend base URL (default `http://localhost:3000`)
- `VITE_POLL_MS` — listings poll interval (ms), default `30000`

## Data Flow

- On mount, the app requests `GET {VITE_API_BASE}/listings?limit=100` and stores `items`, `versionId`.
- A periodic poll (default 30s) fetches again. If a new `versionId` arrives, the result is staged; it applies automatically when the user is near the top (≤ 50 px), preventing viewport jumps while scrolling.
- Price shown is fee‑inclusive (see below). Clicking the price opens the marketplace listing in a new tab.

## Horizontal Gallery (Continuous Travel)

Goal: a desktop‑first horizontal “travel” experience where wide, landscape images flow side‑by‑side. Default rendering preserves 1:1 pixels (max‑width 2560px); images are pinned to the top (no vertical centering).

- Layout

  - One slide per viewport: a flex row scroller with `overflow-x: auto`, each slide `flex: 0 0 100vw`.
  - Images: `width: 100%`, `max-width: 2560px`, `height: auto`, centered horizontally, top‑aligned vertically.
  - Edge navigation bands: fixed left/right buttons (height 1327px, width 6vw, min 60px) to jump ±1.

- Scrolling & Snap Logic

  - Mouse wheel maps vertical delta to horizontal travel (desktop only); tuned with `WHEEL_MULTIPLIER` (default 1.5).
  - No CSS scroll‑snap. Instead, a small JS “finalize to center” runs on scroll‑end when motion is on:
    - Directional finalize: if you moved at least `LEAVE_THRESHOLD_PX` away from the last centered slide (default 1000 px), snap to the adjacent slide in the direction of travel. Never snap back to the same slide.
    - Debounce: `FINALIZE_DELAY_MS` (default 120 ms) waits briefly after the last wheel event.
    - Post‑snap block: ignore wheel for `BLOCK_SCROLL_MS` (default 100 ms) to avoid accidental re‑scrolls right after landing.
  - Motion toggle: users can toggle motion with `M`. When motion is off, there is no automated snap at all (pure linear scrolling). With motion on and `prefers‑reduced‑motion`, auto‑snap is also disabled.

- Animation (when motion is on)

  - Custom rAF tween (no CSS snap) with ease‑in‑out cubic.
  - Distance‑based duration: about 0.233 ms/px with caps → min 80 ms, max 160 ms.
  - Interrupt handling: while animating, wheel input is ignored; finalize never triggers mid‑tween; indices update on landing.

- Hotkeys — Gallery

  - Navigation: Left/Right or `A`/`D` (prev/next)
  - Focus current: `F` (centers the nearest image)
  - Motion toggle: `M` (enables/disables auto‑snap + animation)
  - Jump ends: `Home` (first), `End` (last) — instant
  - Help: `H` or `F1` toggles a hotkeys overlay
  - Mouse: wheel for travel; click screen edges to prev/next

- Help Overlay
  - Opaque modal with grouped shortcuts for Gallery and Exploration.
  - Open/close with `H` or `F1`; `ESC` closes; clicking backdrop closes.

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

### Hotkeys

- Navigation: Left/Right arrow or `A`/`D` to go to previous/next; `ESC` to close.
- Edges: invisible full‑height targets on left/right; hover reveals subtle gradient. Right edge leaves space for the close button and does not steal focus.
- Positioning:
  - `S` — fit‑by‑width centered (default view)
  - `W`, `Q`, `E` — fit the entire image height (middle/left/right), capped at 1:1
  - `1`, `2`, `3` — fit a 1006 px tall band to viewport height (left/middle/right) with a tuned vertical offset
    - Region math:
      - `IMG_WIDTH = 3125`, `IMG_HEIGHT = 1327`
      - `REGION_HEIGHT = 1006`
      - `REGION_TOP_CENTER = (IMG_HEIGHT - REGION_HEIGHT)/2`
      - `REGION_TOP = REGION_TOP_CENTER + 36` (tuned for correct placement)
    - Region zoom: `log2(containerHeight / REGION_HEIGHT) - epsilon` (no 1:1 cap; small epsilon avoids off‑by‑1 px)
- `G` — toggle a cyan debug rectangle outlining the 1006 px region used by 1/2/3.

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
- Configure API base: `VITE_API_BASE=http://localhost:3000`
- Optional poll override: `VITE_POLL_MS=15000`

## Extensibility

- Deep‑linking the explorer to `/explore/:mint` for shareable links.
- Filters UI: price ranges, marketplace source, token number; later, trait filters (once available in the backend).
- Preload or double‑buffer next/prev artwork for instant transitions.
- Virtualize the listing grid if we ever render many more rows per page.
