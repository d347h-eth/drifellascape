import { writable } from "svelte/store";

export const showHelp = writable(false);
export const showTraitBar = writable(false);
export const motionEnabled = writable(true);
export const activeIndex = writable(0);

