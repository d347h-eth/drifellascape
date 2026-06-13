<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { DEFAULT_MARKET_EVENTS_LIMIT, fetchMarketEvents } from '../lib/search';
  import type { MarketEventRow, MarketEventType } from '../lib/types';

  export let visible = false;
  export let mode: MarketEventType = 'sale';
  export let isMobile = false;

  const dispatch = createEventDispatcher<{
    close: void;
    openGallery: string;
  }>();

  let items: MarketEventRow[] = [];
  let total = 0;
  let loading = false;
  let loaded = false;
  let error: string | null = null;
  let bodyEl: HTMLDivElement | null = null;
  let lastVisible = false;
  let lastMode: MarketEventType | null = null;
  let loadNonce = 0;
  let now = Date.now();

  $: if (visible && (!lastVisible || lastMode !== mode)) {
    lastVisible = true;
    lastMode = mode;
    void load(true);
  } else if (!visible && lastVisible) {
    lastVisible = false;
  }

  onMount(() => {
    const timer = window.setInterval(() => {
      now = Date.now();
    }, 30_000);
    return () => window.clearInterval(timer);
  });

  async function load(reset = false) {
    if (loading && !reset) return;
    const requestMode = mode;
    const requestOffset = reset ? 0 : items.length;
    const nonce = ++loadNonce;
    loading = true;
    error = null;
    try {
      const res = await fetchMarketEvents(
        requestMode,
        requestOffset,
        DEFAULT_MARKET_EVENTS_LIMIT,
      );
      if (nonce !== loadNonce || requestMode !== mode) return;
      total = res.total;
      items = reset ? res.items : items.concat(res.items);
      loaded = true;
    } catch (e: any) {
      if (nonce !== loadNonce) return;
      error = e?.message || String(e);
    } finally {
      if (nonce === loadNonce) loading = false;
    }
  }

  function handleScroll() {
    if (!bodyEl || loading || items.length >= total) return;
    const nearBottom =
      bodyEl.scrollTop + bodyEl.clientHeight >= bodyEl.scrollHeight - 600;
    if (nearBottom) void load(false);
  }

  function openGallery(event: MarketEventRow) {
    dispatch('openGallery', event.token_mint_addr);
  }

  function imageUrl(event: MarketEventRow): string {
    return `https://app.drifellascape.art/static/art/540h/${event.token_mint_addr}.jpg`;
  }

  function handleImageError(e: Event, row: MarketEventRow) {
    const img = e.currentTarget;
    if (!(img instanceof HTMLImageElement)) return;
    if (row.image_url && img.src !== row.image_url) {
      img.src = row.image_url;
    } else {
      img.style.visibility = 'hidden';
    }
  }

  function tokenLabel(event: MarketEventRow): string {
    return typeof event.token_num === 'number' ? `#${event.token_num}` : '#?';
  }

  function maskedAddress(value: string | null): string {
    if (!value) return '----';
    return value.slice(0, 4).toUpperCase();
  }

  function formatSol(raw: number): string {
    const sol = raw / 1_000_000_000;
    if (!Number.isFinite(sol)) return '0';
    if (Number.isInteger(sol)) return String(sol);
    return sol.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    });
  }

  function relativeTime(blockTime: number): string {
    const seconds = Math.max(1, Math.floor(now / 1000 - blockTime));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    return `${Math.floor(days / 7)}w`;
  }

  function utcTime(blockTime: number): string {
    const ms = blockTime * 1000;
    if (!Number.isFinite(ms)) return '';
    return new Date(ms).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
  }
</script>

{#if visible}
  <aside
    class="market-explorer"
    class:mobile={isMobile}
    role="dialog"
    aria-modal={isMobile ? 'true' : 'false'}
    aria-label={mode === 'sale' ? 'Sales feed' : 'Listings feed'}
  >
    <div class="panel-top">
      <div class="panel-title">{mode === 'sale' ? 'Sales' : 'Listings'}</div>
      <button
        type="button"
        class="close"
        aria-label="Close market feed"
        title="Close"
        on:click={() => dispatch('close')}
      >
        x
      </button>
    </div>

    <div bind:this={bodyEl} class="panel-body" on:scroll={handleScroll}>
      {#if error}
        <div class="state error" aria-label={error}>!</div>
      {:else if loading && items.length === 0}
        <div class="state" aria-label="Loading market events">...</div>
      {:else if loaded && items.length === 0}
        <div class="state" aria-label="No market events">-</div>
      {:else}
        {#each items as event (event.id)}
          <article class="event-row">
            <div class="event-time" title={utcTime(event.block_time)}>
              {relativeTime(event.block_time)}
            </div>

            <button
              type="button"
              class="preview-button"
              aria-label={`Open ${tokenLabel(event)} in gallery`}
              title={`Open ${tokenLabel(event)} in gallery`}
              on:click={() => openGallery(event)}
            >
              <img
                class="preview"
                src={imageUrl(event)}
                alt=""
                loading="lazy"
                on:error={(e) => handleImageError(e, event)}
              />
            </button>

            <div class="event-line">
              <span>{formatSol(event.price)} SOL</span>
              <span aria-hidden="true">•</span>
              <button
                type="button"
                class="token-link"
                title={`Open ${tokenLabel(event)} in gallery`}
                on:click={() => openGallery(event)}
              >
                {tokenLabel(event)}
              </button>
              <span aria-hidden="true">•</span>
              {#if event.event_type === 'sale'}
                <span>{maskedAddress(event.seller)} → {maskedAddress(event.buyer)}</span>
              {:else}
                <span>{maskedAddress(event.seller)}</span>
              {/if}
            </div>
          </article>
        {/each}
        {#if loading}
          <div class="state" aria-label="Loading more market events">...</div>
        {/if}
      {/if}
    </div>
  </aside>
{/if}

<style>
  .market-explorer {
    position: fixed;
    inset: 0 0 0 auto;
    width: var(--market-explorer-width, min(33vw, 480px));
    min-width: 320px;
    background: rgba(12, 12, 14, 0.98);
    border-left: 1px solid rgba(255, 255, 255, 0.12);
    color: #e6e6e6;
    z-index: 9800;
    display: flex;
    flex-direction: column;
    box-shadow: -10px 0 24px rgba(0, 0, 0, 0.35);
  }

  .market-explorer.mobile {
    width: 100vw;
    min-width: 0;
    border-left: 0;
  }

  .panel-top {
    min-height: 48px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 28px;
    align-items: center;
    gap: 8px;
    padding: 8px 10px 8px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    box-sizing: border-box;
  }

  .panel-title {
    min-width: 0;
    font-size: 13px;
    font-weight: 700;
    line-height: 1;
  }

  .close {
    width: 28px;
    height: 28px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(0, 0, 0, 0.35);
    color: inherit;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    padding: 0;
  }

  .close:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .close:focus,
  .preview-button:focus,
  .token-link:focus {
    outline: none;
    box-shadow: none;
  }

  .close:focus-visible,
  .preview-button:focus-visible,
  .token-link:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 1px rgba(0, 208, 255, 0.75);
  }

  .panel-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding-bottom: 28px;
  }

  .state {
    padding: 20px 16px;
    font-size: 13px;
    opacity: 0.72;
  }

  .state.error {
    color: #ff8a8a;
    opacity: 1;
  }

  .event-row {
    padding: 10px 0 14px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .event-time,
  .event-line {
    font-size: 11px;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
  }

  .event-time {
    opacity: 0.72;
    margin-bottom: 6px;
    padding: 0 12px;
  }

  .preview-button {
    display: block;
    width: 100%;
    height: 200px;
    padding: 0;
    margin: 0;
    border: 0;
    background: rgba(255, 255, 255, 0.04);
    cursor: pointer;
    overflow: hidden;
  }

  .preview {
    display: block;
    width: 100%;
    height: 200px;
    object-fit: cover;
    image-rendering: crisp-edges;
  }

  .event-line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    margin-top: 7px;
    padding: 0 12px;
    white-space: nowrap;
  }

  .token-link {
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-decoration: none;
  }

  .token-link:hover {
    color: #fff;
    text-decoration: underline;
  }
</style>
