<script lang="ts">
  import { createEventDispatcher, tick } from 'svelte';
  import type { TraitCatalogBucket, TraitCatalogValue, TraitsCatalog } from '../lib/types';

  export let visible: boolean = false;
  export let isMobile: boolean = false;
  export let catalog: TraitsCatalog | null = null;
  export let loading: boolean = false;
  export let error: string | null = null;
  export let selectedValueIds: Set<number> = new Set();

  type SortMode = 'rarity' | 'alpha';
  type BucketView = TraitCatalogBucket & {
    label: string;
    visibleValues: TraitCatalogValue[];
    valueCount: number;
    bucketQuery: string;
    sortMode: SortMode;
    expanded: boolean;
    rootBucketMatch: boolean;
  };

  const ROOT_SEARCH_MIN_LENGTH = 1;
  const dispatch = createEventDispatcher<{
    close: void;
    valueClick: { valueId: number; replace: boolean };
  }>();

  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
  });

  let expandedTypeIds: Set<number> = new Set();
  let searchCollapsedTypeIds: Set<number> = new Set();
  let lastRootSearchKey = '';
  let rootQuery = '';
  let rootSearch = '';
  let buckets: BucketView[] = [];
  let bucketQueries: Record<number, string> = {};
  let bucketSortModes: Record<number, SortMode> = {};
  let bucketHeaderEls: Record<number, HTMLDivElement | null> = {};

  function compareText(a: string | null | undefined, b: string | null | undefined): number {
    return collator.compare(a ?? '', b ?? '');
  }

  function normalizeQuery(value: string): string {
    return value.trim().toLocaleLowerCase();
  }

  function matchesQuery(value: string | null | undefined, query: string): boolean {
    if (!query) return true;
    return (value ?? '').toLocaleLowerCase().includes(query);
  }

  function bucketLabel(bucket: TraitCatalogBucket): string {
    const group = bucket.spatial_group?.trim();
    return group ? `${group.toUpperCase()}. ${bucket.type_name}` : bucket.type_name;
  }

  function compareBuckets(a: TraitCatalogBucket, b: TraitCatalogBucket): number {
    return (
      compareText(bucketLabel(a), bucketLabel(b)) ||
      compareText(a.type_name, b.type_name) ||
      a.type_id - b.type_id
    );
  }

  function compareValuesAlpha(a: TraitCatalogValue, b: TraitCatalogValue): number {
    return compareText(a.value, b.value) || a.value_id - b.value_id;
  }

  function compareValuesRarity(a: TraitCatalogValue, b: TraitCatalogValue): number {
    return (
      a.rarity_pct - b.rarity_pct ||
      a.tokens_with_type_value - b.tokens_with_type_value ||
      compareValuesAlpha(a, b)
    );
  }

  function sortedValues(values: TraitCatalogValue[], sortMode: SortMode): TraitCatalogValue[] {
    return values
      .slice()
      .sort(sortMode === 'alpha' ? compareValuesAlpha : compareValuesRarity);
  }

  function getBucketQuery(typeId: number): string {
    return bucketQueries[typeId] ?? '';
  }

  function getBucketSortMode(typeId: number): SortMode {
    return bucketSortModes[typeId] ?? 'rarity';
  }

  function bucketIsInSearchMode(
    typeId: number,
    rootSearchValue: string,
    queries: Record<number, string>,
  ): boolean {
    return (
      rootSearchValue.length >= ROOT_SEARCH_MIN_LENGTH ||
      normalizeQuery(queries[typeId] ?? '').length > 0
    );
  }

  function bucketIsExpanded(
    typeId: number,
    rootSearchValue: string,
    queries: Record<number, string>,
    expandedIds: Set<number>,
    searchCollapsedIds: Set<number>,
  ): boolean {
    if (bucketIsInSearchMode(typeId, rootSearchValue, queries)) {
      return !searchCollapsedIds.has(typeId);
    }
    return expandedIds.has(typeId);
  }

  function buildBucketView(
    bucket: TraitCatalogBucket,
    rootSearchValue: string,
    queries: Record<number, string>,
    sortModes: Record<number, SortMode>,
    expandedIds: Set<number>,
    searchCollapsedIds: Set<number>,
  ): BucketView | null {
    const label = bucketLabel(bucket);
    const bucketQuery = queries[bucket.type_id] ?? '';
    const normalizedBucketQuery = normalizeQuery(bucketQuery);
    const hasBucketQuery = normalizedBucketQuery.length > 0;
    const rootSearchActive = rootSearchValue.length >= ROOT_SEARCH_MIN_LENGTH;
    const sortMode = sortModes[bucket.type_id] ?? 'rarity';
    const bucketMatchesRoot = rootSearchActive && matchesQuery(label, rootSearchValue);
    const valuesMatchingRoot = rootSearchActive
      ? bucket.values.filter((value) => matchesQuery(value.value, rootSearchValue))
      : bucket.values;

    if (
      !hasBucketQuery &&
      rootSearchActive &&
      !bucketMatchesRoot &&
      valuesMatchingRoot.length === 0
    ) {
      return null;
    }

    let visibleValues = bucket.values;
    if (hasBucketQuery) {
      visibleValues = bucket.values.filter((value) =>
        matchesQuery(value.value, normalizedBucketQuery),
      );
    } else if (rootSearchActive) {
      visibleValues = valuesMatchingRoot;
    }

    return {
      ...bucket,
      label,
      values: bucket.values,
      visibleValues: sortedValues(visibleValues, sortMode),
      valueCount: visibleValues.length,
      bucketQuery,
      sortMode,
      expanded: bucketIsExpanded(
        bucket.type_id,
        rootSearchValue,
        queries,
        expandedIds,
        searchCollapsedIds,
      ),
      rootBucketMatch: bucketMatchesRoot,
    };
  }

  $: rootSearch = normalizeQuery(rootQuery);
  $: {
    const nextRootSearchKey = rootSearch.length >= ROOT_SEARCH_MIN_LENGTH ? rootSearch : '';
    if (nextRootSearchKey !== lastRootSearchKey) {
      lastRootSearchKey = nextRootSearchKey;
      searchCollapsedTypeIds = new Set();
    }
  }
  $: buckets = (catalog?.buckets ?? [])
    .slice()
    .sort(compareBuckets)
    .map((bucket) =>
      buildBucketView(
        bucket,
        rootSearch,
        bucketQueries,
        bucketSortModes,
        expandedTypeIds,
        searchCollapsedTypeIds,
      ),
    )
    .filter((bucket): bucket is BucketView => bucket !== null);

  function isSearchMode(typeId: number): boolean {
    return bucketIsInSearchMode(typeId, rootSearch, bucketQueries);
  }

  function toggleBucket(typeId: number) {
    if (isSearchMode(typeId)) {
      const next = new Set(searchCollapsedTypeIds);
      if (next.has(typeId)) next.delete(typeId);
      else next.add(typeId);
      searchCollapsedTypeIds = next;
      return;
    }

    const next = new Set(expandedTypeIds);
    if (next.has(typeId)) next.delete(typeId);
    else next.add(typeId);
    expandedTypeIds = next;
  }

  function handleRootInput(event: Event) {
    rootQuery = (event.currentTarget as HTMLInputElement).value;
  }

  function resetRootSearch() {
    rootQuery = '';
    lastRootSearchKey = '';
    searchCollapsedTypeIds = new Set();
  }

  function handleBucketInput(event: Event, typeId: number) {
    const value = (event.currentTarget as HTMLInputElement).value;
    bucketQueries = { ...bucketQueries, [typeId]: value };
    if (value.length > 0) {
      const next = new Set(searchCollapsedTypeIds);
      next.delete(typeId);
      searchCollapsedTypeIds = next;
    }
  }

  function toggleSortMode(typeId: number) {
    const nextMode: SortMode = getBucketSortMode(typeId) === 'rarity' ? 'alpha' : 'rarity';
    bucketSortModes = { ...bucketSortModes, [typeId]: nextMode };
  }

  async function jumpRootSearchToBucket(typeId: number) {
    const query = rootQuery;
    if (normalizeQuery(query).length < ROOT_SEARCH_MIN_LENGTH) return;

    const collapsed = new Set<number>();
    for (const bucket of catalog?.buckets ?? []) {
      if (bucket.type_id !== typeId) collapsed.add(bucket.type_id);
    }

    bucketQueries = { ...bucketQueries, [typeId]: query };
    rootQuery = '';
    lastRootSearchKey = '';
    expandedTypeIds = new Set([typeId]);
    searchCollapsedTypeIds = collapsed;

    await tick();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    bucketHeaderEls[typeId]?.scrollIntoView({ block: 'start' });
  }

  function formatPercent(value: number): string {
    if (!Number.isFinite(value)) return '0%';
    if (value > 0 && value < 0.01) return '<0.01%';
    return `${value.toFixed(value < 10 ? 2 : 1)}%`;
  }

  function handleValueClick(event: MouseEvent, valueId: number) {
    dispatch('valueClick', { valueId, replace: event.ctrlKey });
  }
</script>

{#if visible}
  <aside
    class="traits-explorer"
    class:mobile={isMobile}
    role="dialog"
    aria-modal={isMobile ? 'true' : 'false'}
    aria-label="Traits explorer"
  >
    <div class="panel-top">
      <form class="root-search" role="search" on:submit|preventDefault>
        <input
          type="text"
          class="search-input"
          aria-label="Search traits"
          data-testid="traits-root-search"
          value={rootQuery}
          autocomplete="off"
          spellcheck="false"
          on:input={handleRootInput}
        />
        {#if rootQuery.length > 0}
          <button
            type="button"
            class="root-reset"
            aria-label="Reset trait search"
            data-testid="traits-root-reset"
            on:click={resetRootSearch}
          >
            x
          </button>
        {/if}
      </form>
      <button
        type="button"
        class="close"
        aria-label="Close traits explorer"
        title="Close"
        on:click={() => dispatch('close')}
      >
        x
      </button>
    </div>

    <div class="panel-body">
      {#if loading}
        <div class="state" aria-label="Loading traits">...</div>
      {:else if error}
        <div class="state error" aria-label={error}>!</div>
      {:else if buckets.length === 0}
        <div class="state" aria-label="No traits found">-</div>
      {:else}
        {#each buckets as bucket (bucket.type_id)}
          <section class="bucket" data-testid={`traits-bucket-${bucket.type_id}`}>
            <div
              class="bucket-header-row"
              bind:this={bucketHeaderEls[bucket.type_id]}
            >
              <button
                type="button"
                class="bucket-header"
                aria-expanded={bucket.expanded}
                aria-label={bucket.label}
                data-testid={`traits-bucket-header-${bucket.type_id}`}
                on:click={() => toggleBucket(bucket.type_id)}
              >
                <span class="chevron" aria-hidden="true">{bucket.expanded ? 'v' : '>'}</span>
                <span class="bucket-name">{bucket.label}</span>
              </button>
              {#if bucket.rootBucketMatch}
                <button
                  type="button"
                  class="jump-button"
                  aria-label={`Jump to ${bucket.label}`}
                  data-testid={`traits-bucket-jump-${bucket.type_id}`}
                  on:click={() => jumpRootSearchToBucket(bucket.type_id)}
                >
                  jump
                </button>
              {/if}
              <span class="bucket-count">{bucket.valueCount}</span>
            </div>
            {#if bucket.expanded}
              <div class="bucket-body">
                <form class="bucket-controls" role="search" on:submit|preventDefault>
                  <input
                    type="search"
                    class="search-input bucket-search"
                    aria-label={`Search ${bucket.label}`}
                    data-testid={`traits-bucket-search-${bucket.type_id}`}
                    value={bucket.bucketQuery}
                    autocomplete="off"
                    spellcheck="false"
                    on:input={(event) => handleBucketInput(event, bucket.type_id)}
                  />
                  <button
                    type="button"
                    class="sort-toggle"
                    aria-label={bucket.sortMode === 'rarity' ? 'Sort trait names alpha-numeric ascending' : 'Sort by rarity ascending'}
                    title={bucket.sortMode === 'rarity' ? 'A-Z' : '%'}
                    data-testid={`traits-bucket-sort-${bucket.type_id}`}
                    on:click={() => toggleSortMode(bucket.type_id)}
                  >
                    {bucket.sortMode === 'rarity' ? '%' : 'A'}
                  </button>
                </form>
                <div class="values">
                  {#each bucket.visibleValues as value (value.value_id)}
                    <button
                      type="button"
                      class="value-row"
                      class:selected={selectedValueIds.has(value.value_id)}
                      title="Ctrl-click to replace active filters with this value"
                      data-testid={`traits-value-${value.value_id}`}
                      on:click={(event) => handleValueClick(event, value.value_id)}
                    >
                      <span class="value-name">{value.value}</span>
                      <span class="value-meta">
                        <span>{value.tokens_with_type_value}</span>
                        <span>{formatPercent(value.rarity_pct)}</span>
                      </span>
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
          </section>
        {/each}
      {/if}
    </div>
  </aside>
{/if}

<style>
  .traits-explorer {
    position: fixed;
    inset: 0 auto 0 0;
    width: var(--traits-explorer-width, min(33vw, 480px));
    min-width: 320px;
    background: rgba(12, 12, 14, 0.98);
    border-right: 1px solid rgba(255, 255, 255, 0.12);
    color: #e6e6e6;
    z-index: 9800;
    display: flex;
    flex-direction: column;
    box-shadow: 10px 0 24px rgba(0, 0, 0, 0.35);
  }
  .traits-explorer.mobile {
    width: 100vw;
    min-width: 0;
    border-right: 0;
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
  .root-search {
    position: relative;
    min-width: 0;
  }
  .search-input {
    width: 100%;
    height: 30px;
    box-sizing: border-box;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(0, 0, 0, 0.35);
    color: inherit;
    font-size: 13px;
    line-height: 1;
    border-radius: 4px;
    padding: 0 28px 0 9px;
    outline: none;
  }
  .search-input:focus,
  .search-input:focus-visible {
    border-color: rgba(0, 208, 255, 0.75);
    box-shadow: 0 0 0 1px rgba(0, 208, 255, 0.4);
  }
  .root-search .search-input::-webkit-search-cancel-button {
    -webkit-appearance: none;
    appearance: none;
  }
  .root-reset {
    position: absolute;
    top: 50%;
    right: 2px;
    width: 26px;
    height: 26px;
    transform: translateY(-50%);
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    opacity: 0.75;
  }
  .root-reset:hover {
    opacity: 1;
  }
  .close,
  .sort-toggle {
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
  .close:hover,
  .sort-toggle:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  .close:focus,
  .bucket-header:focus,
  .value-row:focus,
  .root-reset:focus,
  .sort-toggle:focus,
  .jump-button:focus {
    outline: none;
    box-shadow: none;
  }
  .close:focus-visible,
  .bucket-header:focus-visible,
  .value-row:focus-visible,
  .root-reset:focus-visible,
  .sort-toggle:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 1px rgba(0, 208, 255, 0.75);
  }
  .jump-button:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 1px rgba(0, 208, 255, 0.75);
  }
  .panel-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 4px 0 20px;
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
  .bucket {
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .bucket-header-row {
    min-height: 38px;
    padding: 0 12px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .bucket-header-row:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  .bucket-header {
    min-width: 0;
    max-width: 100%;
    height: 38px;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    text-align: left;
  }
  .bucket-header:hover,
  .jump-button:hover {
    color: #fff;
  }
  .chevron {
    flex: 0 0 18px;
    opacity: 0.7;
    font-size: 13px;
  }
  .bucket-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 700;
  }
  .jump-button {
    flex: 0 0 auto;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(0, 0, 0, 0.35);
    color: inherit;
    cursor: pointer;
    font-size: 9px;
    line-height: 1;
  }
  .bucket-count {
    margin-left: auto;
    flex: 0 0 auto;
    min-width: 24px;
    text-align: right;
    font-size: 11px;
    opacity: 0.62;
    font-variant-numeric: tabular-nums;
  }
  .bucket-body {
    padding: 0 0 6px 38px;
  }
  .bucket-controls {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 28px;
    gap: 6px;
    padding: 0 10px 6px 0;
  }
  .bucket-search {
    height: 28px;
    padding-right: 9px;
  }
  .values {
    display: flex;
    flex-direction: column;
  }
  .value-row {
    width: 100%;
    min-height: 30px;
    padding: 0 12px 0 0;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    text-align: left;
  }
  .value-row:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  .value-row.selected {
    background: rgba(255, 255, 255, 0.12);
  }
  .value-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }
  .value-meta {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    opacity: 0.72;
    font-variant-numeric: tabular-nums;
  }
</style>
