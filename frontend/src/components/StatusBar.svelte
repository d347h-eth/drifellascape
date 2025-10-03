<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { DEFAULT_SEARCH_LIMIT } from '../lib/search';
  import type { DataSource, Row } from '../lib/types';

  export let dataSource: DataSource = 'listings';
  export let gridMode: boolean = true;
  export let inExplore: boolean = false;
  export let motionEnabled: boolean = true;
  export let autoSnapEnabled: boolean = true;
  export let isMobile: boolean = false;
  export let collapsed: boolean = false;
  export let showTraitBar: boolean = false;
  export let activeIndex: number = 0; // gallery
  export let baseOffset: number = 0;   // gallery/grid
  export let itemsLength: number = 0;  // gallery/grid
  export let total: number = 0;        // gallery/grid
  export let gridCurrentPage: number = 1;
  export let filtersApplied: boolean = false; // selectedValueIds.size > 0
  export let sortAscListings: boolean = true;
  export let sortAscTokens: boolean = true;
  export let networkBusy: boolean = false;
  export let currentRow: Row | null = null;
  
  const dispatch = createEventDispatcher();

  // Mobile sectionization: 0 = toggles, 1 = pagination/search
  let section = 0;
  $: if (collapsed) section = 0;

  // Quick token search
  let tokenInput = '';
  let tokenDirty = false;
  let tokenInputEl: HTMLInputElement | null = null;
  export function focusTokenSearch() { tokenInputEl?.focus(); tokenInputEl?.select(); }
  function tokenNumLabel(): string {
    const tn = (currentRow as any)?.token_num;
    return (typeof tn === 'number') ? `#${tn}` : '';
  }
  function refillFromCurrent() {
    const v = tokenNumLabel();
    if (v) { tokenInput = v; tokenDirty = false; }
  }

  $: sortLabel = dataSource === 'tokens'
    ? `Token ${sortAscTokens ? '↑' : '↓'}`
    : `Price ${sortAscListings ? '↑' : '↓'}`;

  // Numbers
  $: galleryIndex1 = baseOffset + activeIndex + 1; // 1-based
  // Use last loaded index for grid so page increases as you load forward
  $: totalPages = Math.max(1, Math.ceil((Number(total) || 0) / DEFAULT_SEARCH_LIMIT));
  // gridCurrentPage is provided by parent to reflect user viewport progression
  function getPrice(r: Row): number | undefined { return (r as any)?.price; }
  function getSource(r: Row): string | undefined { return (r as any)?.listing_source; }
  function getMint(r: Row): string { return (r as any)?.token_mint_addr; }
  function getName(r: Row): string {
    const anyr: any = r as any;
    return anyr?.token_name || (typeof anyr?.token_num === 'number' ? `#${anyr.token_num}` : getMint(r));
  }

  // Keep token input synced with current token when in gallery (not collapsed)
  // Do not overwrite while the input itself is focused to avoid dropping keystrokes
  $: if (!gridMode && !collapsed) {
    const tn = (currentRow as any)?.token_num;
    const focused = typeof document !== 'undefined' && document.activeElement === tokenInputEl;
    if (typeof tn === 'number' && !tokenDirty && !focused) tokenInput = `#${tn}`;
  }

  function parseTokenNum(raw: string): number | null {
    const s = String(raw || '').trim().replace(/^#/, '');
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    if (n < 0) return 0;
    if (n > 1332) return 1332; // 0..1332 inclusive
    return Math.floor(n);
  }
  function triggerSearch() {
    const n = parseTokenNum(tokenInput);
    if (n === null) return;
    tokenDirty = false;
    dispatch('tokenSearch', n);
  }
  function meUrl(mint: string) { return `https://magiceden.io/item-details/${mint}`; }
  function tsUrl(mint: string) { return `https://tensor.trade/item/${mint}`; }
  function listingPrimary(src: string | undefined): 'ME' | 'TS' {
    if (!src) return 'ME';
    if (src.startsWith('TENSOR')) return 'TS';
    return 'ME';
  }
  function ceilDiv(n: number, d: number) { return Math.floor((n + d - 1) / d); }
  function priceWithFees(nominalLamports: number): number {
    const maker = ceilDiv(nominalLamports * 2, 100);
    const royalty = ceilDiv(nominalLamports * 5, 100);
    return nominalLamports + maker + royalty;
  }
  function formatSol(raw: number): string {
    const sol = raw / 1_000_000_000;
    const up = Math.ceil(sol * 100) / 100;
    return up.toFixed(2);
  }

  // Derived: current price label for display
  $: _p = currentRow ? getPrice(currentRow) : undefined;
  $: curPriceLabel = (typeof _p === 'number') ? `${formatSol(priceWithFees(_p))} SOL` : '';

</script>

<div class="statusbar" class:collapsed={collapsed}>
  <div class="left">
    {#if isMobile}
      <button class="btn hamburger" on:click={() => {
        if (collapsed) dispatch('toggleMainBar');
        else if (section === 0) section = 1;
        else dispatch('toggleMainBar');
      }} title={collapsed ? 'Open' : (section===0 ? 'Next' : 'Collapse')}>
        {#if collapsed}☰{:else if section===0}→{:else}✕{/if}
      </button>
      {#if collapsed && !inExplore && !gridMode}
        <button class="btn rescroll" on:click={() => dispatch('rescroll')} title="Re-run gallery entry scroll">Rescroll</button>
      {/if}
    {/if}
    {#if !collapsed && (!isMobile || section === 0)}
    <button class="btn" on:click={() => dispatch('toggleSource')} title="Toggle data source (Listings/Tokens)">
      {dataSource === 'tokens' ? 'Listings' : 'Tokens'}
    </button>
    <button class="btn" on:click={() => dispatch('nextMode')} title="Switch mode">
      {#if gridMode}
        Gallery
      {:else if inExplore}
        Gallery
      {:else}
        Grid
      {/if}
    </button>
    <button class="btn" on:click={() => dispatch('toggleSort')} title="Toggle sort">
      {sortLabel}
    </button>
    <button class="btn {motionEnabled ? 'active' : ''}" on:click={() => dispatch('toggleMotion')} title="Toggle animation">
      Animation
    </button>
    <button class="btn {autoSnapEnabled ? 'active' : ''}" on:click={() => dispatch('toggleAutoSnap')} title="Toggle auto-snap">
      Autosnap
    </button>
    <button class="btn {showTraitBar ? 'active' : ''}" on:click={() => dispatch('toggleTraits')} title="Show/Hide traits bar">
      Traits
    </button>
    <button class="btn" on:click={() => dispatch('toggleHelp')} title="Show/Hide hotkeys overlay">
      Hotkeys
    </button>
    <button class="btn" on:click={() => dispatch('toggleAbout')} title="About this project">
      About
    </button>
    {/if}
  </div>
  {#if !collapsed}
  <div class="center">
    {#if !isMobile}
      {#if gridMode}
        <span class="mono">Page {gridCurrentPage}/{totalPages}</span>{#if filtersApplied || dataSource === 'listings'}<span class="sep">•</span><span class="mono">Total {total}</span>{/if}
        <span class="sep">•</span>
        <div class="token-search">
          <input bind:this={tokenInputEl} class="token-input" inputmode="numeric" pattern="[0-9]*" placeholder="#token" bind:value={tokenInput}
            on:input={() => tokenDirty = true}
            on:keydown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); triggerSearch(); }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); refillFromCurrent(); tokenInputEl && tokenInputEl.blur(); }
              else if (e.key === 'e' || e.key === 'E') { e.preventDefault(); e.stopPropagation(); tokenInputEl && (tokenInputEl.focus(), tokenInputEl.select()); }
            }} />
          
        </div>
      {:else if !inExplore}
        <span class="mono">{galleryIndex1}/{total}</span>{#if filtersApplied || dataSource === 'listings'}<span class="sep">•</span><span class="mono">Total {total}</span>{/if}
        <span class="sep">•</span>
        <div class="token-search">
          <input bind:this={tokenInputEl} class="token-input" inputmode="numeric" pattern="[0-9]*" bind:value={tokenInput}
            on:input={() => tokenDirty = true}
            on:keydown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); triggerSearch(); }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); refillFromCurrent(); tokenInputEl && tokenInputEl.blur(); }
              else if (e.key === 'e' || e.key === 'E') { e.preventDefault(); e.stopPropagation(); tokenInputEl && (tokenInputEl.focus(), tokenInputEl.select()); }
            }} />
          
        </div>
        {#if currentRow}
          <span class="sep">•</span>
          <span class="cluster">
            {#if curPriceLabel}<span class="mono">{curPriceLabel}</span>{/if}
            {#if listingPrimary(getSource(currentRow)) === 'ME'}
              <a class="link" href={meUrl(getMint(currentRow))} target="_blank" title="Magic Eden">[ME]</a>
              <a class="link" href={tsUrl(getMint(currentRow))} target="_blank" title="Tensor">[TS]</a>
            {:else}
              <a class="link" href={tsUrl(getMint(currentRow))} target="_blank" title="Tensor">[TS]</a>
              <a class="link" href={meUrl(getMint(currentRow))} target="_blank" title="Magic Eden">[ME]</a>
            {/if}
          </span>
        {/if}
      {/if}
    {/if}
  </div>
  {/if}
  {#if !collapsed}
  <div class="right">
    {#if isMobile && section === 1}
      {#if gridMode}
        <span class="mono">Page {gridCurrentPage}/{totalPages}</span>{#if filtersApplied || dataSource === 'listings'}<span class="sep">•</span><span class="mono">Total {total}</span>{/if}
        <span class="sep">•</span>
        <div class="token-search">
          <input bind:this={tokenInputEl} class="token-input" inputmode="numeric" pattern="[0-9]*" placeholder="#token" bind:value={tokenInput}
            on:input={() => tokenDirty = true}
            on:keydown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); triggerSearch(); }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); refillFromCurrent(); tokenInputEl && tokenInputEl.blur(); }
              else if (e.key === 'e' || e.key === 'E') { e.preventDefault(); e.stopPropagation(); tokenInputEl && (tokenInputEl.focus(), tokenInputEl.select()); }
            }} />
          
        </div>
      {:else if !inExplore}
        <span class="mono">{galleryIndex1}/{total}</span>{#if filtersApplied || dataSource === 'listings'}<span class="sep">•</span><span class="mono">Total {total}</span>{/if}
        <span class="sep">•</span>
        <div class="token-search">
          <input bind:this={tokenInputEl} class="token-input" inputmode="numeric" pattern="[0-9]*" bind:value={tokenInput}
            on:input={() => tokenDirty = true}
            on:keydown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); triggerSearch(); }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); refillFromCurrent(); tokenInputEl && tokenInputEl.blur(); }
              else if (e.key === 'e' || e.key === 'E') { e.preventDefault(); e.stopPropagation(); tokenInputEl && (tokenInputEl.focus(), tokenInputEl.select()); }
            }} />
          
        </div>
        {#if currentRow}
          <span class="sep">•</span>
          <span class="cluster">
            {#if curPriceLabel}<span class="mono">{curPriceLabel}</span>{/if}
            {#if listingPrimary(getSource(currentRow)) === 'ME'}
              <a class="link" href={meUrl(getMint(currentRow))} target="_blank" title="Magic Eden">[ME]</a>
              <a class="link" href={tsUrl(getMint(currentRow))} target="_blank" title="Tensor">[TS]</a>
            {:else}
              <a class="link" href={tsUrl(getMint(currentRow))} target="_blank" title="Tensor">[TS]</a>
              <a class="link" href={meUrl(getMint(currentRow))} target="_blank" title="Magic Eden">[ME]</a>
            {/if}
          </span>
        {/if}
      {/if}
    {/if}
    {#if networkBusy}
      <span class="busy" title="Loading" aria-live="polite" aria-busy="true">●</span>
    {/if}
  </div>
  {/if}
  </div>

<style>
  .statusbar {
    position: relative; width: 100%; height: 28px;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 12px; box-sizing: border-box; /* match grid padding */
    background: rgba(0,0,0,0.65);
    color: #e6e6e6;
    -webkit-user-select: none; user-select: none;
  }
  .statusbar.collapsed { width: auto; background: transparent; padding: 0 12px; }
  .left, .center, .right { display: flex; align-items: center; gap: 8px; }
  .center { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); white-space: nowrap; }
  .left { min-width: 420px; }
  .right { min-width: 40px; justify-content: flex-end; display: flex; align-items: center; white-space: nowrap; }
  .statusbar.collapsed .left { min-width: 0; }
  .btn {
    height: 20px; padding: 0 8px; font-size: 12px; line-height: 1; color: #e6e6e6;
    background: rgba(12,12,14,0.85); border: 1px solid rgba(255,255,255,0.12); border-radius: 4px;
    cursor: pointer;
  }
  .btn.hamburger { width: 28px; height: 28px; border-radius: 0; border: 0; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
  .btn.rescroll { height: 28px; margin-left: 6px; }
  .btn:hover { background: rgba(255,255,255,0.06); }
  .btn:focus, .btn:focus-visible { outline: none; box-shadow: none; }
  .btn.active { background: rgba(255,255,255,0.12); }
  .mono { font-variant-numeric: tabular-nums; opacity: 0.95; }
  .sep { opacity: 0.7; margin: 0 6px; }
  .busy { color: #00d0ff; font-size: 16px; line-height: 1; }
  .busy { animation: pulse 1s ease-in-out infinite; }
  @keyframes pulse {
    0%, 100% { opacity: 0.5; transform: scale(0.9); }
    50% { opacity: 1; transform: scale(1.1); }
  }
  .token-link { text-decoration: none; color: inherit; }
  .token-link:hover { text-decoration: underline; }
  .token-search { display: inline-flex; align-items: center; gap: 4px; }
  .token-input { height: 20px; width: 80px; padding: 0 6px; font-size: 12px; border: 1px solid rgba(255,255,255,0.2); background: rgba(12,12,14,0.85); color: #e6e6e6; border-radius: 4px; }
  .token-input:focus { outline: none; border-color: rgba(0,208,255,0.8); }
  
  .cluster { display: inline-flex; align-items: center; gap: 6px; }
  .link { text-decoration: none; color: inherit; }
</style>
