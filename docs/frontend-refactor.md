# Frontend Refactor Plan — App Decomposition and Modularity

This document captures the plan to decompose `frontend/src/App.svelte` into focused, composable pieces with clear responsibilities. The goals are to keep behavior identical, improve maintainability, and enable faster iteration. The milestones below mirror a ROADMAP-style execution with progress tracking.

## Goals & Non-Goals

- Goals

  - Extract large concerns (gallery scroller, trait bar, help) into components.
  - Centralize shared types, API access, and (optionally) state in a predictable place.
  - Isolate DOM-heavy logic (snap/finalize/scrollbar drag) in a dedicated component.
  - Preserve existing behavior and hotkeys; no visual changes.

- Non-Goals (for this refactor)
  - Redesign of UI/UX.
  - New features beyond componentization.
  - Changing backend contracts.

## Current Architecture (Summary)

- `App.svelte` orchestrates everything: data fetch + polling, gallery scroller (wheel Y→X, finalize snap, scrollbar release snap), hotkeys, trait bar (pills, strip, toggle), help overlay, and exploration integration.
- `ImageExplorer.svelte` already isolated; uses Leaflet and its own hotkeys.
- `debug.ts` provides a global `DEBUG` flag and `dbg()` helper.

## Target Architecture

```
frontend/src/
  lib/
    api.ts              # POST /listings/search client
    types.ts            # UI-facing types: ListingRow, ListingTrait, ApiResponse, ...
    stores.ts           # (Optional, stepwise adoption) writable stores for UI/Gallery/Filters
    ui-constants.ts     # Shared UI constants (sizes, offsets)
  components/
    GalleryScroller.svelte        # Slides, wheel mapping, finalize/release-snap, gallery methods
    HelpOverlay.svelte            # Keyboard help
    TraitBar/
      TraitBar.svelte            # Container & coordination
      PurposePills.svelte        # Purpose class pills with counts/disabled
      TraitStrip.svelte          # Trait boxes, fixed paging, arrows
      ToggleButton.svelte        # ▲/▼ button centered; follows bar state
  App.svelte                      # Orchestrator (fetch, polling, filter apply, wiring)
  ImageExplorer.svelte            # (existing)
  debug.ts                        # (existing)
```

## Behavioral Invariants

- Gallery

  - Mouse wheel maps Y→X (desktop), no CSS snap.
  - Finalize snap on scroll idle (directional next/prev from last center) with threshold = 50% viewport width (immediate finalize, no debounce).
  - Native scrollbar drag disables snap; on release, snap to nearest slide center (threshold-based).
  - Prev/Next hotkeys (A/D, ←/→) act on keyup to avoid key-repeat flood.
  - Other keys: F (focus), M (motion), V (toggle trait bar), Z/C (purpose), X (trait page next wrap), Home/End.
  - W: enter exploration for current in-focus token.

- Trait Bar

  - Toggle via V (and centered ▲/▼ button near bottom), stays above native scrollbar (gap ~22 px). Toggle strip is fully transparent by default; only the arrow is visible; lights up subtly on hover.
  - Purpose pills with counts; disabled/greyed if zero; Z/C wrap and skip empty.
  - Trait boxes 150×50; 2-line wrapped value; fixed paging with a single right arrow (wraps on next). `X` performs the same action.
  - Clicking a trait toggles value-based filtering; the current token remains in focus across filter changes (by mint), even when the list grows back.

- Help Overlay

  - Function — keys layout for Gallery and Exploration; ESC closes; overlay click closes.

- Data
  - POST /listings/search with includeTraits=true for enriched items.
  - Default browse: value mode with empty valueIds, price_asc, limit=100.
  - Exclude `trait_values.id=217` (None) is enforced backend-side.

## Milestones & Progress

- [x] PR1: Types/API/Stores + HelpOverlay + ToggleButton

  - Add `lib/types.ts` and migrate UI types out of App.
  - Add `lib/api.ts` with `postSearchListings()` and adopt in App for fetch + polling + filter apply.
  - Add `lib/stores.ts` skeleton (UI/Gallery/Filters) for gradual adoption.
  - Extract `HelpOverlay.svelte` and `TraitBar/ToggleButton.svelte`; wire props/events; remove inline CSS.

- [x] PR2: TraitBar split
- [x] PR3: GalleryScroller extraction — scroller logic/component extracted; scroller CSS moved; methods exposed. Optional: extract snap logic to a `useSnap` action (defer if not needed).
- [x] PR4: Cleanup & constants — added `lib/ui-constants.ts`; removed dead helpers from App; moved scroller CSS; formalized trait bar numbers in code.

  - Extract `TraitBar.svelte`, `PurposePills.svelte`, `TraitStrip.svelte`.
  - Move counts and fixed paging inside; emit `toggleValue` and `purposeChange`; App forwards to API/stores.

- [x] PR3: GalleryScroller — finalized component with wheel mapping, finalize snap, scrollbar release snap, and methods for App.
- [x] PR4: Cleanup & constants — constants centralized; unused code removed; CSS scoped in components.

## Step Details

### PR1 — Types/API/Stores + HelpOverlay + ToggleButton (Now)

- types.ts

  - Export `ListingTrait`, `ListingRow`, `ApiResponse`, `ListingsSearchBody` (UI-facing).

- api.ts

  - `postSearchListings(body: ListingsSearchBody): Promise<ApiResponse>`; reads `VITE_API_BASE`.

- stores.ts (optional skeleton)

  - Export `showHelp`, `showTraitBar`, `motionEnabled`, `activeIndex` as writables for later adoption.

- HelpOverlay.svelte

  - Props: `visible: boolean`.
  - Events: `close` (backdrop click).
  - Presentational only; App handles ESC.

- ToggleButton.svelte

  - Props: `show: boolean`.
  - Events: `toggle`.
  - Centered 200×14 ▲/▼, positioned based on bar visibility (22px or ~110px); no focus ring.

- App changes
  - Import types from `lib/types.ts`.
  - Replace raw fetch with `postSearchListings` in load, poll, and filter apply.
  - Replace inline Help Overlay and Toggle Button with components.

### PR2 — TraitBar split

- TraitBar.svelte: container receiving current token traits, `selectedPurpose`, `selectedValueIds`; exposes events; composes subcomponents.
- PurposePills.svelte: counts/disabled logic, click => purposeChange.
- TraitStrip.svelte: fixed paging (non-overlap), arrows, box rendering, X wrap; click => toggleValue.

### PR3 — GalleryScroller

- `GalleryScroller.svelte`: slides, wheel mapping, finalize snap on idle, release snap on scrollbar, methods for `prev/next/focus/scrollToIndexInstant`, and `imageLoad` event for edge height recompute.
  - Parameters default internally: wheel multiplier 1.5, threshold 0.5, finalize delay 0 ms, block 150 ms, ease‑in‑out cubic, duration ≈ 0.233 ms/px (80–160 caps).

### PR4 — Cleanup & constants

- Extracted magic numbers to `ui-constants.ts`; confirmed layering (z-index) and focus styles; removed legacy App scroller/trait pagination code.

## Acceptance Criteria

- No behavioral regressions; help overlay and hotkeys match docs.
- Trait filtering keeps current token anchored by mint across list size changes.
- Native scrollbar is fully usable; snapping behaves predictably on release.
- Gallery scroll feels identical (fractional threshold, finalize debounce 0, motion toggle respected).

## Notes

- Keybinding hygiene: prev/next on keyup both in Gallery and Exploration; other keys on keydown for responsiveness.
- Debug: use global `dbg()` from `debug.ts` guarded by `DEBUG` for targeted logs.
