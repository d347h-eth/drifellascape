<script lang="ts">
  export let show = false;
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();
  export let galleryMode: boolean = true; // when false (Grid/Explore), bar is flush with bottom
  // Place near bottom-left corner; position above main status bar (28px height)
  $: bottom = (galleryMode ? 15 : 0) + 28;
</script>

<button
  type="button"
  class="trait-toggle-btn {show ? 'open' : ''}"
  title="Toggle traits bar"
  style={`bottom: ${bottom}px; left: 12px;`}
  on:click={() => dispatch('toggle')}
>
  <span class="glyph">{#if show}✕{:else}☰{/if}</span>
  <span class="visually-hidden">Toggle traits bar</span>
</button>

<style>
  .trait-toggle-btn {
    position: fixed;
    left: 12px;
    width: 50px; height: 50px; /* match next-page button size */
    z-index: 9002;
    /* Match trait bar fill color */
    background: rgba(0,0,0,0.6);
    color: #e6e6e6;
    border: none;
    border-radius: 0; /* flat corners in all states */
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; line-height: 1;
  }
  .trait-toggle-btn.open { border-radius: 0; }
  .trait-toggle-btn:hover { background: rgba(0,0,0,0.75); }
  .trait-toggle-btn:focus, .trait-toggle-btn:focus-visible { outline: none; box-shadow: none; }
  .glyph {
    display: inline-block;
    /* Slightly dim glyph instead of pure white */
    mix-blend-mode: normal;
    color: rgba(230,230,230,0.9);
    font-size: 12px;
    pointer-events: none;
  }
  .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
</style>
