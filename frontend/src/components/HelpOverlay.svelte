<script lang="ts">
  export let visible = false;
  export let onClose: (() => void) | undefined;
</script>

{#if visible}
  <div class="help-backdrop" on:click={() => onClose?.()}>
    <div class="help-panel" role="dialog" aria-modal="true" on:click|stopPropagation>
      <h2>Keyboard Shortcuts</h2>
      <div class="status" style="padding:0 0 8px; opacity:0.75;">Press <span class="kbd">H</span> or <span class="kbd">F1</span> to close</div>

      <h3>Gallery (Horizontal Scroll)</h3>
      <ul>
        <li>Previous/Next image — <span class="kbd">←</span>/<span class="kbd">→</span> or <span class="kbd">A</span>/<span class="kbd">D</span></li>
        <li>Focus current — <span class="kbd">F</span></li>
        <li>Enter exploration — <span class="kbd">W</span></li>
        <li>Enter grid view — <span class="kbd">G</span> or <span class="kbd">Esc</span></li>
        <li>Toggle data source (Listings/Tokens) — <span class="kbd">T</span></li>
        <li>Toggle motion — <span class="kbd">M</span></li>
        <li>Toggle trait bar — <span class="kbd">V</span></li>
        <li>Purpose class (left/right) — <span class="kbd">Z</span> / <span class="kbd">C</span></li>
        <li>Next trait page (wrap) — <span class="kbd">X</span></li>
        <li>Jump to first/last — <span class="kbd">Home</span> / <span class="kbd">End</span></li>
        <li>Horizontal travel — mouse wheel; Click screen edges to prev/next</li>
        <li>Toggle help — <span class="kbd">H</span> / <span class="kbd">F1</span></li>
      </ul>

      <h3>Exploration Mode</h3>
      <ul>
        <li>Previous/Next — <span class="kbd">←</span>/<span class="kbd">→</span> or <span class="kbd">A</span>/<span class="kbd">D</span></li>
        <li>Close exploration — <span class="kbd">Esc</span></li>
        <li>Fit‑by‑width centered — <span class="kbd">S</span></li>
        <li>Fit entire height (middle/left/right) — <span class="kbd">W</span>/<span class="kbd">Q</span>/<span class="kbd">E</span></li>
        <li>Fit 1006px band (left/middle/right) — <span class="kbd">1</span>/<span class="kbd">2</span>/<span class="kbd">3</span></li>
        <li>Reset to fit‑by‑width — Double‑click</li>
        <li>Toggle debug overlay — <span class="kbd">O</span></li>
      </ul>
    </div>
  </div>
{/if}

<style>
  .help-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
  }
  .help-panel {
    background: rgba(12,12,14,0.98);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    width: min(90vw, 820px);
    max-height: 80vh;
    overflow: auto;
    padding: 16px 20px;
    color: #e6e6e6;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  }
  .help-panel h2 { margin: 6px 0 8px; font-size: 18px; }
  .help-panel h3 { margin: 12px 0 6px; font-size: 15px; opacity: 0.9; }
  .help-panel ul { margin: 6px 0 10px 18px; padding: 0; }
  .help-panel li { margin: 4px 0; }
  .kbd { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; background: #1b1b1d; border: 1px solid rgba(255,255,255,0.12); border-radius: 4px; padding: 1px 6px; }
</style>
