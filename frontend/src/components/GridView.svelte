<script lang="ts">
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import type { Row } from '../lib/types';
  import PriceTag from './PriceTag.svelte';

  export let items: Row[] = [];
  export let targetMint: string | null = null;
  // Beat 3 times; 1.25s → 1.875s per beat → total ≈ 5625ms
  export let flashDurationMs: number = 5625;
  export let enablePaging: boolean = false;
  export let loadingMore: boolean = false;

  const dispatch = createEventDispatcher();

  let flashMint: string | null = null;

  async function scrollToTarget(mint: string) {
    await tick();
    const el = document.getElementById(`cell-${mint}`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'auto' });
      flashMint = mint;
      const t = setTimeout(() => { if (flashMint === mint) flashMint = null; }, Math.max(300, flashDurationMs));
      // best-effort cleanup on rerender
      return () => clearTimeout(t);
    }
    return () => {};
  }

  onMount(() => {
    if (targetMint) scrollToTarget(targetMint);
  });

  $: if (targetMint) { scrollToTarget(targetMint); }

  function handleClick(mint: string) {
    dispatch('openGallery', mint);
  }

  // Helpers for union Row type
  function getPrice(r: Row): number | undefined { return (r as any)?.price; }
  function getSource(r: Row): string | undefined { return (r as any)?.listing_source; }
  function hasPrice(r: Row): boolean { const p = (r as any)?.price; return typeof p === 'number' && Number.isFinite(p); }
  // Paging sentinel
  let bottomSentinelEl: HTMLDivElement | null = null;
  let topSentinelEl: HTMLDivElement | null = null;
  let io: IntersectionObserver | null = null;
  function setupObserver() {
    if (io || !enablePaging) return;
    io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        if (bottomSentinelEl && e.target === bottomSentinelEl) {
          dispatch('loadMore');
        } else if (topSentinelEl && e.target === topSentinelEl) {
          dispatch('loadPrev');
        }
      }
    }, { root: null, rootMargin: '0px', threshold: 0.0 });
    try { if (bottomSentinelEl) io.observe(bottomSentinelEl); } catch {}
    try { if (topSentinelEl) io.observe(topSentinelEl); } catch {}
  }
  function teardownObserver() {
    if (io) { try { io.disconnect(); } catch {} io = null; }
  }
  onMount(() => { return () => teardownObserver(); });
  $: if (enablePaging && !io) { setupObserver(); }
  $: if (!enablePaging && io) { teardownObserver(); }
</script>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    padding: 12px;
    box-sizing: border-box;
  }
  .sentinel {
    grid-column: 1 / -1;
    height: 24px;
  }
  .sentinel-top { grid-column: 1 / -1; height: 1px; }
  .more-spinner { grid-column: 1 / -1; display: flex; align-items: center; justify-content: center; padding: 8px 0; opacity: 0.75; font-size: 12px; }
  .dot { width: 6px; height: 6px; margin: 0 3px; background: rgba(255,255,255,0.6); border-radius: 50%; animation: pulse 0.9s ease-in-out infinite; }
  .dot:nth-child(2) { animation-delay: 0.15s; }
  .dot:nth-child(3) { animation-delay: 0.3s; }
  @keyframes pulse { 0%, 100% { transform: scale(0.85); opacity: 0.6; } 50% { transform: scale(1); opacity: 1; } }
  .cell {
    position: relative;
    background: #0c0c0e;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 6px;
    overflow: hidden;
  }
  .cell button {
    display: block;
    width: 100%;
    height: 100%;
    padding: 0;
    margin: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
  }
  .img {
    display: block;
    width: 100%;
    height: auto;
    object-fit: contain;
  }
  .price-tab {
    position: absolute;
    left: 50%;
    bottom: 0;
    transform: translateX(-50%);
    background: rgba(0,0,0,0.55);
    border: 1px solid rgba(255,255,255,0.2);
    border-bottom: 0;
    border-radius: 6px 6px 0 0;
    padding: 4px 8px;
    font-size: 12px;
    line-height: 1;
    color: #fff;
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease-in-out, transform 120ms ease-in-out, background-color 120ms ease-in-out;
  }
  .cell:hover .price-tab { opacity: 1; pointer-events: auto; }
  .price-tab :global(.price-link) { color: #fff; }
  .price-tab :global(.price) { color: #fff; }
  /* Brief cyan outline pulse to anchor the eye */
  .flash {
    animation: grid-flash 1.875s ease-in-out 3;
  }
  @keyframes grid-flash {
    0% { box-shadow: 0 0 0 0 rgba(0,255,255,0.0); outline: 0 solid rgba(0,255,255,0.0); }
    10% { box-shadow: 0 0 0 2px rgba(0,255,255,0.75); outline: 2px solid rgba(0,255,255,0.85); }
    60% { box-shadow: 0 0 0 2px rgba(0,255,255,0.45); outline: 2px solid rgba(0,255,255,0.6); }
    100% { box-shadow: 0 0 0 0 rgba(0,255,255,0.0); outline: 0 solid rgba(0,255,255,0.0); }
  }
</style>

<div class="grid" role="list">
  <div class="sentinel-top" bind:this={topSentinelEl} />
  {#each items as it (it.token_mint_addr)}
    <div id={`cell-${it.token_mint_addr}`} class="cell" role="listitem" class:flash={flashMint === it.token_mint_addr}>
      <button type="button" aria-label={`Open ${it.token_num ?? it.token_mint_addr} in gallery`} on:click={() => handleClick(it.token_mint_addr)}>
        <img class="img" src={`/2560/${it.token_mint_addr}.jpg`} alt={`Token ${it.token_num ?? it.token_mint_addr}`} loading="lazy" decoding="async" />
      </button>
      {#if hasPrice(it)}
        <div class="price-tab">
          <PriceTag price={getPrice(it)} listingSource={getSource(it)} mint={it.token_mint_addr} />
        </div>
      {/if}
    </div>
  {/each}
  {#if items.length === 0}
    <div style="grid-column: 1 / -1; opacity: 0.7; padding: 24px;">No items to display.</div>
  {/if}
  <!-- Spacer to ease centering with scrollIntoView -->
  <div class="sentinel" bind:this={bottomSentinelEl} />
  {#if loadingMore}
    <div class="more-spinner" aria-live="polite" title="Loading more">
      <div class="dot" /><div class="dot" /><div class="dot" />
    </div>
  {/if}
</div>
