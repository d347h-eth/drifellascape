import { tick } from 'svelte';

// Preserve the viewport position when prepending items to a vertical list/grid.
// It measures the top of the anchor element before and after the update and scrolls by the delta.
export async function preserveTopAnchor(anchorMint: string | null, update: () => void | Promise<void>) {
  if (!anchorMint) {
    await update();
    return;
  }
  const id = `cell-${anchorMint}`;
  const beforeTop = document.getElementById(id)?.getBoundingClientRect()?.top ?? 0;
  await update();
  await tick();
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  const afterTop = document.getElementById(id)?.getBoundingClientRect()?.top ?? 0;
  const delta = afterTop - beforeTop;
  if (Math.abs(delta) > 1) window.scrollBy(0, delta);
}

