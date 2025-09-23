<script lang="ts">
    import { onMount } from "svelte";
    import ImageExplorer from "./ImageExplorer.svelte";

    type ListingTrait = {
        type_id: number;
        type_name: string;
        spatial_group: string | null;
        purpose_class: string | null;
        value_id: number;
        value: string;
    };

    type ListingRow = {
        token_mint_addr: string;
        token_num: number | null;
        price: number;
        seller: string;
        image_url: string;
        listing_source: string;
        // enriched fields from POST /listings/search
        token_id: number;
        token_name: string | null;
        traits?: ListingTrait[];
    };

    type ApiResponse = {
        versionId: number;
        total: number;
        offset: number;
        limit: number;
        sort: string;
        items: ListingRow[];
    };

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

    const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? "http://localhost:3000";

    // Horizontal scroller state
    let scrollerEl: HTMLDivElement | null = null;
    let activeIndex = 0; // nearest item to viewport center
    // Linear horizontal scroll with JS finalize-to-center
    const WHEEL_MULTIPLIER = 1.4; // tuned for continuous travel feel
    const FINALIZE_DELAY_MS = 0; // debounce scroll-end
    const LEAVE_THRESHOLD_PX = 1000; // must move this far from last center to snap
    const BLOCK_SCROLL_MS = 100; // post-snap block window (auto-snap mode only)
    let scrollEndTimer: any = null;
    let lastSnapIndex = 0; // last centered slide index
    let blockUntilTs = 0; // timestamp until which wheel is blocked (auto-snap)

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
            const res = await fetch(`${API_BASE}/listings/search`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    mode: "value",
                    valueIds: [],
                    sort: "price_asc",
                    offset: 0,
                    limit: 100,
                    includeTraits: true,
                }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: ApiResponse = await res.json();
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
            const res = await fetch(`${API_BASE}/listings/search`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    mode: "value",
                    valueIds: [],
                    sort: "price_asc",
                    offset: 0,
                    limit: 100,
                    includeTraits: true,
                }),
            });
            if (!res.ok) return; // silent
            const data: ApiResponse = await res.json();
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
            if (exploreIndex !== null) return;
            if (k === "ArrowLeft" || k === "a" || k === "A") {
                e.preventDefault();
                prevSlide();
            } else if (k === "ArrowRight" || k === "d" || k === "D") {
                e.preventDefault();
                nextSlide();
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
        window.addEventListener("keydown", onKey);
        return () => {
            clearInterval(id);
            window.removeEventListener("keydown", onKey);
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
        }
    }
    function handleScroll() {
        if (isAnimating) return; // ignore scrolls during animation to avoid bounce
        activeIndex = nearestIndex();
        applyStagedIfAtStart();
        if (!motionEnabled || prefersReducedMotion) {
            return; // no automated snap when motion is off or reduced
        }
        if (scrollEndTimer) clearTimeout(scrollEndTimer);
        scrollEndTimer = setTimeout(() => {
            if (!scrollerEl) return;
            const cw = scrollerEl.clientWidth || 1;
            const lastCenter = lastSnapIndex * cw;
            const dx = scrollerEl.scrollLeft - lastCenter;
            const dist = Math.abs(dx);
            // Only snap if user moved sufficiently away from the last center;
            // and always snap to the adjacent slide in the direction of travel
            if (dist >= LEAVE_THRESHOLD_PX) {
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
    .edge { position: fixed; top: 0; height: 1327px; width: 6vw; min-width: 60px; z-index: 5; cursor: pointer; background: transparent; border: 0; padding: 0; outline: none; }
    .edge:focus, .edge:focus-visible { outline: none; }
    .edge.left { left: 0; }
    .edge.right { right: 0; }
    .edge:hover { background: linear-gradient(to right, rgba(255,255,255,0.04), transparent); }
    .edge.right:hover { background: linear-gradient(to left, rgba(255,255,255,0.04), transparent); }

    /* Help overlay */
    .help-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
    }
    .help-panel {
        background: rgba(12,12,14,0.98);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 8px;
        width: min(90vw, 820px);
        max-height: 80vh;
        overflow: auto;
        padding: 16px 20px;
        color: #e6e6e6;
        box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    }
    .help-panel h2 { margin: 6px 0 8px; font-size: 18px; }
    .help-panel h3 { margin: 12px 0 6px; font-size: 15px; opacity: 0.9; }
    .help-panel ul { margin: 6px 0 10px 18px; padding: 0; }
    .help-panel li { margin: 4px 0; }
    .kbd { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; background: #1b1b1d; border: 1px solid rgba(255,255,255,0.12); border-radius: 4px; padding: 1px 6px; }
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
    {#if showHelp}
        <div class="help-backdrop" on:click={() => (showHelp = false)}>
            <div class="help-panel" role="dialog" aria-modal="true" on:click|stopPropagation>
                <h2>Keyboard Shortcuts</h2>
                <div class="status" style="padding:0 0 8px; opacity:0.75;">Press <span class="kbd">H</span> or <span class="kbd">F1</span> to close</div>

                <h3>Gallery (Horizontal Scroll)</h3>
                <ul>
                    <li><span class="kbd">←</span>/<span class="kbd">→</span> or <span class="kbd">A</span>/<span class="kbd">D</span> — Previous/Next image</li>
                    <li><span class="kbd">F</span> — Focus/center current image</li>
                    <li><span class="kbd">M</span> — Toggle motion (auto‑snap + animation)</li>
                    <li><span class="kbd">Home</span>/<span class="kbd">End</span> — Jump to first/last</li>
                    <li>Mouse wheel — Horizontal travel</li>
                    <li>Click screen edges — Previous/Next</li>
                    <li><span class="kbd">H</span> / <span class="kbd">F1</span> — Toggle this help</li>
                </ul>

                <h3>Exploration Mode</h3>
                <ul>
                    <li><span class="kbd">Esc</span> — Close exploration</li>
                    <li><span class="kbd">←</span>/<span class="kbd">→</span> or <span class="kbd">A</span>/<span class="kbd">D</span> — Previous/Next</li>
                    <li><span class="kbd">S</span> — Fit‑by‑width centered</li>
                    <li><span class="kbd">W</span>/<span class="kbd">Q</span>/<span class="kbd">E</span> — Fit entire height (middle/left/right)</li>
                    <li><span class="kbd">1</span>/<span class="kbd">2</span>/<span class="kbd">3</span> — Fit 1006px band (left/middle/right)</li>
                    <li><span class="kbd">G</span> — Toggle debug overlay</li>
                    <li>Double‑click — Reset to fit‑by‑width</li>
                </ul>
            </div>
        </div>
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
