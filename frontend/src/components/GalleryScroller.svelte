<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import type { Row } from '../lib/types';
  import { dbg } from '../debug';
  import PriceTag from './PriceTag.svelte';

  export let items: Row[] = [];
  export let showMeta: boolean = true;
  export let motionEnabled: boolean = true;
  export let autoSnapEnabled: boolean = true;
  export let leaveThresholdFrac: number = 0.5;
  export let wheelMultiplier: number = 1.6;
  export let activeIndex: number = 0; // bindable
  // Gallery infinite scroll (near-edge prefetch)
  export let galleryPagingEnabled: boolean = false;
  export let edgePrefetchThreshold: number = 3;
  const PREFETCH_COOLDOWN_MS = 600;
  let lastPrefetchAt = 0;

  const dispatch = createEventDispatcher();

  let scrollerEl: HTMLDivElement | null = null;
  let lastSnapIndex = 0;
  let suppressFinalizeUntilTs = 0;
  let draggingScrollbar = false;
  let blockUntilTs = 0;
  let lastProgrammaticTs = 0;
  const SCROLLBAR_HIT_PX = 24;
  // Post-snap wheel input block to avoid immediate re-scroll after landing
  const POST_SNAP_WHEEL_BLOCK_MS = 200;

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
    lastProgrammaticTs = Date.now();
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
      else {
        isAnimating = false;
        lastSnapIndex = idxToSet;
        activeIndex = idxToSet;
        // Briefly block wheel input after landing to avoid immediate re-scroll
        blockUntilTs = Date.now() + POST_SNAP_WHEEL_BLOCK_MS;
        // Trigger prefetch immediately while wheel is blocked to avoid user scrolling mid-fetch
        maybeEdgePrefetch();
      }
    };
    animReq = requestAnimationFrame(step);
  }
  let isAnimating = false; let animReq = 0; let animToken = 0;
  function cancelAnimation() { if (animReq) cancelAnimationFrame(animReq); animReq = 0; isAnimating = false; animToken++; }
  // Allow parent to cancel any in-flight animation when toggling motion
  export function cancel() { cancelAnimation(); }

  export function prev() { scrollToIndex(activeIndex - 1); }
  export function next() { scrollToIndex(activeIndex + 1); }
  export function focusCurrent() { scrollToIndex(nearestIndex()); }
  export function scrollToIndexInstant(i: number) { scrollToIndex(i, false, true); }
  // Programmatic snap that behaves like finalize (triggers post-snap block and edge prefetch)
  export function snapToIndex(i: number) { scrollToIndex(i, true, false); }

  function scrollToIndex(i: number, autoSnap = false, forceInstant = false) {
    if (!scrollerEl) return;
    const cw = scrollerEl.clientWidth;
    const idx = clamp(i, 0, Math.max(0, items.length - 1));
    const target = idx * cw;
    if (motionEnabled && !forceInstant) { animateScrollTo(target, idx); }
    else {
      scrollerEl.scrollLeft = target; lastSnapIndex = idx; activeIndex = idx;
      // Apply post-snap block even when motion is disabled to avoid immediate re-scroll
      if (autoSnap) blockUntilTs = Date.now() + POST_SNAP_WHEEL_BLOCK_MS;
      if (forceInstant) suppressFinalizeUntilTs = Date.now() + 200;
      lastProgrammaticTs = Date.now();
      // If this was an auto snap without animation, trigger prefetch immediately while wheel is blocked
      if (autoSnap) { maybeEdgePrefetch(); }
    }
  }

  function handleWheel(e: WheelEvent) {
    if (!scrollerEl) return;
    if (isAnimating) { e.preventDefault(); return; }
    const ax = Math.abs(e.deltaX); const ay = Math.abs(e.deltaY);
    if (Date.now() < blockUntilTs) { e.preventDefault(); return; }
    if (ay > ax) { e.preventDefault(); scrollerEl.scrollLeft += e.deltaY * wheelMultiplier; }
  }
  function finalizeDirectionalSnapIdle() {
    if (!scrollerEl) return;
    if (isAnimating) return;
    if (!autoSnapEnabled) return;
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
  // Match ADR-008: finalize immediately on idle
  const FINALIZE_DELAY_MS = 0;
  let scrollEndTimer: any = null;
  function handleScroll() {
    dispatch('indexChange', activeIndex = nearestIndex());
    if (isAnimating) return; // avoid fighting the tween
    if (Date.now() < suppressFinalizeUntilTs) return;
    if (draggingScrollbar) return;
    // Signal manual scrolling (not recently programmatic)
    if (Date.now() - lastProgrammaticTs > 100) {
      dispatch('manualScroll');
    }
    if (scrollEndTimer) clearTimeout(scrollEndTimer);
    scrollEndTimer = setTimeout(() => finalizeDirectionalSnapIdle(), FINALIZE_DELAY_MS);
  }
  function onPointerDown(e: PointerEvent) {
    if (!scrollerEl) return;
    const r = scrollerEl.getBoundingClientRect();
    if (e.clientY >= r.bottom - SCROLLBAR_HIT_PX) draggingScrollbar = true;
  }
  function onPointerUp() { if (draggingScrollbar) { draggingScrollbar = false; if (autoSnapEnabled) finalizeSnapOnRelease(); } }

  // Expose helpers to parent
  export function getCurrentImageClientRect(): DOMRect | null {
    if (!scrollerEl) return null;
    const idx = nearestIndex();
    const slides = scrollerEl.querySelectorAll<HTMLElement>('section.slide');
    const slide = slides[idx];
    if (!slide) return null;
    const img = slide.querySelector<HTMLImageElement>('img.token');
    if (!img) return null;
    return img.getBoundingClientRect();
  }
  export function wheelY(deltaY: number) {
    if (!scrollerEl) return;
    if (isAnimating) return;
    if (Date.now() < blockUntilTs) return;
    scrollerEl.scrollLeft += deltaY * wheelMultiplier;
  }

  // pricing/link logic moved into PriceTag component
  // Helper accessors for union Row type
  function getPrice(r: Row): number | undefined { return (r as any)?.price; }
  function getSource(r: Row): string | undefined { return (r as any)?.listing_source; }
  function getName(r: Row): string | undefined {
    const anyr: any = r as any;
    if (anyr?.token_name) return anyr.token_name as string;
    if (typeof anyr?.token_num === 'number' && anyr.token_num != null) return `#${anyr.token_num}`;
    return anyr?.token_mint_addr as string;
  }

  onMount(() => {
    scrollerEl?.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  });

  function maybeEdgePrefetch() {
    if (!galleryPagingEnabled) return;
    if (!items || items.length === 0) return;
    const now = Date.now();
    if (now - lastPrefetchAt < PREFETCH_COOLDOWN_MS) return;
    if (isAnimating || draggingScrollbar) return;
    const leftRem = activeIndex;
    const rightRem = Math.max(0, items.length - 1 - activeIndex);
    if (leftRem <= edgePrefetchThreshold) { lastPrefetchAt = now; dispatch('loadPrev'); return; }
    if (rightRem <= edgePrefetchThreshold) { lastPrefetchAt = now; dispatch('loadMore'); return; }
  }
</script>

<div bind:this={scrollerEl} class="scroller" on:scroll={handleScroll} on:wheel={handleWheel}>
  {#each items as it (it.token_mint_addr)}
    <section class="slide" id={`slide-${it.token_mint_addr}`} aria-label={`Token ${it.token_num ?? it.token_mint_addr}`}>
      <div class="img-wrap">
        <button type="button" class="img-button" aria-label={`Explore token ${it.token_num ?? it.token_mint_addr}`} on:click={() => dispatch('enterExplore', it.token_mint_addr)}>
          <img class="token" src={`/2560/${it.token_mint_addr}.jpg`} alt={`Token ${it.token_num ?? it.token_mint_addr}`} loading="lazy" decoding="async" on:load={() => dispatch('imageLoad')} />
        </button>
      </div>
      {#if showMeta}
        <div class="meta">
          <PriceTag price={getPrice(it)} listingSource={getSource(it)} mint={it.token_mint_addr} />
        </div>
      {:else}
        <div class="meta">
          <a class="token-link" href={`https://magiceden.io/item-details/${it.token_mint_addr}`} target="_blank" rel="noopener noreferrer">{getName(it)}</a>
        </div>
      {/if}
    </section>
  {/each}
</div>

<style>
  .scroller {
    display: flex;
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
    scroll-behavior: auto;
    height: 100vh;
    box-sizing: border-box;
  }
  /* Mobile: allow vertical scroll to bubble to the page so the address bar can hide */
  @media (hover: none) and (pointer: coarse) {
    .scroller {
      height: 100svh; /* dynamic visual viewport height to avoid partial view */
      overscroll-behavior-x: contain; /* keep horizontal chain inside */
      overscroll-behavior-y: auto;    /* allow vertical scroll to bubble */
      touch-action: pan-x pan-y;      /* do not block vertical panning */
    }
  }
  .slide {
    flex: 0 0 100vw;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start;
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
  .price, .price-link { font-variant-numeric: tabular-nums; }
  .price-link { text-decoration: none; color: inherit; }
  .price-link:visited { color: inherit; }
  .token-link { text-decoration: none; color: inherit; }
  .token-link:hover { text-decoration: underline; }
</style>
