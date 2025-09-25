<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import type { ListingRow } from '../lib/types';
  import { dbg } from '../debug';

  export let items: ListingRow[] = [];
  export let motionEnabled: boolean = true;
  export let leaveThresholdFrac: number = 0.5;
  export let activeIndex: number = 0; // bindable

  const dispatch = createEventDispatcher();

  let scrollerEl: HTMLDivElement | null = null;
  let lastSnapIndex = 0;
  let suppressFinalizeUntilTs = 0;
  let draggingScrollbar = false;
  let blockUntilTs = 0;
  const SCROLLBAR_HIT_PX = 24;

  // Internal helpers (ported from App)
  function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }
  function nearestIndex(): number {
    if (!scrollerEl) return 0;
    const cw = scrollerEl.clientWidth || 1;
    return clamp(Math.round(scrollerEl.scrollLeft / cw), 0, Math.max(0, items.length - 1));
  }
  function animateScrollTo(left: number, idxToSet: number) {
    if (!scrollerEl) return;
    const start = scrollerEl.scrollLeft;
    const distance = Math.abs(left - start);
    // duration ~ 0.233 ms/px clamped 80..160
    const perPx = 0.233; const minMs = 80; const maxMs = 160;
    const duration = Math.round(Math.min(maxMs, Math.max(minMs, distance * perPx)));
    let startTs = 0; const token = ++animToken; isAnimating = true;
    const step = (ts: number) => {
      if (token !== animToken || !scrollerEl) return;
      if (!startTs) startTs = ts;
      const t = Math.min(1, (ts - startTs) / duration);
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      scrollerEl.scrollLeft = start + (left - start) * eased;
      if (t < 1) animReq = requestAnimationFrame(step);
      else { isAnimating = false; lastSnapIndex = idxToSet; activeIndex = idxToSet; }
    };
    animReq = requestAnimationFrame(step);
  }
  let isAnimating = false; let animReq = 0; let animToken = 0;
  function cancelAnimation() { if (animReq) cancelAnimationFrame(animReq); animReq = 0; isAnimating = false; animToken++; }

  export function prev() { scrollToIndex(activeIndex - 1); }
  export function next() { scrollToIndex(activeIndex + 1); }
  export function focusCurrent() { scrollToIndex(nearestIndex()); }
  export function scrollToIndexInstant(i: number) { scrollToIndex(i, false, true); }

  function scrollToIndex(i: number, autoSnap = false, forceInstant = false) {
    if (!scrollerEl) return;
    const cw = scrollerEl.clientWidth;
    const idx = clamp(i, 0, Math.max(0, items.length - 1));
    const target = idx * cw;
    if (motionEnabled && !forceInstant) { animateScrollTo(target, idx); }
    else {
      scrollerEl.scrollLeft = target; lastSnapIndex = idx; activeIndex = idx;
      if (autoSnap && motionEnabled) blockUntilTs = Date.now() + 100;
      if (forceInstant) suppressFinalizeUntilTs = Date.now() + 200;
    }
  }

  function handleWheel(e: WheelEvent) {
    if (!scrollerEl) return;
    if (isAnimating) { e.preventDefault(); return; }
    const ax = Math.abs(e.deltaX); const ay = Math.abs(e.deltaY);
    if (motionEnabled && Date.now() < blockUntilTs) { e.preventDefault(); return; }
    if (ay > ax) { e.preventDefault(); scrollerEl.scrollLeft += e.deltaY * 1.5; }
  }
  function finalizeDirectionalSnapIdle() {
    if (!scrollerEl) return;
    const cw = scrollerEl.clientWidth || 1;
    const lastCenter = lastSnapIndex * cw;
    const dx = scrollerEl.scrollLeft - lastCenter;
    const dist = Math.abs(dx);
    const thresholdPx = cw * leaveThresholdFrac;
    if (dist >= thresholdPx) {
      const dir = dx > 0 ? 1 : -1;
      const idx = clamp(lastSnapIndex + dir, 0, Math.max(0, items.length - 1));
      scrollToIndex(idx, true);
    }
  }
  function finalizeSnapOnRelease() {
    if (!scrollerEl) return;
    const cw = scrollerEl.clientWidth || 1;
    const idxNear = clamp(Math.round(scrollerEl.scrollLeft / cw), 0, Math.max(0, items.length - 1));
    const lastCenter = lastSnapIndex * cw;
    const dist = Math.abs(scrollerEl.scrollLeft - lastCenter);
    const thresholdPx = cw * leaveThresholdFrac;
    dbg('[scrollbar] release start (scroller)', { idxNear, lastSnapIndex, dist, thresholdPx });
    if (dist >= thresholdPx) {
      scrollToIndex(idxNear, true);
      suppressFinalizeUntilTs = Date.now() + 300;
      dbg('[scrollbar] release snapped (scroller)', { targetIndex: idxNear });
    } else dbg('[scrollbar] release no-snap (scroller)');
  }
  let scrollEndTimer: any = null;
  function handleScroll() {
    dispatch('indexChange', activeIndex = nearestIndex());
    if (Date.now() < suppressFinalizeUntilTs) return;
    if (draggingScrollbar) return;
    if (scrollEndTimer) clearTimeout(scrollEndTimer);
    scrollEndTimer = setTimeout(() => finalizeDirectionalSnapIdle(), 0);
  }
  function onPointerDown(e: PointerEvent) {
    if (!scrollerEl) return;
    const r = scrollerEl.getBoundingClientRect();
    if (e.clientY >= r.bottom - SCROLLBAR_HIT_PX) draggingScrollbar = true;
  }
  function onPointerUp() { if (draggingScrollbar) { draggingScrollbar = false; finalizeSnapOnRelease(); } }

  function marketplaceFor(src: string | undefined, mint: string): { href: string; title: string } | null {
    if (!src) return null;
    if (src === 'M2' || src === 'MMM' || src === 'M3' || src === 'HADESWAP_AMM') return { href: `https://magiceden.io/item-details/${mint}`, title: 'View on Magic Eden' };
    if (src === 'TENSOR_LISTING' || src === 'TENSOR_CNFT_LISTING' || src === 'TENSOR_MARKETPLACE_LISTING' || src === 'TENSOR_AMM' || src === 'TENSOR_AMM_V2') return { href: `https://tensor.trade/item/${mint}`, title: 'View on Tensor' };
    return null;
  }
  function ceilDiv(n: number, d: number) { return Math.floor((n + d - 1) / d); }
  function priceWithFees(nominalLamports: number): number { const maker = ceilDiv(nominalLamports * 2, 100); const royalty = ceilDiv(nominalLamports * 5, 100); return nominalLamports + maker + royalty; }
  function formatSol(raw: number): string { const sol = raw / 1_000_000_000; const up = Math.ceil(sol * 100) / 100; return up.toFixed(2); }

  onMount(() => {
    scrollerEl?.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  });
</script>

<div bind:this={scrollerEl} class="scroller" on:scroll={handleScroll} on:wheel={handleWheel}>
  {#each items as it (it.token_mint_addr)}
    {@const m = marketplaceFor(it.listing_source, it.token_mint_addr)}
    <section class="slide" aria-label={`Token ${it.token_num ?? it.token_mint_addr}`}>
      <div class="img-wrap">
        <button type="button" class="img-button" aria-label={`Explore token ${it.token_num ?? it.token_mint_addr}`} on:click={() => dispatch('enterExplore', it.token_mint_addr)}>
          <img class="token" src={`/2560/${it.token_mint_addr}.jpg`} alt={`Token ${it.token_num ?? it.token_mint_addr}`} loading="lazy" decoding="async" />
        </button>
      </div>
      <div class="meta">
        {#if m}
          <a class="price-link" href={m.href} target="_blank" rel="noopener noreferrer" title={m.title}>{formatSol(priceWithFees(it.price))} SOL</a>
        {:else}
          <span class="price">{formatSol(priceWithFees(it.price))} SOL</span>
        {/if}
      </div>
    </section>
  {/each}
</div>

<style>
  /* Uses existing App styles for scroller/slide/img/meta classes */
</style>

