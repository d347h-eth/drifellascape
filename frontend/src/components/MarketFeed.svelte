<script lang="ts">
    import { createEventDispatcher, tick } from "svelte";
    import {
        DEFAULT_MARKET_EVENTS_LIMIT,
        fetchMarketEvents,
    } from "../lib/search";
    import type {
        MarketEventFilter,
        MarketEventRow,
    } from "../lib/types";

    export let visible = false;

    const dispatch = createEventDispatcher();
    const filters: MarketEventFilter[] = ["all", "listing", "sale"];
    let selected: MarketEventFilter = "all";
    let items: MarketEventRow[] = [];
    let total = 0;
    let loading = false;
    let error: string | null = null;
    let loaded = false;
    let lastVisible = false;

    $: if (visible && !lastVisible) {
        void load(true);
    }
    $: lastVisible = visible;

    async function load(reset = false) {
        if (loading) return;
        loading = true;
        error = null;
        const nextOffset = reset ? 0 : items.length;
        try {
            const res = await fetchMarketEvents(
                selected,
                nextOffset,
                DEFAULT_MARKET_EVENTS_LIMIT,
            );
            total = res.total;
            items = reset ? res.items : items.concat(res.items);
            loaded = true;
            await tick();
        } catch (e: any) {
            error = e?.message || String(e);
        } finally {
            loading = false;
        }
    }

    function setFilter(type: MarketEventFilter) {
        if (selected === type) return;
        selected = type;
        items = [];
        total = 0;
        void load(true);
    }

    function typeLabel(type: MarketEventFilter): string {
        if (type === "listing") return "Listings";
        if (type === "sale") return "Sales";
        return "All";
    }

    function eventVerb(event: MarketEventRow): string {
        return event.event_type === "sale" ? "Sold" : "Listed";
    }

    function tokenLabel(event: MarketEventRow): string {
        if (typeof event.token_num === "number") return `#${event.token_num}`;
        return shortAddr(event.token_mint_addr);
    }

    function shortAddr(value: string | null | undefined): string {
        if (!value) return "";
        if (value.length <= 10) return value;
        return `${value.slice(0, 4)}…${value.slice(-4)}`;
    }

    function formatSol(raw: number): string {
        const sol = raw / 1_000_000_000;
        return sol.toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 3,
        });
    }

    function formatTime(blockTime: number): string {
        const ms = blockTime * 1000;
        if (!Number.isFinite(ms)) return "";
        return new Date(ms).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    function imageUrl(event: MarketEventRow): string {
        return `https://app.drifellascape.art/static/art/540h/${event.token_mint_addr}.jpg`;
    }

    function meUrl(event: MarketEventRow): string {
        return `https://magiceden.io/item-details/${event.token_mint_addr}`;
    }

    function handleImageError(e: Event, row: MarketEventRow) {
        const img = e.currentTarget;
        if (!(img instanceof HTMLImageElement)) return;
        if (row.image_url && img.src !== row.image_url) {
            img.src = row.image_url;
        } else {
            img.style.visibility = "hidden";
        }
    }
</script>

{#if visible}
    <section class="market-feed" aria-label="Market feed">
        <div class="market-head">
            <div class="title">Market</div>
            <div class="filters" role="tablist" aria-label="Market event type">
                {#each filters as filter}
                    <button
                        type="button"
                        class="tab"
                        class:active={selected === filter}
                        on:click={() => setFilter(filter)}
                    >
                        {typeLabel(filter)}
                    </button>
                {/each}
            </div>
            <button
                type="button"
                class="close"
                title="Close market feed"
                aria-label="Close market feed"
                on:click={() => dispatch("close")}
            >
                ×
            </button>
        </div>

        {#if error}
            <div class="state error">{error}</div>
        {:else if loading && items.length === 0}
            <div class="state">Loading</div>
        {:else if loaded && items.length === 0}
            <div class="state">No events</div>
        {:else}
            <div class="feed">
                {#each items as event (event.id)}
                    <a
                        class="event-row"
                        href={meUrl(event)}
                        target="_blank"
                        rel="noreferrer"
                        title={event.token_name ?? event.token_mint_addr}
                    >
                        <img
                            class="thumb"
                            src={imageUrl(event)}
                            alt=""
                            loading="lazy"
                            on:error={(e) => handleImageError(e, event)}
                        />
                        <div class="event-main">
                            <div class="event-top">
                                <span class="kind">{eventVerb(event)}</span>
                                <span class="token">{tokenLabel(event)}</span>
                                <span class="price">{formatSol(event.price)} SOL</span>
                            </div>
                            <div class="event-meta">
                                <span>{formatTime(event.block_time)}</span>
                                <span>{event.source}</span>
                            </div>
                            <div class="wallets">
                                {#if event.seller}
                                    <span>S {shortAddr(event.seller)}</span>
                                {/if}
                                {#if event.buyer}
                                    <span>B {shortAddr(event.buyer)}</span>
                                {/if}
                            </div>
                        </div>
                    </a>
                {/each}
            </div>
            {#if items.length < total}
                <button
                    type="button"
                    class="more"
                    disabled={loading}
                    on:click={() => load(false)}
                >
                    {loading ? "Loading" : "More"}
                </button>
            {/if}
        {/if}
    </section>
{/if}

<style>
    .market-feed {
        width: min(760px, calc(100vw - 24px));
        max-height: min(52vh, 540px);
        align-self: center;
        display: flex;
        flex-direction: column;
        background: rgba(6, 8, 10, 0.92);
        color: #e6e6e6;
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 10px 35px rgba(0, 0, 0, 0.4);
        overflow: hidden;
    }

    .market-head {
        display: flex;
        align-items: center;
        gap: 10px;
        height: 34px;
        padding: 0 8px 0 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        flex: 0 0 auto;
    }

    .title {
        font-size: 13px;
        letter-spacing: 0;
        font-weight: 600;
        min-width: 54px;
    }

    .filters {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 1;
    }

    .tab,
    .close,
    .more {
        color: #e6e6e6;
        background: rgba(20, 22, 26, 0.9);
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 4px;
        cursor: pointer;
    }

    .tab {
        height: 22px;
        padding: 0 8px;
        font-size: 12px;
    }

    .tab.active {
        background: rgba(0, 208, 255, 0.16);
        border-color: rgba(0, 208, 255, 0.45);
    }

    .close {
        width: 24px;
        height: 24px;
        padding: 0;
        font-size: 18px;
        line-height: 18px;
    }

    .feed {
        overflow: auto;
        min-height: 0;
    }

    .event-row {
        display: grid;
        grid-template-columns: 54px minmax(0, 1fr);
        gap: 10px;
        padding: 8px 12px;
        color: inherit;
        text-decoration: none;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    .event-row:hover {
        background: rgba(255, 255, 255, 0.05);
    }

    .thumb {
        width: 54px;
        height: 38px;
        object-fit: cover;
        image-rendering: crisp-edges;
        background: rgba(255, 255, 255, 0.05);
    }

    .event-main {
        min-width: 0;
        display: grid;
        gap: 4px;
    }

    .event-top,
    .event-meta,
    .wallets {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        white-space: nowrap;
    }

    .kind {
        width: 42px;
        color: #9fe7ff;
        font-size: 12px;
    }

    .token,
    .price {
        font-variant-numeric: tabular-nums;
    }

    .token {
        min-width: 52px;
    }

    .price {
        color: #fff;
    }

    .event-meta,
    .wallets,
    .state {
        color: rgba(230, 230, 230, 0.72);
        font-size: 12px;
    }

    .wallets span,
    .event-meta span {
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .state {
        padding: 14px 12px;
    }

    .state.error {
        color: #ff8585;
    }

    .more {
        height: 30px;
        margin: 8px 12px 10px;
        flex: 0 0 auto;
    }

    .more:disabled {
        opacity: 0.55;
        cursor: default;
    }

    @media (max-width: 900px), (hover: none) and (pointer: coarse) {
        .market-feed {
            width: 100vw;
            max-height: 58svh;
            border-left: 0;
            border-right: 0;
        }

        .event-row {
            grid-template-columns: 48px minmax(0, 1fr);
            padding: 8px 10px;
        }

        .thumb {
            width: 48px;
            height: 34px;
        }

        .event-top,
        .event-meta,
        .wallets {
            gap: 6px;
        }
    }
</style>
