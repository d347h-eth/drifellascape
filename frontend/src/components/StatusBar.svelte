<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { DEFAULT_SEARCH_LIMIT } from '../lib/search';
  import type { DataSource, Row } from '../lib/types';
  import PriceTag from './PriceTag.svelte';

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

</script>

<div class="statusbar" class:collapsed={collapsed}>
  <div class="left">
    {#if isMobile}
      <button class="btn hamburger" on:click={() => dispatch('toggleMainBar')} title="Toggle menu bar">
        {#if collapsed}☰{:else}✕{/if}
      </button>
      {#if collapsed && !inExplore && !gridMode}
        <button class="btn rescroll" on:click={() => dispatch('rescroll')} title="Re-run gallery entry scroll">Rescroll</button>
      {/if}
    {/if}
    {#if !collapsed}
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
        <span class="mono">Page {gridCurrentPage}/{totalPages}</span>
        {#if filtersApplied || dataSource === 'listings'}
          <span class="sep">•</span>
          <span class="mono">Total {total}</span>
        {/if}
      {:else if !inExplore}
        <span class="mono">{galleryIndex1}/{total}</span>
        {#if currentRow}
          <span class="sep">•</span>
          {#if dataSource === 'listings'}
            <PriceTag price={getPrice(currentRow)} listingSource={getSource(currentRow)} mint={getMint(currentRow)} />
          {:else}
            <a class="token-link" href={`https://magiceden.io/item-details/${getMint(currentRow)}`} target="_blank" rel="noopener noreferrer">{getName(currentRow)}</a>
          {/if}
        {/if}
      {/if}
    {/if}
  </div>
  {/if}
  {#if !collapsed}
  <div class="right">
    {#if isMobile}
      {#if gridMode}
        <span class="mono">Page {gridCurrentPage}/{totalPages}</span>
        {#if filtersApplied || dataSource === 'listings'}
          <span class="sep">•</span>
          <span class="mono">Total {total}</span>
        {/if}
      {:else if !inExplore}
        <span class="mono">{galleryIndex1}/{total}</span>
        {#if currentRow}
          <span class="sep">•</span>
          {#if dataSource === 'listings'}
            <PriceTag price={getPrice(currentRow)} listingSource={getSource(currentRow)} mint={getMint(currentRow)} />
          {:else}
            <a class="token-link" href={`https://magiceden.io/item-details/${getMint(currentRow)}`} target="_blank" rel="noopener noreferrer">{getName(currentRow)}</a>
          {/if}
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
    position: static; width: 100%; height: 28px;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 12px; box-sizing: border-box; /* match grid padding */
    background: rgba(0,0,0,0.65);
    color: #e6e6e6;
    -webkit-user-select: none; user-select: none;
  }
  .statusbar.collapsed { width: auto; background: transparent; padding: 0 12px; }
  .left, .center, .right { display: flex; align-items: center; gap: 8px; }
  .center { position: absolute; left: 50%; transform: translateX(-50%); }
  .left { min-width: 420px; }
  .right { min-width: 40px; justify-content: flex-end; }
  .statusbar.collapsed .left { min-width: 0; }
  .btn {
    height: 20px; padding: 0 8px; font-size: 12px; line-height: 1; color: #e6e6e6;
    background: rgba(12,12,14,0.85); border: 1px solid rgba(255,255,255,0.12); border-radius: 4px;
    cursor: pointer;
  }
  .btn.hamburger { height: 28px; border-radius: 0; border: 0; }
  .btn.rescroll { height: 28px; margin-left: 6px; }
  .btn:hover { background: rgba(255,255,255,0.06); }
  .btn:focus, .btn:focus-visible { outline: none; box-shadow: none; }
  .btn.active { background: rgba(255,255,255,0.12); }
  .mono { font-variant-numeric: tabular-nums; opacity: 0.95; }
  .sep { opacity: 0.7; }
  .busy { color: #00d0ff; font-size: 16px; line-height: 1; }
  .busy { animation: pulse 1s ease-in-out infinite; }
  @keyframes pulse {
    0%, 100% { opacity: 0.5; transform: scale(0.9); }
    50% { opacity: 1; transform: scale(1.1); }
  }
  .token-link { text-decoration: none; color: inherit; }
  .token-link:hover { text-decoration: underline; }
</style>
