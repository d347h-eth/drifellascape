<script lang="ts">
  export let price: number | undefined; // raw lamports (SOL 9dp)
  export let listingSource: string | undefined;
  export let mint: string;

  function marketplaceFor(src: string | undefined, mint: string): { href: string; title: string } | null {
    if (!src) return null;
    if (src === 'M2' || src === 'MMM' || src === 'M3' || src === 'HADESWAP_AMM') return { href: `https://magiceden.io/item-details/${mint}`, title: 'View on Magic Eden' };
    if (src === 'TENSOR_LISTING' || src === 'TENSOR_CNFT_LISTING' || src === 'TENSOR_MARKETPLACE_LISTING' || src === 'TENSOR_AMM' || src === 'TENSOR_AMM_V2') return { href: `https://tensor.trade/item/${mint}`, title: 'View on Tensor' };
    return null;
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
  $: m = marketplaceFor(listingSource, mint);
  $: show = typeof price === 'number' && Number.isFinite(price as any);
  $: label = show ? `${formatSol(priceWithFees(price as number))} SOL` : '';
</script>

{#if show}
  {#if m}
    <a class="price-link" href={m.href} target="_blank" rel="noopener noreferrer" title={m.title}>{label}</a>
  {:else}
    <span class="price">{label}</span>
  {/if}
{/if}

<style>
  .price, .price-link { font-variant-numeric: tabular-nums; }
  .price-link { text-decoration: none; color: inherit; }
  .price-link:hover { text-decoration: underline; }
  .price-link:visited { color: inherit; }
  .price { opacity: 0.9; }
</style>
