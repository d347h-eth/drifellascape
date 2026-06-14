<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { OwnerSummaryRow } from '../lib/types';

  export let rows: OwnerSummaryRow[] = [];
  export let loading = false;
  export let error: string | null = null;

  const dispatch = createEventDispatcher<{
    ownerSearch: string;
  }>();

  function maskedAddress(value: string): string {
    return value.slice(0, 4).toUpperCase();
  }

  function formatPct(value: number): string {
    if (!Number.isFinite(value)) return '0.0';
    return value.toFixed(1);
  }
</script>

<section class="owners-view" aria-label="Owners">
  {#if error}
    <div class="state error" aria-label={error}>!</div>
  {:else if loading}
    <div class="state" aria-label="Loading owners">...</div>
  {:else if rows.length === 0}
    <div class="state" aria-label="No owners">-</div>
  {:else}
    <table class="owners-table">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">owner</th>
          <th scope="col">amount</th>
          <th scope="col">supply %</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row, index (row.owner)}
          <tr>
            <td>{index + 1}</td>
            <td>
              <button
                type="button"
                class="owner-link"
                title={row.owner}
                aria-label={`Filter by owner ${row.owner}`}
                on:click={() => dispatch('ownerSearch', row.owner)}
              >
                {maskedAddress(row.owner)}
              </button>
            </td>
            <td>{row.amount}</td>
            <td>{formatPct(row.supply_pct)}%</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  .owners-view {
    min-height: 100vh;
    box-sizing: border-box;
    padding: 44px 32px 72px;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    background: #050506;
    color: #e6e6e6;
  }

  .owners-table {
    width: min(980px, calc(100vw - 64px));
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }

  th,
  td {
    text-align: center;
    vertical-align: middle;
    padding: 10px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  th {
    color: rgba(230, 230, 230, 0.72);
    font-size: 12px;
    font-weight: 500;
    text-transform: lowercase;
  }

  td {
    color: rgba(230, 230, 230, 0.95);
  }

  .owner-link {
    appearance: none;
    border: 0;
    background: transparent;
    color: inherit;
    padding: 0;
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .owner-link:hover {
    color: #ffffff;
  }

  .owner-link:focus,
  .owner-link:focus-visible {
    outline: none;
    box-shadow: none;
  }

  .state {
    margin-top: 20vh;
    font-size: 18px;
    color: rgba(230, 230, 230, 0.72);
  }

  .state.error {
    color: #ff6b6b;
  }

  @media (max-width: 700px) {
    .owners-view {
      padding: 28px 12px 56px;
    }

    .owners-table {
      width: 100%;
      font-size: 12px;
    }

    th,
    td {
      padding: 8px 6px;
    }
  }
</style>
