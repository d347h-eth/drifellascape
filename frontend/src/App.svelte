<script lang="ts">
    import { onMount } from "svelte";

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
    img.token {
        display: block;
        width: 100%;
        max-width: 2560px; /* never upscale above native 2560 width */
        height: auto;
        margin: 0 auto; /* center horizontally */
        object-fit: contain; /* keep landscape ratio */
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

    {#each items as it (it.token_mint_addr)}
        <div class="row">
            <div class="img-wrap">
                <img
                    class="token"
                    src={`/2560/${it.token_mint_addr}.jpg`}
                    alt={`Token ${it.token_num ?? it.token_mint_addr}`}
                    loading="lazy"
                    decoding="async"
                />
            </div>
        </div>
    {/each}
</div>
