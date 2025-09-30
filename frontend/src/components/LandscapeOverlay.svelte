<script lang="ts">
  export let visible = false;
  export let onClose: (() => void) | undefined;
</script>

{#if visible}
  <div class="overlay" on:click={() => onClose?.()}>
    <div class="panel" role="dialog" aria-modal="true" on:click|stopPropagation>
      <div class="msg">Rotate your device to landscape</div>
      <div class="sub">Tap anywhere to dismiss</div>
    </div>
  </div>
{/if}

<style>
  .overlay { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.85); z-index: 10000; }
  .panel { text-align: center; color: #e6e6e6; padding: 16px 20px; }
  .msg { font-size: 18px; margin-bottom: 8px; }
  .sub { font-size: 12px; opacity: 0.8; }
</style>

