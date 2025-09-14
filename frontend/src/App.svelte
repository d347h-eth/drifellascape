<script lang="ts">
    import { onMount } from "svelte";
    import ImageExplorer from "./ImageExplorer.svelte";

    type ListingRow = {
        token_mint_addr: string;
        token_num: number | null;
        price: number;
        seller: string;
        image_url: string;
        listing_source: string;
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

    const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? "http://localhost:3000";

    async function loadListings() {
        loading = true;
        error = null;
        try {
            const res = await fetch(`${API_BASE}/listings?limit=100`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: ApiResponse = await res.json();
            items = data.items ?? [];
            versionId = data.versionId ?? null;
        } catch (e: any) {
            error = e?.message || String(e);
        } finally {
            loading = false;
        }
    }

    const POLL_MS = Number((import.meta as any).env?.VITE_POLL_MS ?? 30000);

    function atTop(): boolean {
        // Consider within 50px of top as "at top"
        return typeof window !== "undefined" && window.scrollY <= 50;
    }

    function applyStagedIfAtTop() {
        if (exploreIndex !== null) return; // ignore while in explore mode
        if (stagedItems && stagedVersionId && atTop()) {
            items = stagedItems;
            versionId = stagedVersionId;
            stagedItems = null;
            stagedVersionId = null;
        }
    }

    async function pollForUpdates() {
        try {
            const res = await fetch(`${API_BASE}/listings?limit=100`);
            if (!res.ok) return; // silent
            const data: ApiResponse = await res.json();
            if (typeof data?.versionId === "number" && data.versionId !== versionId) {
                stagedItems = data.items ?? [];
                stagedVersionId = data.versionId;
                // If user is at top now, apply immediately
                applyStagedIfAtTop();
            }
        } catch {
            // ignore transient errors
        }
    }

    onMount(() => {
        loadListings();
        const id = setInterval(pollForUpdates, Math.max(5000, POLL_MS));
        const onScroll = () => applyStagedIfAtTop();
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            clearInterval(id);
            window.removeEventListener("scroll", onScroll);
        };
    });

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

    function openExplore(idx: number) {
        exploreItems = items.slice(); // freeze current page order
        exploreIndex = idx;
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
        max-width: 2560px;
        margin: 0 auto;
        padding: 0; /* no side padding so image can occupy full width */
    }
    .status {
        opacity: 0.8;
        font-size: 14px;
        padding: 8px 0 16px;
    }
    .error {
        color: #ff6b6b;
    }
    .row {
        padding: 12px 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    .img-wrap {
        width: 100%;
        overflow: hidden; /* hide overflow if any */
    }
    .img-button {
        display: block;
        width: 100%;
        padding: 0;
        margin: 0;
        border: 0;
        background: transparent;
        cursor: zoom-in;
    }
    img.token {
        display: block;
        width: 100%;
        max-width: 2560px; /* never upscale above native 2560 width */
        height: auto;
        margin: 0 auto; /* center horizontally */
        object-fit: contain; /* keep landscape ratio */
    }
    .meta {
        display: flex;
        align-items: center;
        justify-content: center; /* center horizontally */
        padding: 8px 0; /* use full width, minimal height */
        font-size: 14px;
    }
    .price,
    .price-link {
        font-variant-numeric: tabular-nums;
    }
    .price-link {
        text-decoration: none; /* no underline */
        color: inherit;       /* no visited color change */
    }
    .price-link:visited {
        color: inherit;
    }
</style>

<div class="container">
    <h1>Drifellascape Listings</h1>
    <div class="status">
        {#if loading}
            Loading…
        {:else if error}
            <span class="error">{error}</span>
        {:else}
            Version {versionId} — showing {items.length} items
        {/if}
    </div>

    {#each items as it, idx (it.token_mint_addr)}
        {@const m = marketplaceFor(it.listing_source, it.token_mint_addr)}
        <div class="row">
            <div class="img-wrap">
                <button
                    type="button"
                    class="img-button"
                    aria-label={`Explore token ${it.token_num ?? it.token_mint_addr}`}
                    on:click={() => openExplore(idx)}
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
                    <a
                        class="price-link"
                        href={m.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={m.title}
                    >
                        {formatSol(priceWithFees(it.price))} SOL
                    </a>
                {:else}
                    <span class="price">{formatSol(priceWithFees(it.price))} SOL</span>
                {/if}
            </div>
        </div>
    {/each}
<!-- Full-screen explorer overlay -->
{#if exploreIndex !== null && exploreItems}
    <ImageExplorer
        url={exploreItems[exploreIndex].image_url}
        onClose={closeExplore}
        maxZoomFactor={4}
        onPrev={navigatePrev}
        onNext={navigateNext}
    />
{/if}
</div>
