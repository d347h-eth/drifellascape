<script lang="ts">
    import { onMount, tick } from "svelte";
    import ImageExplorer from "./ImageExplorer.svelte";
    import GalleryScroller from "./components/GalleryScroller.svelte";
    import HelpOverlay from "./components/HelpOverlay.svelte";
    import ToggleButton from "./components/TraitBar/ToggleButton.svelte";
    import TraitBar from "./components/TraitBar/TraitBar.svelte";
    import { postSearchListings } from "./lib/api";
    import type { ListingRow, ListingTrait } from "./lib/types";

    // Types moved to lib/types.ts

    let items: ListingRow[] = [];
    let versionId: number | null = null;
    // Staged data waiting for user to scroll to top
    let stagedItems: ListingRow[] | null = null;
    let stagedVersionId: number | null = null;
    let loading = true;
    let error: string | null = null;
    let exploreIndex: number | null = null;
    let exploreItems: ListingRow[] | null = null;
    let showHelp = false;
    let showTraitBar = false;
    const PURPOSE_CLASSES = ["left", "middle", "right", "decor", "items", "special", "undefined"] as const;
    type Purpose = typeof PURPOSE_CLASSES[number];
    let selectedPurpose: Purpose = "middle";
    // Trait bar paging is encapsulated in TraitBar
    let selectedValueIds: Set<number> = new Set();
    let traitsForCurrent: ListingTrait[] = [];

    // Horizontal scroller state (delegated to GalleryScroller)
    let activeIndex = 0; // nearest item to viewport center

    // Snap and scrollbar release logic are handled within GalleryScroller

    // Motion toggle
    let motionEnabled = true;

    // Keep TraitBar in sync with the token in focus (gallery or exploration)
    $: {
        const useExplore = exploreIndex !== null && !!exploreItems;
        if (useExplore) {
            const row = exploreItems?.[exploreIndex as number];
            traitsForCurrent = row?.traits ?? [];
        } else {
            const row = items[activeIndex];
            traitsForCurrent = row?.traits ?? [];
        }
    }

    async function loadListings() {
        loading = true;
        error = null;
        try {
            const data = await postSearchListings({
                mode: "value",
                valueIds: [],
                sort: "price_asc",
                offset: 0,
                limit: 100,
                includeTraits: true,
            });
            items = data.items ?? [];
            versionId = data.versionId ?? null;
        } catch (e: any) {
            error = e?.message || String(e);
        } finally {
            loading = false;
            activeIndex = 0;
        }
    }

    const POLL_MS = Number((import.meta as any).env?.VITE_POLL_MS ?? 30000);

    function atStart(): boolean {
        return activeIndex === 0;
    }

    function applyStagedIfAtStart() {
        if (exploreIndex !== null) return; // ignore while in explore mode
        if (stagedItems && stagedVersionId && atStart()) {
            items = stagedItems;
            versionId = stagedVersionId;
            stagedItems = null;
            stagedVersionId = null;
            activeIndex = 0;
        }
    }

    async function pollForUpdates() {
        try {
            const data = await postSearchListings({
                mode: "value",
                valueIds: [],
                sort: "price_asc",
                offset: 0,
                limit: 100,
                includeTraits: true,
            });
            if (typeof data?.versionId === "number" && data.versionId !== versionId) {
                stagedItems = data.items ?? [];
                stagedVersionId = data.versionId;
                // If user is at start now, apply immediately
                applyStagedIfAtStart();
            }
        } catch {
            // ignore transient errors
        }
    }

    onMount(() => {
        loadListings();
        const id = setInterval(pollForUpdates, Math.max(5000, POLL_MS));
        const onKey = (e: KeyboardEvent) => {
            const k = e.key;
            // Help overlay toggles (works in both modes)
            if (k === 'F1' || k === 'h' || k === 'H') {
                e.preventDefault();
                e.stopImmediatePropagation();
                showHelp = !showHelp;
                return;
            }
            // ESC closes help overlay when visible
            if (showHelp && (k === 'Escape' || k === 'Esc')) {
                e.preventDefault();
                e.stopImmediatePropagation();
                showHelp = false;
                return;
            }
            // Trait bar toggle (both modes) — V
            if (k === 'v' || k === 'V') {
                e.preventDefault();
                showTraitBar = !showTraitBar;
                return;
            }
            // Purpose class nav (both modes; wrap and skip empty) — right moved to C
            if (k === 'z' || k === 'Z' || k === 'c' || k === 'C') {
                e.preventDefault();
                const dir = (k === 'z' || k === 'Z') ? -1 : 1;
                const list = traitsForCurrent || [];
                const counts: Record<string, number> = {};
                for (const t of list) { const key = normalizedPurpose(t.purpose_class); counts[key] = (counts[key]||0) + 1; }
                let nextIdx = PURPOSE_CLASSES.indexOf(selectedPurpose);
                for (let i = 0; i < PURPOSE_CLASSES.length; i++) {
                    nextIdx = (nextIdx + dir + PURPOSE_CLASSES.length) % PURPOSE_CLASSES.length;
                    const pc = PURPOSE_CLASSES[nextIdx];
                    if ((counts[pc] ?? 0) > 0) { selectedPurpose = pc; break; }
                }
                return;
            }
            // Trait bar page next (wrap) — X (notify trait bar component)
            if (k === 'x' || k === 'X') {
                e.preventDefault();
                window.dispatchEvent(new CustomEvent('traitbar:pageNext'));
                return;
            }
            if (exploreIndex !== null) return;
            // Enter exploration for current token (gallery)
            if (k === 'w' || k === 'W') {
                e.preventDefault();
                const it = items[activeIndex];
                if (it) openExploreByMint(it.token_mint_addr);
                return;
            }
            // navigation handled on keyup to avoid key-repeat drag
            if (k === "ArrowLeft" || k === "a" || k === "A" || k === "ArrowRight" || k === "d" || k === "D") {
                return;
            } else if (k === 'Home') {
                e.preventDefault();
                scrollerRef?.scrollToIndexInstant?.(0);
            } else if (k === 'End') {
                e.preventDefault();
                scrollerRef?.scrollToIndexInstant?.(items.length - 1);
            } else if (k === 'f' || k === 'F') {
                e.preventDefault();
                focusCurrent();
            } else if (k === 'm' || k === 'M') {
                e.preventDefault();
                motionEnabled = !motionEnabled;
                if (!motionEnabled) scrollerRef?.cancel?.();
            }
        };
        const onKeyUp = (e: KeyboardEvent) => {
            if (exploreIndex !== null) return; // gallery only
            const k = e.key;
            if (k === "ArrowLeft" || k === "a" || k === "A") {
                e.preventDefault();
                prevSlide();
            } else if (k === "ArrowRight" || k === "d" || k === "D") {
                e.preventDefault();
                nextSlide();
            }
        };
        window.addEventListener("keydown", onKey);
        window.addEventListener("keyup", onKeyUp);
        return () => {
            clearInterval(id);
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("keyup", onKeyUp);
        };
    });

    // --- Horizontal browsing helpers ---

    // Utilities moved inside GalleryScroller

    // --- Trait bar helpers ---
    function currentItem(): ListingRow | null {
        if (exploreIndex !== null && exploreItems) return exploreItems[exploreIndex] || null;
        return items[activeIndex] || null;
    }
    function normalizedPurpose(p: string | null | undefined): Purpose {
        const v = (p || "").toLowerCase();
        const m = PURPOSE_CLASSES.find((x) => x === v);
        return (m ?? "undefined") as Purpose;
    }
    // Trait bar sizing, paging, and counts are implemented inside TraitBar
    import { dbg } from "./debug";

    async function applyValueFilterAndFetch() {
        loading = true;
        try {
            const cur = currentItem();
            const curMint = cur?.token_mint_addr || null;
            const beforeScrollLeft = -1;
            const beforeClientWidth = -1;
            dbg('[traits] apply start', {
                selectedValueIds: Array.from(selectedValueIds),
                curMint,
                curTokenNum: cur?.token_num ?? null,
                activeIndex,
                exploreIndex,
                itemsLen: items.length,
                beforeScrollLeft,
                beforeClientWidth,
            });
            const data = await postSearchListings({
                mode: 'value',
                valueIds: Array.from(selectedValueIds),
                sort: 'price_asc',
                offset: 0,
                limit: 100,
                includeTraits: true,
            });
            const newItems = data.items ?? [];
            items = newItems;
            versionId = data.versionId ?? null;
            // Keep current token in focus if present in new result
            let found = -1;
            if (curMint) {
                found = newItems.findIndex((r) => r.token_mint_addr === curMint);
            }
            // Update exploration state if open
            if (exploreIndex !== null) {
                exploreItems = newItems.slice();
                if (found >= 0) exploreIndex = found; // keep same token if possible
                else exploreIndex = Math.min(exploreIndex, Math.max(0, newItems.length - 1));
            }
            // Wait for DOM to reflect the new items so scroll range is correct
            await tick();
            await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
            if (found >= 0) {
                // Scroll gallery to the same token explicitly
                scrollerRef?.scrollToIndexInstant?.(found);
                activeIndex = found;
            } else {
                // Do not jump; keep visual position and recompute nearest index
                const nIdx = activeIndex; // keep current
                activeIndex = nIdx;
            }
            const afterScrollLeft = -1;
            dbg('[traits] apply end (pre-tick)', {
                newTotal: data.total,
                newItemsLen: newItems.length,
                found,
                decidedIndex: activeIndex,
                afterScrollLeft,
            });
            // Extra: log a tick later for post-layout verification
            setTimeout(() => {
                dbg('[traits] post-tick', {
                    scrollLeft: -1,
                    clientWidth: -1,
                    activeIndex,
                });
            }, 0);
        } catch (e: any) {
            error = e?.message || String(e);
        } finally {
            loading = false;
        }
    }
    // Handlers for TraitBar component events (avoid TS in template expressions)
    function handleToggleValue(e: CustomEvent<number>) {
        const id = e.detail;
        const next = new Set<number>(selectedValueIds);
        if (next.has(id)) next.delete(id); else next.add(id);
        selectedValueIds = next; // reassign to trigger reactivity in TraitBar
        applyValueFilterAndFetch();
    }
    function handlePurposeChange(e: CustomEvent<string>) {
        selectedPurpose = (e.detail as any as Purpose);
    }
    // Trait value clicks and paging handled within TraitBar component

    // Scroller animation and snap helpers exist in GalleryScroller
    function handleWheel(e: WheelEvent) {
        // Forward Y->X wheel mapping to GalleryScroller
        scrollerRef?.wheelY?.(e.deltaY);
        e.preventDefault();
    }
    // Methods now provided by GalleryScroller via scrollerRef
    let scrollerRef: any = null;
    function prevSlide() { scrollerRef?.prev?.(); }
    function nextSlide() { scrollerRef?.next?.(); }
    function focusCurrent() { scrollerRef?.focusCurrent?.(); }

    function openExploreByMint(mint: string) {
        exploreItems = items.slice(); // freeze current page order
        const idx = exploreItems.findIndex((r) => r.token_mint_addr === mint);
        exploreIndex = idx >= 0 ? idx : 0;
    }
    function closeExplore() {
        exploreIndex = null;
        exploreItems = null;
    }

    function navigatePrev() {
        if (exploreItems && exploreIndex !== null) {
            if (exploreIndex > 0) {
                exploreIndex = exploreIndex - 1;
            }
        }
    }
    function navigateNext() {
        if (exploreItems && exploreIndex !== null) {
            if (exploreIndex < exploreItems.length - 1) {
                exploreIndex = exploreIndex + 1;
            }
        }
    }

    // Edge overlays should match the visible image height
    let edgeHeight = 0;
    function recomputeEdgeHeight() {
        const rect = scrollerRef?.getCurrentImageClientRect?.();
        if (rect && rect.height) {
            edgeHeight = Math.round(rect.height);
        } else if (typeof window !== 'undefined') {
            edgeHeight = Math.round(window.innerHeight);
        }
    }
    $: activeIndex, recomputeEdgeHeight();
    if (typeof window !== 'undefined') {
        window.addEventListener('resize', recomputeEdgeHeight);
        setTimeout(recomputeEdgeHeight, 0);
    }
</script>

<style>
    .container {
        position: relative;
        margin: 0;
        padding: 0;
    }
    .status { opacity: 0.8; font-size: 14px; padding: 8px 0 16px; }
    .error { color: #ff6b6b; }
    /* Scroller styles moved into GalleryScroller.svelte */
    /* Edge click targets for prev/next */
    .edge { position: fixed; top: 0; height: 1087px; width: 25px; z-index: 5; cursor: pointer; background: transparent; border: 0; padding: 0; outline: none; }
    .edge:focus, .edge:focus-visible { outline: none; }
    .edge.left { left: 0; }
    .edge.right { right: 0; }
    .edge:hover { background: linear-gradient(to right, rgba(255,255,255,0.04), transparent); }
    .edge.right:hover { background: linear-gradient(to left, rgba(255,255,255,0.04), transparent); }

    /* Help overlay */
    /* help overlay styles moved to components/HelpOverlay.svelte */

    /* Trait bar styles are scoped in TraitBar.svelte */
    /* Trait bar styles live within TraitBar component */
</style>

<div class="container">
    

    <!-- Horizontal scroller -->
    <!-- Gallery Scroller (extracted) -->
    <GalleryScroller
        bind:activeIndex
        items={items}
        motionEnabled={motionEnabled}
        on:enterExplore={(e) => openExploreByMint(e.detail)}
        on:imageLoad={recomputeEdgeHeight}
        bind:this={scrollerRef}
    />

    <!-- Edge click targets for mouse-only navigation -->
    <button type="button" class="edge left" title="Previous" aria-label="Previous" on:click={prevSlide} on:wheel|preventDefault={handleWheel} style={`height:${edgeHeight}px; top: 0px;`}></button>
    <button type="button" class="edge right" title="Next" aria-label="Next" on:click={nextSlide} on:wheel|preventDefault={handleWheel} style={`height:${edgeHeight}px; top: 0px;`}></button>

    <!-- Hotkeys help overlay -->
    <HelpOverlay visible={showHelp} onClose={() => (showHelp = false)} />
    
    <!-- Centered toggle button that follows bar state (always visible) -->
    <ToggleButton show={showTraitBar} on:toggle={() => { showTraitBar = !showTraitBar; }} />

    <!-- Trait bar (extracted) -->
    {#if showTraitBar}
        <TraitBar
            traits={traitsForCurrent}
            bind:selectedPurpose
            {selectedValueIds}
            on:toggleValue={handleToggleValue}
            on:purposeChange={handlePurposeChange}
        />
    {/if}
<!-- Full-screen explorer overlay -->
{#if exploreIndex !== null && exploreItems}
    <ImageExplorer
        url={exploreItems[exploreIndex].image_url}
        onClose={closeExplore}
        maxZoomFactor={8}
        onPrev={navigatePrev}
        onNext={navigateNext}
    />
{/if}
</div>
