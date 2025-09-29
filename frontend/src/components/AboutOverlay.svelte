<script lang="ts">
  export let visible = false;
  export let onClose: (() => void) | undefined;
</script>

{#if visible}
  <div class="about-backdrop" on:click={() => onClose?.()}>
    <div class="about-panel" role="dialog" aria-modal="true" on:click|stopPropagation>
      <button type="button" class="close" aria-label="Close" title="Close" on:click={() => onClose?.()}>✕</button>
      <h2>About</h2>
      <div class="content">
        <p>
          Drifella III is artwork by <a href="https://x.com/bis__cut" target="_blank" rel="noopener noreferrer">evil biscuit</a>.
        </p>
        <p>
          This website is a fan-made project by <a href="https://x.com/d347h_eth" target="_blank" rel="noopener noreferrer">d347h.eth</a>, released as copyleft FOSS under the AGPL license. The source code is available on <a href="https://github.com/d347h-eth/drifellascape" target="_blank" rel="noopener noreferrer">GitHub</a>.
        </p>
      </div>
    </div>
  </div>
{/if}

<style>
  .about-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
  }
  .about-panel {
    position: relative;
    background: rgba(12,12,14,0.98);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    width: min(90vw, 720px);
    max-height: 70vh;
    overflow: auto;
    padding: 16px 20px;
    color: #e6e6e6;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  }
  h2 { margin: 6px 0 10px; font-size: 18px; }
  .content p { margin: 10px 0; }
  a { color: #a8dbff; text-decoration: underline; }
  a:visited { color: #a8dbff; }
  .close {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 6px;
    background: rgba(0,0,0,0.35);
    color: #fff;
    cursor: pointer;
  }
  .close:hover { background: rgba(255,255,255,0.08); }
</style>

