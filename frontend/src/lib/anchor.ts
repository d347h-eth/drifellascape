import { writable, get } from 'svelte/store';

export const anchorArmed = writable(false);
export const lastMint = writable<string | null>(null);

export function arm(mint: string) {
  anchorArmed.set(true);
  lastMint.set(mint);
}

export function disarm() {
  anchorArmed.set(false);
  lastMint.set(null);
}

export function updateFromFocused(mint: string | null) {
  if (mint) {
    anchorArmed.set(true);
    lastMint.set(mint);
  }
}

// Decide which anchor mint to use for a search request.
// inExploreOrGallery: true when user is in Explore or Gallery (not Grid).
export function selectAnchorMint(gridMode: boolean, inExploreOrGallery: boolean, currentMint: string | null): string | undefined {
  if (inExploreOrGallery) return currentMint || undefined;
  if (!gridMode) return currentMint || undefined; // gallery safety
  const armed = get(anchorArmed);
  const last = get(lastMint);
  if (gridMode && armed && last) return last || undefined;
  return undefined;
}

