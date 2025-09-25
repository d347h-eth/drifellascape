<script lang="ts">
  export let show = false;
  export let onToggle: (() => void) | undefined;
  import { SCROLLBAR_GAP, PURPOSE_DOTS_BOTTOM, TOGGLE_OVER_DOTS_OFFSET } from '../../lib/ui-constants';
  // Bottom offset: SCROLLBAR_GAP when hidden; over pills when bar is shown
  $: bottom = show ? (PURPOSE_DOTS_BOTTOM + TOGGLE_OVER_DOTS_OFFSET) : SCROLLBAR_GAP;
</script>

<button
  type="button"
  class="trait-toggle-btn"
  title="Toggle traits bar"
  style={`bottom: ${bottom}px;`}
  on:click={() => onToggle?.()}
>
  {#if show}▼{:else}▲{/if}
</button>

<style>
  .trait-toggle-btn {
    position: fixed;
    left: 50%; transform: translateX(-50%);
    width: 200px; height: 14px;
    z-index: 9002;
    background: rgba(12,12,14,0.85);
    color: #e6e6e6;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 6px;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; line-height: 1;
  }
  .trait-toggle-btn:hover { background: rgba(255,255,255,0.10); }
  .trait-toggle-btn:focus, .trait-toggle-btn:focus-visible { outline: none; box-shadow: none; }
</style>
