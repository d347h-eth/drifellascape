<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { ListingTrait } from '../../lib/types';

  export let traits: ListingTrait[] = [];
  export let selectedPurpose: string = 'middle';
  export let selectedValueIds: Set<number> = new Set();

  const PURPOSES = ["left","middle","right","decor","items","special","undefined"] as const;
  type Purpose = typeof PURPOSES[number];
  function normalizedPurpose(p: string | null | undefined): Purpose {
    const v = (p || '').toLowerCase();
    return (PURPOSES.find(x => x === v) ?? 'undefined') as Purpose;
  }

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

  // Paging
  function hasPrevTraitPage() { return traitBarOffset > 0; }
  function hasNextTraitPage() { return traitBarOffset + visibleTraitSlots < totalTraits; }
  function prevTraitPage() { const step = Math.max(1, visibleTraitSlots || 1); traitBarOffset = Math.max(0, traitBarOffset - step); }
  function nextTraitPage() { const step = Math.max(1, visibleTraitSlots || 1); traitBarOffset = Math.min(Math.max(0, totalTraits - step), traitBarOffset + step); }
  function nextTraitPageWrapped() { const step = Math.max(1, visibleTraitSlots || 1); const next = traitBarOffset + step; traitBarOffset = next >= totalTraits ? 0 : next; }

  // Hotkeys inside bar: X wraps next, Z/C purpose switch (skip empties)
  function onKeyDown(e: KeyboardEvent) {
    const k = e.key;
    if (k === 'z' || k === 'Z' || k === 'c' || k === 'C') {
      e.preventDefault();
      const dir = (k === 'z' || k === 'Z') ? -1 : 1;
      let idx = PURPOSES.indexOf(normalizedPurpose(selectedPurpose));
      for (let i = 0; i < PURPOSES.length; i++) {
        idx = (idx + dir + PURPOSES.length) % PURPOSES.length;
        const pc = PURPOSES[idx];
        if ((purposeCounts[pc] ?? 0) > 0) { selectedPurpose = pc; traitBarOffset = 0; break; }
      }
    }
  }

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

  function isSelectedValue(id: number) { return selectedValueIds?.has(id); }
</script>

<!-- Purpose pills -->
<div class="purpose-dots" on:wheel|stopPropagation on:click|stopPropagation on:keydown={onKeyDown} tabindex="-1">
  {#each PURPOSES as pc}
    {@const cnt = purposeCounts[pc] ?? 0}
    <button type="button" class="purpose-dot {pc === normalizedPurpose(selectedPurpose) ? 'active' : ''} {cnt === 0 ? 'disabled' : ''}"
      disabled={cnt === 0}
      on:click={() => clickPurpose(pc, cnt)}>
      {pc}{#if cnt > 0} ({cnt}){/if}
    </button>
  {/each}
  <div style="height:10px;"></div>
</div>

<!-- Trait bar at bottom -->
<div class="trait-bar" on:wheel|stopPropagation on:click|stopPropagation>
  <button type="button" class="trait-arrow" title="Prev traits" on:click={prevTraitPage} disabled={!hasPrevTraitPage()}>&larr;</button>
  <div class="trait-strip">
    {#each filtered.slice(startIdx, endIdx) as tr, i (`${tr.type_id}-${tr.value_id}-${i}`)}
      <div class="trait-box {isSelectedValue(tr.value_id) ? 'selected' : ''}" title={`${tr.type_name}: ${tr.value}`} on:click={() => emitToggleValue(tr.value_id)}>
        <div class="trait-head">{(tr.spatial_group ?? 'UNDF').toUpperCase()}. {tr.type_name}</div>
        <div class="trait-val">{tr.value}</div>
      </div>
    {/each}
  </div>
  <button type="button" class="trait-arrow" title="Next traits" on:click={nextTraitPage} disabled={!hasNextTraitPage()}>&rarr;</button>
  <!-- hidden focus catcher to keep keydown working -->
  <input style="position:absolute;opacity:0;pointer-events:none;width:0;height:0;" aria-hidden="true" on:keydown={onKeyDown} />
</div>

<style>
  .purpose-dots {
    position: fixed;
    left: 0; right: 0; bottom: 82px; /* gap above bar */
    height: 22px;
    display: flex; align-items: center; justify-content: center;
    pointer-events: auto;
    z-index: 9001;
  }
  .purpose-dot { cursor: pointer; margin: 0 6px; padding: 3px 8px; font-size: 12px; color: #cfcfd2; background: rgba(12,12,14,0.85); border: 1px solid rgba(255,255,255,0.12); border-radius: 999px; }
  .purpose-dot.active { color: #111; background: #e6e6e6; border-color: #e6e6e6; }
  .purpose-dot.disabled { opacity: 0.35; cursor: default; }
  .purpose-dot:focus, .purpose-dot:focus-visible { outline: none; box-shadow: none; }

  .trait-bar {
    position: fixed; left: 0; right: 0; bottom: 22px; height: 50px;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: stretch; justify-content: space-between;
    z-index: 9000;
    pointer-events: auto;
  }
  .trait-arrow { width: 50px; height: 50px; border: 0; background: transparent; color: #e6e6e6; cursor: pointer; align-self: center; }
  .trait-arrow:hover { background: rgba(255,255,255,0.06); }
  .trait-arrow:disabled { opacity: 0.25; cursor: default; }
  .trait-strip { flex: 1; display: flex; overflow: hidden; }
  .trait-box { width: 150px; height: 50px; padding: 6px 8px; box-sizing: border-box; border-left: 1px solid rgba(255,255,255,0.06); cursor: pointer; align-self: center; }
  .trait-box:hover { background: rgba(255,255,255,0.06); }
  .trait-box.selected { background: rgba(255,255,255,0.12); }
  .trait-head { font-size: 11px; opacity: 0.8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .trait-val { font-size: 13px; font-weight: 600; white-space: normal; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; line-height: 1.1; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word; }
</style>
