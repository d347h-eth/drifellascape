<script lang="ts">
    import { onMount, tick } from "svelte";
    import ImageExplorer from "./ImageExplorer.svelte";
    import GalleryScroller from "./components/GalleryScroller.svelte";
    import GridView from "./components/GridView.svelte";
    import HelpOverlay from "./components/HelpOverlay.svelte";
    import AboutOverlay from "./components/AboutOverlay.svelte";
    import LandscapeOverlay from "./components/LandscapeOverlay.svelte";
    import StatusBar from "./components/StatusBar.svelte";
    import TraitBar from "./components/TraitBar/TraitBar.svelte";
    import { postSearch, buildSearchBody, DEFAULT_SEARCH_LIMIT } from "./lib/search";
    import { loadInitialPage, loadNextPage, loadPrevPage, dedupeAppend, dedupePrepend } from "./lib/pager";
    import { preserveTopAnchor } from './lib/viewport';
    import type { Row, ListingTrait, DataSource } from "./lib/types";

    // Types moved to lib/types.ts

    let items: Row[] = [];
    let versionId: number | null = null;
    let total: number | null = null;
    // For tokens paging, track the base offset of the first item in `items`
    let baseOffset: number = 0;
    // Anchor control centralised in anchor store
    import { arm as anchorArm, updateFromFocused as anchorUpdateFromFocused, selectAnchorMint, lastMint as anchorLastMint } from './lib/anchor';
    import { get as getStore } from 'svelte/store';
    // Staged data waiting for user to scroll to top
    let stagedItems: Row[] | null = null;
    let stagedVersionId: number | null = null;
    let stagedTotal: number | null = null;
    let loading = true;
    let error: string | null = null;
    let exploreIndex: number | null = null;
    let exploreItems: Row[] | null = null;
    let showHelp = false;
    let showAbout = false;
    let showTraitBar = false;
    import { PURPOSES, type Purpose, normalizedPurpose } from './lib/purposes';
    let selectedPurpose: Purpose = "middle";
    // Trait bar paging is encapsulated in TraitBar
    let selectedValueIds: Set<number> = new Set();
    // Map of selected trait value id -> display label (best-effort, derived from current items' traits)
    let selectedValueMeta: Record<number, string> = {};
    let traitsForCurrent: ListingTrait[] = [];
    // Grid mode state
    let gridMode = true; // homepage defaults to grid mode with listings
    let gridTargetMint: string | null = null;

    // Horizontal scroller state (delegated to GalleryScroller)
    let activeIndex = 0; // nearest item to viewport center

    // Snap and scrollbar release logic are handled within GalleryScroller

    // Motion + autosnap + device flags
    let motionEnabled = true;
    let autoSnapEnabled = true;
    let isMobile = false;
    let showMainBar = true;
    let showEdgeHints = false;
    let edgeHintTimer: any = null;
    let portrait = false;
    let landscapeOverlayClosed = false;
    let showScrollShim = false;
    let initialVVH = 0;

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

    let dataSource: DataSource = 'listings';
    // Sort state per source
    let sortAscListings: boolean = true;
    let sortAscTokens: boolean = true;
    function currentSort(): string {
        if (dataSource === 'tokens') return sortAscTokens ? 'token_asc' : 'token_desc';
        return sortAscListings ? 'price_asc' : 'price_desc';
    }

    let pagingSession = 0;
    let gridCurrentPage = 1;
    function computeTotalPages(): number { return Math.max(1, Math.ceil(Number(total || 0) / DEFAULT_SEARCH_LIMIT)); }
    function computeGridPageForward(): number {
        const lastLoadedIndex = baseOffset + Math.max(0, items.length - 1);
        return Math.floor(lastLoadedIndex / DEFAULT_SEARCH_LIMIT) + 1;
    }
    function computeGridPageBackward(): number {
        return Math.floor(baseOffset / DEFAULT_SEARCH_LIMIT) + 1;
    }

    // Best-effort resolution of selected value ids to labels from the current/in-focus token only
    $: {
        const meta: Record<number, string> = {};
        const ts = traitsForCurrent || [];
        const lookup = new Map<number, string>();
        for (const t of ts) {
            if (!lookup.has(t.value_id)) lookup.set(t.value_id, t.value);
        }
        for (const id of selectedValueIds) {
            const v = lookup.get(id);
            if (v) meta[id] = v;
        }
        selectedValueMeta = meta;
    }

    async function loadListings() { // existing name kept, behavior depends on dataSource
        loading = true;
        error = null;
        pagingSession++;
        isLoadingMore = false;
        try {
            const res = await loadInitialPage({ source: dataSource, valueIds: [], offset: 0, limit: DEFAULT_SEARCH_LIMIT, includeTraits: true, sort: currentSort() });
            items = res.items;
            total = res.total;
            baseOffset = res.baseOffset;
            versionId = res.versionId;
            gridCurrentPage = computeGridPageBackward();
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
            total = stagedTotal ?? total;
            stagedTotal = null;
            baseOffset = 0; // listings polling path always uses offset 0
            activeIndex = 0;
        }
    }

    async function pollForUpdates() {
        try {
            if (dataSource !== 'listings') return; // tokens are static; skip polling
            const body = buildSearchBody({ source: 'listings', valueIds: [], offset: 0, limit: DEFAULT_SEARCH_LIMIT, includeTraits: true, sort: currentSort() });
            const data = await postSearch('listings', body);
            if (typeof data?.versionId === "number" && data.versionId !== versionId) {
                stagedItems = data.items ?? [];
                stagedVersionId = data.versionId;
                stagedTotal = typeof data.total === 'number' ? data.total : null;
                // If user is at start now, apply immediately
                applyStagedIfAtStart();
            }
        } catch {
            // ignore transient errors
        }
    }

    onMount(() => {
        try {
            const mm = (q: string) => window.matchMedia && window.matchMedia(q).matches;
            isMobile = (typeof window !== 'undefined') && (mm('(hover: none) and (pointer: coarse)') || ('ontouchstart' in window) || window.innerWidth <= 900);
            portrait = mm('(orientation: portrait)');
            window.addEventListener('resize', () => { try { portrait = mm('(orientation: portrait)'); } catch {} });
        } catch {}
        if (isMobile) autoSnapEnabled = false;
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
            // ESC in Gallery enters Grid (same as G)
            if (!showHelp && (k === 'Escape' || k === 'Esc')) {
                if (exploreIndex === null && !gridMode) {
                    e.preventDefault();
                    enterGrid();
                    return;
                }
            }
            // Focus anchor mint in Grid — F (do not intercept Ctrl/Cmd+F)
            if (gridMode && (k === 'f' || k === 'F')) {
                if (e.ctrlKey || e.metaKey) {
                    // Let browser find-in-page work
                    return;
                }
                e.preventDefault();
                const m = getStore(anchorLastMint);
                if (m) {
                    // Force re-trigger by clearing then setting
                    gridTargetMint = null;
                    setTimeout(() => { gridTargetMint = m; }, 0);
                }
                return;
            }
            // Grid/Gallery toggle — G
            if (k === 'g' || k === 'G') {
                e.preventDefault();
                // In exploration, 'G' should behave like closing the explorer (return to Gallery)
                if (exploreIndex !== null) {
                    closeExplore();
                    return;
                }
                if (gridMode) {
                    // Return to gallery centered at the last focused token
                    exitToGallery();
                } else {
                    enterGrid();
                }
                return;
            }
            // Toggle data source — T (listings <-> tokens)
            if (k === 't' || k === 'T') {
                e.preventDefault();
                const cur = currentItem();
                gridTargetMint = cur?.token_mint_addr ?? null;
                dataSource = dataSource === 'listings' ? 'tokens' : 'listings';
                // Reload with current filters and try to keep focus by mint
                applyValueFilterAndFetch();
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
                let nextIdx = PURPOSES.indexOf(selectedPurpose);
                for (let i = 0; i < PURPOSES.length; i++) {
                    nextIdx = (nextIdx + dir + PURPOSES.length) % PURPOSES.length;
                    const pc = PURPOSES[nextIdx];
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
            if (exploreIndex !== null || gridMode) return;
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
                scrollerRef?.snapToIndex?.(0);
            } else if (k === 'End') {
                e.preventDefault();
                scrollerRef?.snapToIndex?.(items.length - 1);
            } else if (k === 'f' || k === 'F') {
                if (e.ctrlKey || e.metaKey) {
                    // Allow Ctrl/Cmd+F
                    return;
                }
                e.preventDefault();
                focusCurrent();
            } else if (k === 'm' || k === 'M') {
                e.preventDefault();
                motionEnabled = !motionEnabled;
                if (!motionEnabled) scrollerRef?.cancel?.();
            }
        };
        const onKeyUp = (e: KeyboardEvent) => {
            if (exploreIndex !== null || gridMode) return; // gallery only
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
        const maybeRemoveShim = () => {
            if (!showScrollShim) return;
            try {
                const vvh = (window as any).visualViewport?.height || 0;
                if (window.scrollY > 0 || (vvh && initialVVH && vvh > initialVVH + 1)) {
                    showScrollShim = false;
                }
            } catch {}
        };
        window.addEventListener('scroll', maybeRemoveShim, { passive: true });
        try { (window as any).visualViewport?.addEventListener('resize', maybeRemoveShim); } catch {}
        return () => {
            clearInterval(id);
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener('scroll', maybeRemoveShim as any);
            try { (window as any).visualViewport?.removeEventListener('resize', maybeRemoveShim as any); } catch {}
        };
    });

    // --- Horizontal browsing helpers ---

    // Utilities moved inside GalleryScroller

    // --- Trait bar helpers ---
    function currentItem(): Row | null {
        if (exploreIndex !== null && exploreItems) return exploreItems[exploreIndex] || null;
        return items[activeIndex] || null;
    }
    // normalizedPurpose imported from lib/purposes
    // Trait bar sizing, paging, and counts are implemented inside TraitBar
    import { dbg } from "./debug";

    async function applyValueFilterAndFetch() {
        loading = true;
        pagingSession++;
        isLoadingMore = false;
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
            // Determine when to use anchor: in Gallery/Explore always; in Grid only if armed
            const inExploreOrGallery = (exploreIndex !== null) || (!gridMode);
            const anchorMintToUse: string | undefined = selectAnchorMint(gridMode, inExploreOrGallery, curMint);
            // Disarm gallery paging around filter transitions to avoid immediate edge prefetch
            galleryPagingArmed = false;
            const body = buildSearchBody({ source: dataSource, valueIds: Array.from(selectedValueIds), limit: DEFAULT_SEARCH_LIMIT, includeTraits: true, anchorMint: anchorMintToUse, offset: 0, sort: currentSort() });
            const data = await postSearch(dataSource, body);
            let newItems = data.items ?? [];
            items = newItems;
            versionId = data.versionId ?? null;
            total = typeof data.total === 'number' ? data.total : null;
            baseOffset = typeof data.offset === 'number' ? data.offset : 0;
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
                // Keep the same token in view when possible; if not present, keep index
                const nIdx = activeIndex;
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

    // --- Mode toggles (helpers) ---
    function enterGrid() {
        const it = currentItem();
        gridTargetMint = it?.token_mint_addr ?? null;
        if (exploreIndex !== null) closeExplore();
        gridMode = true;
        pagingArmed = false; // avoid immediate paging on entry
    }
    function exitToGallery() {
        const target = gridTargetMint ?? items[activeIndex]?.token_mint_addr ?? items[0]?.token_mint_addr ?? null;
        if (target) {
            openGalleryByMint(target);
        } else {
            gridMode = false;
        }
        if (isMobile) showMainBar = false;
    }

    // --- Infinite scroll for Grid (listings & tokens) ---
    let isLoadingMore = false;
    let isLoadingPrev = false;
    let pagingArmed = false;
    let _prevGridMode = gridMode;
    $: if (gridMode !== _prevGridMode) {
        if (gridMode) {
            // Entering grid: require a fresh user scroll before paging can arm
            pagingArmed = false;
        }
        _prevGridMode = gridMode;
    }
    // Gallery paging arming (separate from Grid)
    let galleryPagingArmed = false;
    let _prevExploreIndex: number | null = exploreIndex;
    let _prevGalleryMode = !gridMode && exploreIndex === null;
    $: {
        const isGallery = !gridMode && exploreIndex === null;
        if (isGallery !== _prevGalleryMode) {
            if (isGallery) galleryPagingArmed = false; // entering gallery: require user interaction
            _prevGalleryMode = isGallery;
        }
        if (exploreIndex !== _prevExploreIndex) {
            if (exploreIndex !== null) galleryPagingArmed = false; // disarm when entering explore
            _prevExploreIndex = exploreIndex;
        }
    }
    if (typeof window !== 'undefined') {
        const arm = () => {
            if (gridMode) pagingArmed = true;
            else if (!gridMode && exploreIndex === null) galleryPagingArmed = true;
        };
        window.addEventListener('wheel', arm, { passive: true });
        window.addEventListener('pointerdown', arm, { passive: true });
        window.addEventListener('keydown', arm);
    }
    async function loadMoreGrid() {
        if (!gridMode) return;
        if (isLoadingMore) return;
        const curTotal = total ?? 0;
        const offset = baseOffset + items.length;
        if (curTotal && offset >= curTotal) return;
        isLoadingMore = true;
        const session = pagingSession;
        try {
            const { newItems, newTotal } = await loadNextPage({ source: dataSource, valueIds: Array.from(selectedValueIds), limit: DEFAULT_SEARCH_LIMIT, includeTraits: true, baseOffset, currentLength: items.length, sort: currentSort() });
            if (session !== pagingSession || !gridMode) return;
            total = newTotal;
            if (newItems.length > 0) {
                const deduped = dedupeAppend(items, newItems);
                if (deduped.length > 0) items = items.concat(deduped);
            }
            gridCurrentPage = computeGridPageForward();
        } catch (e) {
            // ignore transient errors for paging
        } finally {
            isLoadingMore = false;
        }
    }
    function handleLoadMore() { loadMoreGrid(); }

    async function loadPrevGrid() {
        if (!gridMode) return;
        if (isLoadingPrev) return;
        const newOffset = Math.max(0, baseOffset - 100);
        if (newOffset === baseOffset) return;
        isLoadingPrev = true;
        const session = pagingSession;
        // Anchor the first currently rendered cell to keep visual position
        const anchorMint = items[0]?.token_mint_addr;
        const beforeTop = anchorMint ? (document.getElementById(`cell-${anchorMint}`)?.getBoundingClientRect()?.top ?? 0) : 0;
        try {
            const prev = await loadPrevPage({ source: dataSource, valueIds: Array.from(selectedValueIds), limit: DEFAULT_SEARCH_LIMIT, includeTraits: true, baseOffset, sort: currentSort() });
            if (!prev) { isLoadingPrev = false; return; }
            const newItems = prev.newItems;
            if (session !== pagingSession || !gridMode) return;
            if (newItems.length > 0) {
                const deduped = dedupePrepend(items, newItems);
                if (deduped.length > 0) {
                    await preserveTopAnchor(anchorMint, () => {
                        items = deduped.concat(items);
                        baseOffset = prev.newBaseOffset;
                    });
                }
            }
            gridCurrentPage = computeGridPageBackward();
        } catch (e) {
            // ignore
        } finally {
            isLoadingPrev = false;
        }
    }

    // --- Gallery near-edge paging ---
    async function handleLoadMoreGallery() {
        if (gridMode || exploreIndex !== null) return;
        if (isLoadingMore) return;
        const mint = items[activeIndex]?.token_mint_addr;
        if (!mint) return;
        isLoadingMore = true;
        const session = pagingSession;
        try {
            const body = buildSearchBody({ source: dataSource, valueIds: Array.from(selectedValueIds), limit: DEFAULT_SEARCH_LIMIT, includeTraits: true, anchorMint: mint, sort: currentSort() });
            const data = await postSearch(dataSource, body);
            if (session !== pagingSession || gridMode || exploreIndex !== null) return;
            items = data.items ?? [];
            baseOffset = Number(data.offset || 0);
            total = Number(data.total || 0);
            const found = items.findIndex(r => r.token_mint_addr === mint);
            if (found >= 0) scrollerRef?.scrollToIndexInstant?.(found);
        } finally {
            isLoadingMore = false;
        }
    }

    async function handleLoadPrevGallery() {
        if (gridMode || exploreIndex !== null) return;
        if (isLoadingPrev) return;
        const newOffset = Math.max(0, baseOffset - 100);
        if (newOffset === baseOffset) return;
        isLoadingPrev = true;
        const session = pagingSession;
        try {
            const mint = items[activeIndex]?.token_mint_addr;
            if (!mint) return;
            const body = buildSearchBody({ source: dataSource, valueIds: Array.from(selectedValueIds), limit: DEFAULT_SEARCH_LIMIT, includeTraits: true, anchorMint: mint, sort: currentSort() });
            const data = await postSearch(dataSource, body);
            if (session !== pagingSession || gridMode || exploreIndex !== null) return;
            items = data.items ?? [];
            baseOffset = Number(data.offset || 0);
            total = Number(data.total || 0);
            const found = items.findIndex(r => r.token_mint_addr === mint);
            if (found >= 0) scrollerRef?.scrollToIndexInstant?.(found);
        } finally {
            isLoadingPrev = false;
        }
    }
    async function openGalleryByMint(mint: string) {
        const idx = items.findIndex((r) => r.token_mint_addr === mint);
        const i = idx >= 0 ? idx : 0;
        gridMode = false;
        if (isMobile) showMainBar = false;
        anchorArm(mint);
        // Wait for gallery to mount and bind scrollerRef
        await tick();
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        scrollerRef?.scrollToIndexInstant?.(i);
        activeIndex = i;
    }

    function openExploreByMint(mint: string) {
        exploreItems = items.slice(); // freeze current page order
        const idx = exploreItems.findIndex((r) => r.token_mint_addr === mint);
        exploreIndex = idx >= 0 ? idx : 0;
        // Keep gallery in sync with the entered token so exiting lands on it
        if (idx >= 0) {
            scrollerRef?.scrollToIndexInstant?.(idx);
            activeIndex = idx;
        }
        anchorArm(mint);
    }
    function closeExplore() {
        // On exit, land the gallery on the last explored token
        if (exploreIndex !== null) {
            const idx = exploreIndex;
            scrollerRef?.scrollToIndexInstant?.(idx);
            activeIndex = idx;
        }
        exploreIndex = null;
        exploreItems = null;
    }

    function navigatePrev() {
        if (exploreItems && exploreIndex !== null) {
            if (exploreIndex > 0) {
                const nextIdx = exploreIndex - 1;
                exploreIndex = nextIdx;
                // Keep gallery position synchronized behind the overlay
                scrollerRef?.scrollToIndexInstant?.(nextIdx);
                activeIndex = nextIdx;
                const row = exploreItems[nextIdx];
                if (row) anchorUpdateFromFocused(row.token_mint_addr);
            }
        }
    }
    function navigateNext() {
        if (exploreItems && exploreIndex !== null) {
            if (exploreIndex < exploreItems.length - 1) {
                const nextIdx = exploreIndex + 1;
                exploreIndex = nextIdx;
                // Keep gallery position synchronized behind the overlay
                scrollerRef?.scrollToIndexInstant?.(nextIdx);
                activeIndex = nextIdx;
                const row = exploreItems[nextIdx];
                if (row) anchorUpdateFromFocused(row.token_mint_addr);
            }
        }
    }

    // Update anchor mint while in Gallery (not exploring) as the focused token changes
    $: if (!gridMode && exploreIndex === null) {
        const row = items[activeIndex];
        if (row) anchorUpdateFromFocused(row.token_mint_addr);
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
    .edge { position: fixed; top: 0; height: 1087px; width: 25px; z-index: 5; cursor: pointer; background: transparent; border: 0; padding: 0; outline: none; transition: opacity 0.25s ease; }
    .edge:focus, .edge:focus-visible { outline: none; }
    .edge.left { left: 0; }
    .edge.right { right: 0; }
    .edge:hover { background: linear-gradient(to right, rgba(255,255,255,0.04), transparent); }
    .edge.right:hover { background: linear-gradient(to left, rgba(255,255,255,0.04), transparent); }
    .edge.hint-l { opacity: 0.9; background: linear-gradient(to right, rgba(255,255,255,0.08), transparent); }
    .edge.hint-r { opacity: 0.9; background: linear-gradient(to left, rgba(255,255,255,0.08), transparent); }
    .edge.hint-l::after, .edge.hint-r::after { content: ''; position: absolute; top: 50%; transform: translateY(-50%); color: rgba(255,255,255,0.7); font-size: 22px; }
    .edge.hint-l::after { content: '‹'; left: 6px; }
    .edge.hint-r::after { content: '›'; right: 6px; }

    /* Help overlay */
    /* help overlay styles moved to components/HelpOverlay.svelte */

    /* Trait bar styles are scoped in TraitBar.svelte */
    /* Trait bar styles live within TraitBar component */
    .mobile-mainbar-toggle {
        position: fixed; left: 12px; width: 50px; height: 50px;
        background: rgba(0,0,0,0.65); color: #e6e6e6; border: 0; border-radius: 6px;
        z-index: 9600; display: inline-flex; align-items: center; justify-content: center;
    }
    .mobile-mainbar-toggle:hover { background: rgba(0,0,0,0.75); }
    .bottom-stack {
        position: fixed;
        left: 0;
        right: 0;
        display: flex;
        flex-direction: column;
        gap: 0;
        z-index: 9500;
        pointer-events: auto;
    }
    .scroll-shim { height: 24px; width: 1px; }
    .scroll-hint { position: fixed; left: 50%; transform: translateX(-50%); bottom: 56px; background: rgba(0,0,0,0.7); color: #e6e6e6; font-size: 12px; padding: 6px 10px; border-radius: 6px; z-index: 9700; }
</style>

<div class="container">
    {#if !gridMode}
        <!-- Horizontal scroller -->
        <!-- Gallery Scroller (extracted) -->
        <GalleryScroller
            bind:activeIndex
            items={items}
            showMeta={dataSource === 'listings'}
            motionEnabled={motionEnabled}
            autoSnapEnabled={autoSnapEnabled}
            galleryPagingEnabled={!gridMode && exploreIndex === null && galleryPagingArmed}
            on:loadMore={() => handleLoadMoreGallery()}
            on:loadPrev={() => handleLoadPrevGallery()}
            on:enterExplore={(e) => openExploreByMint(e.detail)}
            on:imageLoad={recomputeEdgeHeight}
            on:manualScroll={() => {
                if (!isMobile) return;
                showEdgeHints = true;
                if (edgeHintTimer) clearTimeout(edgeHintTimer);
                edgeHintTimer = setTimeout(() => { showEdgeHints = false; }, 250);
            }}
            bind:this={scrollerRef}
        />

        {#if isMobile && !gridMode && exploreIndex === null && showScrollShim}
          <div class="scroll-shim" aria-hidden="true"></div>
        {/if}

        {#if isMobile && !gridMode && exploreIndex === null && showScrollHint}
          <div class="scroll-hint" on:click={() => { showScrollHint = false; try { sessionStorage.setItem('scrollHintShown','1'); } catch {} }}>Swipe up to hide browser UI</div>
        {/if}

        <!-- Edge click targets for mouse-only navigation -->
        <button type="button" class="edge left {isMobile ? 'hint-l' : ''}" title="Previous" aria-label="Previous" on:click={prevSlide} on:wheel|preventDefault={handleWheel} style={`height:${edgeHeight}px; top: 0px;`}></button>
        <button type="button" class="edge right {isMobile ? 'hint-r' : ''}" title="Next" aria-label="Next" on:click={nextSlide} on:wheel|preventDefault={handleWheel} style={`height:${edgeHeight}px; top: 0px;`}></button>
    {:else}
        <!-- Grid mode (vertical) -->
        <GridView
            items={items}
            targetMint={gridTargetMint}
            enablePaging={pagingArmed && !loading && (total ?? 0) > items.length}
            loadingMore={isLoadingMore}
            on:openGallery={(e) => openGalleryByMint(e.detail)}
            on:loadMore={() => handleLoadMore()}
            on:loadPrev={() => loadPrevGrid()}
        />
    {/if}

    <!-- Overlays -->
    <HelpOverlay visible={showHelp} onClose={() => (showHelp = false)} />
    <AboutOverlay visible={showAbout} onClose={() => (showAbout = false)} />
    <!-- Landscape gate for mobile portrait; tap to dismiss -->
    {#if isMobile && portrait && !landscapeOverlayClosed}
      <LandscapeOverlay visible={true} onClose={() => (landscapeOverlayClosed = true)} />
    {/if}
    
    <!-- Bottom stack: fixed container that stacks TraitBar (if visible) above StatusBar, with proper bottom offset -->
    <div class="bottom-stack" style={`bottom: ${isMobile ? 0 : ((!gridMode && exploreIndex === null) ? 15 : 0)}px`}>
        {#if showTraitBar}
            <TraitBar
                traits={traitsForCurrent}
                bind:selectedPurpose
                {selectedValueIds}
                selectedValueMeta={selectedValueMeta}
                galleryMode={!gridMode && exploreIndex === null}
                on:toggleValue={handleToggleValue}
                on:purposeChange={handlePurposeChange}
            />
        {/if}
        <StatusBar
            {dataSource}
            {motionEnabled}
            {autoSnapEnabled}
            {showTraitBar}
            gridMode={gridMode}
            inExplore={exploreIndex !== null}
            {activeIndex}
            {baseOffset}
            itemsLength={items.length}
            total={Number(total || 0)}
            gridCurrentPage={gridCurrentPage}
            filtersApplied={selectedValueIds.size > 0}
            {sortAscListings}
            {sortAscTokens}
            networkBusy={Boolean(loading || isLoadingMore || isLoadingPrev)}
            isMobile={isMobile}
            collapsed={!showMainBar}
            on:toggleSource={() => {
                const cur = currentItem();
                gridTargetMint = cur?.token_mint_addr ?? null;
                dataSource = dataSource === 'listings' ? 'tokens' : 'listings';
                applyValueFilterAndFetch();
            }}
            on:nextMode={() => {
                if (gridMode) exitToGallery();
                else if (exploreIndex !== null) closeExplore();
                else enterGrid();
            }}
            on:toggleSort={async () => {
                if (dataSource === 'tokens') sortAscTokens = !sortAscTokens; else sortAscListings = !sortAscListings;
                // Reset pagination to the first page and index
                loading = true; pagingSession++; isLoadingMore = false; isLoadingPrev = false;
                try {
                    const res = await loadInitialPage({ source: dataSource, valueIds: Array.from(selectedValueIds), offset: 0, limit: DEFAULT_SEARCH_LIMIT, includeTraits: true, sort: currentSort() });
                    items = res.items; total = res.total; baseOffset = res.baseOffset; versionId = res.versionId;
                    await tick();
                    if (!gridMode && exploreIndex === null) { scrollerRef?.scrollToIndexInstant?.(0); activeIndex = 0; }
                } catch {}
                finally { loading = false; }
            }}
            on:toggleMotion={() => { motionEnabled = !motionEnabled; if (!motionEnabled) scrollerRef?.cancel?.(); }}
            on:toggleTraits={() => { showTraitBar = !showTraitBar; }}
            on:toggleAutoSnap={() => { autoSnapEnabled = !autoSnapEnabled; }}
            on:toggleHelp={() => { showHelp = !showHelp; }}
            on:toggleAbout={() => { showAbout = !showAbout; }}
            on:toggleMainBar={() => { showMainBar = !showMainBar; }}
        />
    </div>

    

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
