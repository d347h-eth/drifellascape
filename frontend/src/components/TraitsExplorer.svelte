<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { TraitCatalogBucket, TraitCatalogValue, TraitsCatalog } from '../lib/types';

  export let visible: boolean = false;
  export let isMobile: boolean = false;
  export let catalog: TraitsCatalog | null = null;
  export let loading: boolean = false;
  export let error: string | null = null;
  export let selectedValueIds: Set<number> = new Set();

  const dispatch = createEventDispatcher<{
    close: void;
    valueClick: { valueId: number; replace: boolean };
  }>();

  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
  });

  let collapsedTypeIds: Set<number> = new Set();

  function compareText(a: string | null | undefined, b: string | null | undefined): number {
    return collator.compare(a ?? '', b ?? '');
  }

  function compareBuckets(a: TraitCatalogBucket, b: TraitCatalogBucket): number {
    return (
      compareText(a.type_name, b.type_name) ||
      compareText(a.spatial_group, b.spatial_group) ||
      a.type_id - b.type_id
    );
  }

  function compareValues(a: TraitCatalogValue, b: TraitCatalogValue): number {
    return compareText(a.value, b.value) || a.value_id - b.value_id;
  }

  $: buckets = (catalog?.buckets ?? [])
    .slice()
    .sort(compareBuckets)
    .map((bucket) => ({
      ...bucket,
      values: bucket.values.slice().sort(compareValues),
    }));

  function bucketLabel(bucket: TraitCatalogBucket): string {
    const group = bucket.spatial_group?.trim();
    return group ? `${group.toUpperCase()}. ${bucket.type_name}` : bucket.type_name;
  }

  function toggleBucket(typeId: number) {
    const next = new Set(collapsedTypeIds);
    if (next.has(typeId)) next.delete(typeId);
    else next.add(typeId);
    collapsedTypeIds = next;
  }

  function isCollapsed(typeId: number): boolean {
    return collapsedTypeIds.has(typeId);
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
  <aside class="traits-explorer" class:mobile={isMobile} role="dialog" aria-modal={isMobile ? 'true' : 'false'} aria-label="Traits explorer">
    <header class="panel-header">
      <div>
        <div class="panel-title">Traits</div>
        {#if catalog}
          <div class="panel-subtitle">{catalog.total_tokens} tokens</div>
        {/if}
      </div>
      <button type="button" class="close" aria-label="Close traits explorer" title="Close" on:click={() => dispatch('close')}>×</button>
    </header>

    <div class="panel-body">
      {#if loading}
        <div class="state">Loading traits…</div>
      {:else if error}
        <div class="state error">{error}</div>
      {:else if buckets.length === 0}
        <div class="state">No traits found.</div>
      {:else}
        {#each buckets as bucket (bucket.type_id)}
          {@const collapsed = isCollapsed(bucket.type_id)}
          <section class="bucket">
            <button
              type="button"
              class="bucket-header"
              aria-expanded={!collapsed}
              on:click={() => toggleBucket(bucket.type_id)}
            >
              <span class="chevron">{collapsed ? '›' : '⌄'}</span>
              <span class="bucket-name">{bucketLabel(bucket)}</span>
              <span class="bucket-count">{bucket.values.length}</span>
            </button>
            {#if !collapsed}
              <div class="values">
                {#each bucket.values as value (value.value_id)}
                  <button
                    type="button"
                    class="value-row"
                    class:selected={selectedValueIds.has(value.value_id)}
                    title="Ctrl-click to replace active filters with this value"
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
  .panel-header {
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px 0 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    box-sizing: border-box;
  }
  .panel-title {
    font-size: 15px;
    font-weight: 700;
    line-height: 1.2;
  }
  .panel-subtitle {
    margin-top: 2px;
    font-size: 11px;
    opacity: 0.68;
  }
  .close {
    width: 28px;
    height: 28px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(0, 0, 0, 0.35);
    color: inherit;
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
  }
  .close:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  .close:focus,
  .close:focus-visible,
  .bucket-header:focus,
  .bucket-header:focus-visible,
  .value-row:focus,
  .value-row:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 1px rgba(0, 208, 255, 0.75);
  }
  .panel-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 8px 0 20px;
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
  .bucket-header {
    width: 100%;
    min-height: 38px;
    padding: 0 12px;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    text-align: left;
  }
  .bucket-header:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  .chevron {
    opacity: 0.7;
    font-size: 16px;
  }
  .bucket-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 700;
  }
  .bucket-count {
    min-width: 24px;
    text-align: right;
    font-size: 11px;
    opacity: 0.62;
    font-variant-numeric: tabular-nums;
  }
  .values {
    padding: 0 0 6px 38px;
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
