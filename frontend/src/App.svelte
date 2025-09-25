<script lang="ts">
    import { onMount, tick } from "svelte";
    import ImageExplorer from "./ImageExplorer.svelte";
    import HelpOverlay from "./components/HelpOverlay.svelte";
    import ToggleButton from "./components/TraitBar/ToggleButton.svelte";
    import TraitBar from "./components/TraitBar/TraitBar.svelte";
    import { postSearchListings } from "./lib/api";
    import type { ListingRow, ListingTrait, ApiResponse } from "./lib/types";

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
    let traitBarOffset = 0; // index within filtered traits for current token
    let visibleTraitSlots = 0; // computed on resize
    const selectedValueIds = new Set<number>();

    // Horizontal scroller state
    let scrollerEl: HTMLDivElement | null = null;
    let activeIndex = 0; // nearest item to viewport center
    // Linear horizontal scroll with JS finalize-to-center
    const WHEEL_MULTIPLIER = 1.5; // tuned for continuous travel feel
    const FINALIZE_DELAY_MS = 0; // debounce scroll-end
    // Snap threshold as a fraction of viewport width (e.g., 0.5 = 50%)
    const LEAVE_THRESHOLD_FRAC = 0.5;
    const BLOCK_SCROLL_MS = 150; // post-snap block window (auto-snap mode only)
    let scrollEndTimer: any = null;
    let lastSnapIndex = 0; // last centered slide index
    let blockUntilTs = 0; // timestamp until which wheel is blocked (auto-snap)
    let suppressFinalizeUntilTs = 0; // suppress finalize after programmatic jumps
    const SCROLLBAR_HIT_PX = 24; // heuristic thickness for native scrollbar hit test
    let draggingScrollbar = false;
    let dragStartScrollLeft = -1;
    let dragStartIndex = -1;
    let dragStartLastSnapIndex = -1;

    function finalizeDirectionalSnap() {
        if (!scrollerEl) return;
        const cw = scrollerEl.clientWidth || 1;
        const lastCenter = lastSnapIndex * cw;
        const dx = scrollerEl.scrollLeft - lastCenter;
        const dist = Math.abs(dx);
        const thresholdPx = cw * LEAVE_THRESHOLD_FRAC;
        dbg('[scrollbar] release start', {
            dragStartScrollLeft,
            dragStartIndex,
            dragStartLastSnapIndex,
            scrollLeft: scrollerEl.scrollLeft,
            clientWidth: cw,
            lastSnapIndex,
            activeIndex,
            dx,
            dist,
            thresholdPx,
        });
        if (dist >= thresholdPx) {
            // On scrollbar release, snap to the nearest slide center rather than only adjacent
            const idxNear = clamp(Math.round(scrollerEl.scrollLeft / cw), 0, Math.max(0, items.length - 1));
            const idx = idxNear;
            scrollToIndex(idx, true);
            // avoid a double finalize right after snapping
            suppressFinalizeUntilTs = Date.now() + 300;
            dbg('[scrollbar] release snapped', { targetIndex: idx, lastSnapIndex, afterScrollLeft: scrollerEl.scrollLeft });
        } else {
            dbg('[scrollbar] release no-snap', { lastSnapIndex, activeIndex, scrollLeft: scrollerEl.scrollLeft });
        }
        setTimeout(() => dbg('[scrollbar] release post-tick', { scrollLeft: scrollerEl?.scrollLeft ?? -1, activeIndex, lastSnapIndex }), 0);
    }

    // Motion toggle and animator
    const prefersReducedMotion = typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    let motionEnabled = true;
    let isAnimating = false;
    let animReq = 0;
    let animToken = 0;

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
            lastSnapIndex = 0;
        }
    }

    const POLL_MS = Number((import.meta as any).env?.VITE_POLL_MS ?? 30000);

    function atStart(): boolean {
        if (!scrollerEl) return true;
        return scrollerEl.scrollLeft <= 50; // within 50px from start
    }

    function applyStagedIfAtStart() {
        if (exploreIndex !== null) return; // ignore while in explore mode
        if (stagedItems && stagedVersionId && atStart()) {
            items = stagedItems;
            versionId = stagedVersionId;
            stagedItems = null;
            stagedVersionId = null;
            lastSnapIndex = 0;
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
        const onPointerDown = (e: PointerEvent) => {
            if (!scrollerEl) return;
            const r = scrollerEl.getBoundingClientRect();
            if (e.clientY >= r.bottom - SCROLLBAR_HIT_PX) {
                draggingScrollbar = true;
                dragStartScrollLeft = scrollerEl.scrollLeft;
                dragStartIndex = activeIndex;
                dragStartLastSnapIndex = lastSnapIndex;
            }
        };
        const onPointerUp = () => {
            if (draggingScrollbar) {
                draggingScrollbar = false;
                // Snap decision on release based on distance moved from last center
                finalizeDirectionalSnap();
            }
        };
        scrollerEl?.addEventListener('pointerdown', onPointerDown, { passive: true });
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
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
            // Trait bar toggle (both modes) — moved to V
            if (k === 'v' || k === 'V') {
                e.preventDefault();
                showTraitBar = !showTraitBar;
                traitBarOffset = 0;
                setTimeout(recomputeVisibleTraitSlots, 0);
                return;
            }
            // Purpose class nav (both modes; wrap and skip empty) — right moved to C
            if (k === 'z' || k === 'Z' || k === 'c' || k === 'C') {
                e.preventDefault();
                const dir = (k === 'z' || k === 'Z') ? -1 : 1;
                const it = currentItem();
                const list = it?.traits || [];
                const counts: Record<string, number> = {};
                for (const t of list) { const key = normalizedPurpose(t.purpose_class); counts[key] = (counts[key]||0) + 1; }
                let nextIdx = PURPOSE_CLASSES.indexOf(selectedPurpose);
                for (let i = 0; i < PURPOSE_CLASSES.length; i++) {
                    nextIdx = (nextIdx + dir + PURPOSE_CLASSES.length) % PURPOSE_CLASSES.length;
                    const pc = PURPOSE_CLASSES[nextIdx];
                    if ((counts[pc] ?? 0) > 0) { selectedPurpose = pc; break; }
                }
                traitBarOffset = 0;
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
                scrollToIndex(0, false, true); // instant jump to start
            } else if (k === 'End') {
                e.preventDefault();
                scrollToIndex(items.length - 1, false, true); // instant jump to end
            } else if (k === 'f' || k === 'F') {
                e.preventDefault();
                focusCurrent();
            } else if (k === 'm' || k === 'M') {
                e.preventDefault();
                motionEnabled = !motionEnabled;
                if (!motionEnabled) {
                    if (scrollEndTimer) { clearTimeout(scrollEndTimer); scrollEndTimer = null; }
                    cancelAnimation();
                }
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
            scrollerEl?.removeEventListener('pointerdown', onPointerDown as any);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("keyup", onKeyUp);
        };
    });

    // --- Horizontal browsing helpers ---

    function formatSol(raw: number): string {
        const sol = raw / 1_000_000_000;
        // Round up to 2 decimals
        const up = Math.ceil(sol * 100) / 100;
        return up.toFixed(2);
    }

    // Integer arithmetic helpers for fees
    function ceilDiv(n: number, d: number): number {
        return Math.floor((n + d - 1) / d);
    }

    // Returns nominal + maker(2%) + royalty(5%), each fee based on nominal price
    function priceWithFees(nominalLamports: number): number {
        const maker = ceilDiv(nominalLamports * 2, 100); // 2%
        const royalty = ceilDiv(nominalLamports * 5, 100); // 5%
        return nominalLamports + maker + royalty;
    }

    function marketplaceFor(
        src: string | undefined,
        mint: string,
    ): { href: string; title: string } | null {
        if (!src) return null;
        // Magic Eden sources
        if (src === "M2" || src === "MMM" || src === "M3" || src === "HADESWAP_AMM") {
            return {
                href: `https://magiceden.io/item-details/${mint}`,
                title: "View on Magic Eden",
            };
        }
        // Tensor sources
        if (
            src === "TENSOR_LISTING" ||
            src === "TENSOR_CNFT_LISTING" ||
            src === "TENSOR_MARKETPLACE_LISTING" ||
            src === "TENSOR_AMM" ||
            src === "TENSOR_AMM_V2"
        ) {
            return {
                href: `https://tensor.trade/item/${mint}`,
                title: "View on Tensor",
            };
        }
        return null;
    }

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
    function currentFilteredTraits(): ListingTrait[] {
        const it = currentItem();
        const list = it?.traits || [];
        const want = selectedPurpose;
        return list.filter((t) => normalizedPurpose(t.purpose_class) === want);
    }
    let traitsForBar: ListingTrait[] = [];
    let totalTraits = 0;
    let startIdx = 0;
    let endIdx = 0;
    $: {
        // explicit deps so Svelte tracks them
        const _depPurpose = selectedPurpose;
        const _depShow = showTraitBar;
        const _depActive = activeIndex;
        const _depExploreIdx = exploreIndex;
        const _depExploreItems = exploreItems;
        const _depItems = items;
        if (_depShow) {
            const it = currentItem();
            const list = it?.traits || [];
            traitsForBar = list.filter((t) => normalizedPurpose(t.purpose_class) === _depPurpose);
        } else {
            traitsForBar = [];
        }
        totalTraits = traitsForBar.length;
        startIdx = traitBarOffset;
        endIdx = Math.min(totalTraits, startIdx + Math.max(1, visibleTraitSlots || 1));
    }
    function recomputeVisibleTraitSlots() {
        const w = typeof window !== 'undefined' ? window.innerWidth : 1280;
        const ARROWS_W = 100; // 2 * 50px arrow pads
        const BOX_W = 150; // trait box width
        const slots = Math.floor(Math.max(0, w - ARROWS_W) / BOX_W);
        visibleTraitSlots = Math.max(1, slots);
        // Clamp offset to new bounds
        traitBarOffset = Math.min(traitBarOffset, Math.max(0, totalTraits - visibleTraitSlots));
    }
    if (typeof window !== 'undefined') {
        addEventListener('resize', () => recomputeVisibleTraitSlots());
        // initial compute soon after mount
        setTimeout(recomputeVisibleTraitSlots, 0);
    }

    // Purpose counts for current token (for pills)
    let purposeCounts: Record<string, number> = {};
    $: {
        // explicit deps to trigger reactivity on token focus changes
        const _depActive = activeIndex;
        const _depItems = items;
        const _depExploreIdx = exploreIndex;
        const _depExploreItems = exploreItems;
        const _depShow = showTraitBar;
        const it = currentItem();
        const list = it?.traits || [];
        const m: Record<string, number> = {};
        for (const t of list) {
            const key = normalizedPurpose(t.purpose_class);
            m[key] = (m[key] || 0) + 1;
        }
        purposeCounts = m;
    }

    function isValueSelected(id: number): boolean {
        return selectedValueIds.has(id);
    }
    import { dbg } from "./debug";

    async function applyValueFilterAndFetch() {
        loading = true;
        try {
            const cur = currentItem();
            const curMint = cur?.token_mint_addr || null;
            const beforeScrollLeft = scrollerEl?.scrollLeft ?? -1;
            const beforeClientWidth = scrollerEl?.clientWidth ?? -1;
            dbg('[traits] apply start', {
                selectedValueIds: Array.from(selectedValueIds),
                curMint,
                curTokenNum: cur?.token_num ?? null,
                activeIndex,
                lastSnapIndex,
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
                scrollToIndex(found, false, true);
                activeIndex = found;
                lastSnapIndex = found;
            } else {
                // Do not jump; keep visual position and recompute nearest index
                const nIdx = nearestIndex();
                activeIndex = nIdx;
                lastSnapIndex = nIdx;
            }
            const afterScrollLeft = scrollerEl?.scrollLeft ?? -1;
            dbg('[traits] apply end (pre-tick)', {
                newTotal: data.total,
                newItemsLen: newItems.length,
                found,
                decidedIndex: activeIndex,
                lastSnapIndex,
                afterScrollLeft,
            });
            // Extra: log a tick later for post-layout verification
            setTimeout(() => {
                dbg('[traits] post-tick', {
                    scrollLeft: scrollerEl?.scrollLeft ?? -1,
                    clientWidth: scrollerEl?.clientWidth ?? -1,
                    activeIndex,
                    lastSnapIndex,
                });
            }, 0);
        } catch (e: any) {
            error = e?.message || String(e);
        } finally {
            loading = false;
        }
    }
    function onClickTraitValue(v: ListingTrait) {
        if (selectedValueIds.has(v.value_id)) selectedValueIds.delete(v.value_id);
        else selectedValueIds.add(v.value_id);
        applyValueFilterAndFetch();
    }
    function hasPrevTraitPage(): boolean { return traitBarOffset > 0; }
    function hasNextTraitPage(): boolean { return traitBarOffset + visibleTraitSlots < totalTraits; }
    function prevTraitPage() {
        const step = Math.max(1, visibleTraitSlots || 1);
        traitBarOffset = Math.max(0, traitBarOffset - step);
    }
    function nextTraitPage() {
        const step = Math.max(1, visibleTraitSlots || 1);
        traitBarOffset = Math.min(Math.max(0, totalTraits - step), traitBarOffset + step);
    }
    function nextTraitPageWrapped() {
        const step = Math.max(1, visibleTraitSlots || 1);
        if (totalTraits <= 0) return;
        const next = traitBarOffset + step;
        traitBarOffset = next >= totalTraits ? 0 : next;
    }

    // Animation helpers
    function cancelAnimation() {
        if (animReq) cancelAnimationFrame(animReq);
        animReq = 0;
        isAnimating = false;
        animToken++;
    }
    function easeInOutCubic(t: number) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }
    function computeDuration(distancePx: number) {
        // ~1.5x faster: reduce slope and caps
        const perPx = 0.35 / 1.5; // ≈ 0.233 ms/px
        const minMs = 80;  // was 120
        const maxMs = 160; // was 240
        return Math.round(Math.min(maxMs, Math.max(minMs, distancePx * perPx)));
    }
    function animateScrollTo(left: number, idxToSet: number, autoSnap: boolean) {
        if (!scrollerEl) return;
        const start = scrollerEl.scrollLeft;
        const distance = Math.abs(left - start);
        const duration = computeDuration(distance);
        const token = ++animToken;
        isAnimating = true;
        let startTs = 0;
        const step = (ts: number) => {
            if (token !== animToken || !scrollerEl) return; // canceled
            if (!startTs) startTs = ts;
            const t = Math.min(1, (ts - startTs) / duration);
            const eased = easeInOutCubic(t);
            scrollerEl.scrollLeft = start + (left - start) * eased;
            if (t < 1) {
                animReq = requestAnimationFrame(step);
            } else {
                isAnimating = false;
                lastSnapIndex = idxToSet;
                activeIndex = idxToSet;
                if (autoSnap && motionEnabled) {
                    blockUntilTs = Date.now() + BLOCK_SCROLL_MS;
                }
            }
        };
        animReq = requestAnimationFrame(step);
    }

    function clamp(n: number, min: number, max: number) {
        return Math.max(min, Math.min(max, n));
    }
    function nearestIndex(): number {
        if (!scrollerEl) return 0;
        const cw = scrollerEl.clientWidth || 1;
        return clamp(Math.round(scrollerEl.scrollLeft / cw), 0, Math.max(0, items.length - 1));
    }
    function scrollToIndex(i: number, autoSnap = false, forceInstant = false) {
        if (!scrollerEl) return;
        const cw = scrollerEl.clientWidth;
        const idx = clamp(i, 0, Math.max(0, items.length - 1));
        const target = idx * cw;
        if (motionEnabled && !prefersReducedMotion && !forceInstant) {
            animateScrollTo(target, idx, autoSnap);
        } else {
            scrollerEl.scrollLeft = target;
            lastSnapIndex = idx;
            activeIndex = idx;
            if (autoSnap && motionEnabled) {
                blockUntilTs = Date.now() + BLOCK_SCROLL_MS;
            }
            if (forceInstant) {
                suppressFinalizeUntilTs = Date.now() + 200;
            }
        }
    }
    function handleScroll() {
        if (isAnimating) return; // ignore scrolls during animation to avoid bounce
        activeIndex = nearestIndex();
        applyStagedIfAtStart();
        if (!motionEnabled || prefersReducedMotion) {
            return; // no automated snap when motion is off or reduced
        }
        if (Date.now() < suppressFinalizeUntilTs) return;
        if (draggingScrollbar) return; // defer finalize while user drags native scrollbar
        if (scrollEndTimer) clearTimeout(scrollEndTimer);
        scrollEndTimer = setTimeout(() => {
            if (!scrollerEl) return;
            const cw = scrollerEl.clientWidth || 1;
            const lastCenter = lastSnapIndex * cw;
            const dx = scrollerEl.scrollLeft - lastCenter;
            const dist = Math.abs(dx);
            // Only snap if user moved sufficiently away from the last center;
            // and always snap to the adjacent slide in the direction of travel
            const thresholdPx = cw * LEAVE_THRESHOLD_FRAC;
            if (dist >= thresholdPx) {
                const dir = dx > 0 ? 1 : -1;
                const idx = clamp(lastSnapIndex + dir, 0, Math.max(0, items.length - 1));
                scrollToIndex(idx, true);
            }
        }, FINALIZE_DELAY_MS);
    }
    function handleWheel(e: WheelEvent) {
        if (!scrollerEl) return;
        const ax = Math.abs(e.deltaX);
        const ay = Math.abs(e.deltaY);
        // When an animation is in progress, ignore wheel to avoid canceling or fighting the tween
        if (isAnimating) {
            e.preventDefault();
            return;
        }
        // Post-snap block window (auto-snap only)
        if (motionEnabled && Date.now() < blockUntilTs) {
            e.preventDefault();
            return;
        }
        if (ay > ax) {
            e.preventDefault();
            scrollerEl.scrollLeft += e.deltaY * WHEEL_MULTIPLIER;
        }
    }
    function prevSlide() { scrollToIndex(activeIndex - 1); }
    function nextSlide() { scrollToIndex(activeIndex + 1); }
    function focusCurrent() { scrollToIndex(nearestIndex()); }

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
</script>

<style>
    .container {
        position: relative;
        margin: 0;
        padding: 0;
    }
    .status { opacity: 0.8; font-size: 14px; padding: 8px 0 16px; }
    .error { color: #ff6b6b; }
    /* Horizontal scroller */
    .scroller {
        display: flex;
        flex-direction: row;
        overflow-x: auto;
        overflow-y: hidden;
        /* No CSS snap; JS finalize on scroll-end */
        scroll-behavior: auto;
        height: 100vh;
        box-sizing: border-box;
    }
    /* removed dynamic height for scroller; keep native scrollbar at bottom */
    .slide {
        flex: 0 0 100vw;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        justify-content: flex-start; /* top-align content, no gap at top */
        padding: 0;
        box-sizing: border-box;
    }
    .img-wrap { width: 100%; overflow: hidden; }
    .img-button { display: block; width: 100%; padding: 0; margin: 0; border: 0; background: transparent; cursor: zoom-in; outline: none; }
    .img-button:focus, .img-button:focus-visible { outline: none; }
    img.token {
        display: block;
        width: 100%;
        max-width: 2560px;
        height: auto;
        margin: 0 auto;
        object-fit: contain;
    }
    .meta { display: flex; align-items: center; justify-content: center; padding: 8px 0; font-size: 14px; }
    .price,
    .price-link {
        font-variant-numeric: tabular-nums;
    }
    .price-link {
        text-decoration: none; /* no underline */
        color: inherit;       /* no visited color change */
    }
    .price-link:visited { color: inherit; }
    /* Edge click targets for prev/next */
    .edge { position: fixed; top: 0; height: 1087px; width: 6vw; min-width: 60px; z-index: 5; cursor: pointer; background: transparent; border: 0; padding: 0; outline: none; }
    .edge:focus, .edge:focus-visible { outline: none; }
    .edge.left { left: 0; }
    .edge.right { right: 0; }
    .edge:hover { background: linear-gradient(to right, rgba(255,255,255,0.04), transparent); }
    .edge.right:hover { background: linear-gradient(to left, rgba(255,255,255,0.04), transparent); }

    /* Help overlay */
    /* help overlay styles moved to components/HelpOverlay.svelte */

    /* Trait bar overlay */
    .purpose-dots {
        position: fixed;
        left: 0; right: 0; bottom: 82px; /* bar bottom 22 + bar height 50 + ~10px gap */
        height: 22px;
        display: flex; align-items: center; justify-content: center;
        pointer-events: auto;
        z-index: 9001;
    }
    .purpose-dot { cursor: pointer; margin: 0 6px; padding: 3px 8px; font-size: 12px; color: #cfcfd2; background: rgba(12,12,14,0.85); border: 1px solid rgba(255,255,255,0.12); border-radius: 999px; }
    .purpose-dot.active { color: #111; background: #e6e6e6; border-color: #e6e6e6; }
    .purpose-dot.disabled { opacity: 0.35; cursor: default; }
    .purpose-dot:focus, .purpose-dot:focus-visible { outline: none; box-shadow: none; }

    /* Centered toggle button that follows the bar state */
    /* toggle button moved to components/TraitBar/ToggleButton.svelte */

    .trait-bar {
        position: fixed; left: 0; right: 0; bottom: 22px; height: 50px;
        background: rgba(0,0,0,0.6);
        display: flex; align-items: stretch; justify-content: space-between;
        z-index: 9000;
        pointer-events: auto;
    }
    .trait-arrow { width: 50px; height: 50px; border: 0; background: transparent; color: #e6e6e6; cursor: pointer; align-self: center; }
    .trait-arrow:hover { background: rgba(255,255,255,0.06); }
    .trait-arrow:disabled { opacity: 0.25; cursor: default; }
    .trait-strip { flex: 1; display: flex; overflow: hidden; }
    .trait-box { width: 150px; height: 50px; padding: 6px 8px; box-sizing: border-box; border-left: 1px solid rgba(255,255,255,0.06); cursor: pointer; align-self: center; }
    .trait-box:hover { background: rgba(255,255,255,0.06); }
    .trait-box.selected { background: rgba(255,255,255,0.12); }
    .trait-head { font-size: 11px; opacity: 0.8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .trait-val { font-size: 13px; font-weight: 600; white-space: normal; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; line-height: 1.1; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word; }
</style>

<div class="container">
    

    <!-- Horizontal scroller -->
    <div bind:this={scrollerEl} class="scroller" on:scroll={handleScroll} on:wheel={handleWheel}>
        {#each items as it, idx (it.token_mint_addr)}
            {@const m = marketplaceFor(it.listing_source, it.token_mint_addr)}
            <section class="slide" aria-label={`Token ${it.token_num ?? it.token_mint_addr}`}>
                <div class="img-wrap">
                    <button
                        type="button"
                        class="img-button"
                        aria-label={`Explore token ${it.token_num ?? it.token_mint_addr}`}
                        on:click={() => openExploreByMint(it.token_mint_addr)}
                    >
                        <img
                            class="token"
                            src={`/2560/${it.token_mint_addr}.jpg`}
                            alt={`Token ${it.token_num ?? it.token_mint_addr}`}
                            loading="lazy"
                            decoding="async"
                        />
                    </button>
                </div>
                <div class="meta">
                    {#if m}
                        <a class="price-link" href={m.href} target="_blank" rel="noopener noreferrer" title={m.title}>
                            {formatSol(priceWithFees(it.price))} SOL
                        </a>
                    {:else}
                        <span class="price">{formatSol(priceWithFees(it.price))} SOL</span>
                    {/if}
                </div>
            </section>
        {/each}
    </div>

    <!-- Edge click targets for mouse-only navigation -->
    <button type="button" class="edge left" title="Previous" aria-label="Previous" on:click={prevSlide} on:wheel={handleWheel}></button>
    <button type="button" class="edge right" title="Next" aria-label="Next" on:click={nextSlide} on:wheel={handleWheel}></button>

    <!-- Hotkeys help overlay -->
    <HelpOverlay visible={showHelp} onClose={() => (showHelp = false)} />
    
    <!-- Centered toggle button that follows bar state (always visible) -->
    <ToggleButton show={showTraitBar} on:toggle={() => { showTraitBar = !showTraitBar; traitBarOffset = 0; setTimeout(recomputeVisibleTraitSlots, 0); }} />

    <!-- Trait bar (extracted) -->
    {#if showTraitBar}
        <TraitBar
            traits={currentItem()?.traits ?? []}
            bind:selectedPurpose
            {selectedValueIds}
            on:toggleValue={(e) => { const id = e.detail as number; if (selectedValueIds.has(id)) selectedValueIds.delete(id); else selectedValueIds.add(id); applyValueFilterAndFetch(); }}
            on:purposeChange={(e) => { selectedPurpose = e.detail as string; }}
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
