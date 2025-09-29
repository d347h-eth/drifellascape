<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { ListingTrait } from '../../lib/types';

  import { PURPOSES, type Purpose, normalizedPurpose } from '../../lib/purposes';
  export let traits: ListingTrait[] = [];
  export let selectedPurpose: Purpose = 'middle';
  export let selectedValueIds: Set<number> = new Set();
  // Best-effort map of value_id -> label (from current items' traits)
  export let selectedValueMeta: Record<number, string> = {};
  // When true (Gallery), leave a bottom offset so the native scrollbar is visible.
  // When false (Exploration/Grid), the bar is flush with the bottom.
  export let galleryMode: boolean = true;

  // PURPOSES and normalizedPurpose imported from lib/purposes

  // Counts for current token
  let purposeCounts: Record<string, number> = {};
  $: {
    const m: Record<string, number> = {};
    for (const t of traits) {
      const k = normalizedPurpose(t.purpose_class);
      m[k] = (m[k] || 0) + 1;
    }
    purposeCounts = m;
  }

  // Paging state (fixed page size)
  let visibleTraitSlots = 0;
  let traitBarOffset = 0;
  import { TRAIT_BOX_WIDTH as BOX_W, TRAIT_ARROW_PAD_TOTAL as ARROWS_W } from '../../lib/ui-constants';

  function recomputeVisibleTraitSlots() {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const slots = Math.floor(Math.max(0, w - ARROWS_W) / BOX_W);
    visibleTraitSlots = Math.max(1, slots);
    // Clamp
    traitBarOffset = Math.min(traitBarOffset, Math.max(0, totalTraits - visibleTraitSlots));
  }
  if (typeof window !== 'undefined') {
    addEventListener('resize', () => recomputeVisibleTraitSlots());
  }
  onMount(() => setTimeout(recomputeVisibleTraitSlots, 0));

  // Derived slice
  $: filtered = traits.filter(t => normalizedPurpose(t.purpose_class) === normalizedPurpose(selectedPurpose));
  $: totalTraits = filtered.length;
  $: startIdx = traitBarOffset;
  $: endIdx = Math.min(totalTraits, startIdx + Math.max(1, visibleTraitSlots || 1));
  $: hasPagination = totalTraits > Math.max(1, visibleTraitSlots || 1);

  // Reset paging whenever the selected purpose changes (including when parent updates it)
  let lastPurpose: Purpose | null = null;
  $: {
    const sp = normalizedPurpose(selectedPurpose);
    if (sp !== lastPurpose) {
      lastPurpose = sp;
      traitBarOffset = 0;
    }
  }

  // Paging (wrap-around on next; fixed step size)
  function nextTraitPageWrapped() {
    const step = Math.max(1, visibleTraitSlots || 1);
    if (totalTraits <= 0) return;
    const next = traitBarOffset + step;
    traitBarOffset = next >= totalTraits ? 0 : next;
  }

  // Keyboard hotkeys (Z/C, X) are handled at App level globally.

  // Listen for global pageNext notification from App for X key
  function onGlobalPageNext() { nextTraitPageWrapped(); }
  if (typeof window !== 'undefined') {
    window.addEventListener('traitbar:pageNext', onGlobalPageNext);
  }
  onDestroy(() => {
    if (typeof window !== 'undefined') window.removeEventListener('traitbar:pageNext', onGlobalPageNext);
  });

  // Events
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();
  function emitToggleValue(id: number) { dispatch('toggleValue', id); }
  function clickPurpose(pc: Purpose, cnt: number) {
    if (cnt === 0) return;
    selectedPurpose = pc; traitBarOffset = 0; dispatch('purposeChange', pc);
  }
  function handleNextArrowClick(e: MouseEvent) {
    nextTraitPageWrapped();
    const target = e.currentTarget as HTMLButtonElement | null;
    target?.blur?.();
  }

  // Directly reference selectedValueIds in markup so Svelte tracks dependency
</script>

<!-- Selected filters (pills above purpose pills) -->
  <div class="selected-filters" on:wheel|stopPropagation on:click|stopPropagation tabindex="-1" style={`--filters-bottom:${(galleryMode ? 82 : 60) + 26}px`}>
    {#each Array.from(selectedValueIds) as vid}
      <button type="button" class="filter-pill" title={`Remove filter: ${selectedValueMeta[vid] ?? ('#' + vid)}`} on:click={() => emitToggleValue(vid)}>
        <span aria-hidden="true">×</span>&nbsp;{selectedValueMeta[vid] ?? ('#' + vid)}
      </button>
    {/each}
  </div>

<!-- Purpose pills -->
  <div class="purpose-dots" on:wheel|stopPropagation on:click|stopPropagation tabindex="-1" style={`--dots-bottom:${galleryMode ? 82 : 60}px`}>
  {#each PURPOSES as pc}
    {@const cnt = purposeCounts[pc] ?? 0}
    <button type="button" class="purpose-dot {pc === normalizedPurpose(selectedPurpose) ? 'active' : ''} {cnt === 0 ? 'disabled' : ''}"
      disabled={cnt === 0}
      on:click={() => clickPurpose(pc, cnt)}>
      {pc}{#if cnt > 0}&nbsp;({cnt}){/if}
    </button>
  {/each}
  <div style="height:10px;"></div>
</div>

<!-- Trait bar at bottom -->
<div class="trait-bar" on:wheel|stopPropagation on:click|stopPropagation style={`--bar-bottom:${galleryMode ? 22 : 0}px`}>
  <button type="button" class="trait-toggle" title="Toggle traits bar" on:mousedown|preventDefault on:click={() => dispatch('toggleBar')}>
    <span class="glyph">✕</span>
  </button>
  <div class="trait-strip">
    {#each filtered.slice(startIdx, endIdx) as tr, i (`${tr.type_id}-${tr.value_id}-${i}`)}
      <div class="trait-box {selectedValueIds?.has(tr.value_id) ? 'selected' : ''}" title={`${tr.type_name}: ${tr.value}`} on:click={() => emitToggleValue(tr.value_id)}>
        <div class="trait-head">{(tr.spatial_group ?? 'UNDF').toUpperCase()}. {tr.type_name}</div>
        <div class="trait-val">{tr.value}</div>
      </div>
    {/each}
  </div>
  {#if hasPagination}
    <button type="button" class="trait-arrow" title="Next traits page (wrap)" on:mousedown|preventDefault on:click={handleNextArrowClick}>&rarr;</button>
  {/if}
  <!-- keys handled globally in App; no hidden focus catcher needed -->
</div>

<style>
  .purpose-dots {
    position: fixed;
    left: 0; right: 0; bottom: var(--dots-bottom, 82px); /* gap above bar */
    height: 22px;
    display: flex; align-items: center; justify-content: center;
    pointer-events: auto;
    z-index: 9001;
  }
  .selected-filters {
    position: fixed;
    left: 0; right: 0; bottom: var(--filters-bottom, 108px);
    min-height: 24px;
    display: flex; align-items: center; justify-content: center;
    flex-wrap: wrap; gap: 6px;
    pointer-events: auto;
    z-index: 9001;
  }
  .filter-pill { cursor: pointer; margin: 0 4px; padding: 3px 8px; font-size: 12px; color: #e6e6e6; background: rgba(12,12,14,0.85); border: 1px solid rgba(255,255,255,0.12); border-radius: 999px; }
  .filter-pill:hover { background: rgba(255,255,255,0.10); }
  .filter-pill:focus, .filter-pill:focus-visible { outline: none; box-shadow: none; }
  .purpose-dot { cursor: pointer; margin: 0 6px; padding: 3px 8px; font-size: 12px; color: #cfcfd2; background: rgba(12,12,14,0.85); border: 1px solid rgba(255,255,255,0.12); border-radius: 999px; }
  .purpose-dot.active { color: #111; background: #e6e6e6; border-color: #e6e6e6; }
  .purpose-dot.disabled { opacity: 0.35; cursor: default; }
  .purpose-dot:focus, .purpose-dot:focus-visible { outline: none; box-shadow: none; }

  .trait-bar {
    position: fixed; left: 0; right: 0; bottom: var(--bar-bottom, 22px); height: 50px;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: stretch; justify-content: space-between;
    padding-left: 12px; /* align with grid left padding */
    z-index: 9000;
    pointer-events: auto;
  }
  .trait-arrow { width: 50px; height: 50px; border: 0; background: rgba(255,255,255,0.08); color: #e6e6e6; cursor: pointer; align-self: center; }
  .trait-arrow:hover { background: rgba(255,255,255,0.12); }
  .trait-arrow:disabled { opacity: 0.25; cursor: default; }
  .trait-arrow:focus, .trait-arrow:focus-visible { outline: none; box-shadow: none; }
  .trait-strip { flex: 1; display: flex; overflow: hidden; justify-content: center; }
  .trait-box { width: 150px; height: 50px; padding: 6px 8px; box-sizing: border-box; border-left: 1px solid rgba(255,255,255,0.06); cursor: pointer; align-self: center; }
  .trait-box:hover { background: rgba(255,255,255,0.06); }
  .trait-box.selected { background: rgba(255,255,255,0.12); }
  .trait-head { font-size: 11px; opacity: 0.8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .trait-val { font-size: 13px; font-weight: 600; white-space: normal; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; line-height: 1.1; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word; }
  .trait-toggle { width: 50px; height: 50px; border: 0; background: rgba(0,0,0,0.6); color: #e6e6e6; cursor: pointer; align-self: center; border-radius: 0; }
  .trait-toggle:hover { background: rgba(0,0,0,0.75); }
  .trait-toggle:focus, .trait-toggle:focus-visible { outline: none; box-shadow: none; }
  .glyph { display: inline-block; color: rgba(230,230,230,0.9); font-size: 12px; pointer-events: none; }
</style>
