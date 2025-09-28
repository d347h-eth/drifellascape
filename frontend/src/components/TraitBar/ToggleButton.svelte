<script lang="ts">
  export let show = false;
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();
  import { SCROLLBAR_GAP, PURPOSE_DOTS_BOTTOM, TOGGLE_OVER_DOTS_OFFSET } from '../../lib/ui-constants';
  // Bottom offset: SCROLLBAR_GAP when hidden; over pills when bar is shown
  $: bottom = show ? (PURPOSE_DOTS_BOTTOM + TOGGLE_OVER_DOTS_OFFSET) : SCROLLBAR_GAP;
</script>

<button
  type="button"
  class="trait-toggle-btn"
  title="Toggle traits bar"
  style={`bottom: ${bottom}px;`}
  on:click={() => dispatch('toggle')}
>
  <span class="glyph">{#if show}✕{:else}☰{/if}</span>
  <span class="visually-hidden">Toggle traits bar</span>
</button>

<style>
  .trait-toggle-btn {
    position: fixed;
    left: 50%; transform: translateX(-50%);
    width: 200px; height: 16px; /* ~15% taller than 14px */
    z-index: 9002;
    /* Semi-transparent dark fill by default */
    background: rgba(0,0,0,0.45);
    color: #e6e6e6;
    border: none; /* no border so only arrow is visible */
    border-radius: 6px;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; line-height: 1;
  }
  .trait-toggle-btn:hover { background: rgba(0,0,0,0.6); }
  .trait-toggle-btn:focus, .trait-toggle-btn:focus-visible { outline: none; box-shadow: none; }
  .glyph {
    display: inline-block;
    /* Slightly dim arrow instead of pure white */
    mix-blend-mode: normal;
    color: rgba(230,230,230,0.9);
    font-size: 12px; /* 1px larger symbol for better legibility */
    pointer-events: none;
  }
  .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
</style>
