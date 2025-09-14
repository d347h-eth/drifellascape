<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import "leaflet/dist/leaflet.css";

    export let url: string;
    export let onClose: () => void;
    export let onPrev: (() => void) | undefined;
    export let onNext: (() => void) | undefined;
    export let maxZoomFactor: number = 4; // 4x over fit-to-view

    let mapEl: HTMLDivElement | null = null;
    let map: any = null;
    let loading = true;
    let overlay: any = null;
    let currentUrl: string | null = null;

    function lockScroll(lock: boolean) {
        if (typeof document === "undefined") return;
        if (lock) {
            const prev = document.body.style.overflow;
            document.body.setAttribute("data-prev-overflow", prev);
            document.body.style.overflow = "hidden";
        } else {
            const prev = document.body.getAttribute("data-prev-overflow") || "";
            document.body.style.overflow = prev;
            document.body.removeAttribute("data-prev-overflow");
        }
    }

    onMount(async () => {
        lockScroll(true);
        const L = await import("leaflet");
        if (!mapEl) return;

        // Known image dimensions; can be made dynamic later
        const imgWidth = 3125;
        const imgHeight = 1327;
        const southWest: [number, number] = [0, 0];
        const northEast: [number, number] = [imgHeight, imgWidth];
        const bounds = [southWest, northEast] as unknown as any;

        map = L.map(mapEl, {
            crs: L.CRS.Simple,
            zoomControl: false,
            attributionControl: false,
            zoomSnap: 0.1,
            wheelDebounceTime: 20,
            wheelPxPerZoomLevel: 120,
        });
        if (mapEl) {
            mapEl.style.background = "#000";
        }
        overlay = L.imageOverlay(url, bounds, { interactive: false }).addTo(map);
        overlay.on("load", () => {
            loading = false;
        });
        const baseZoom = map.getBoundsZoom(bounds, true);
        map.setMinZoom(baseZoom);
        const extra = Math.log2(maxZoomFactor);
        map.setMaxZoom(baseZoom + extra);
        map.fitBounds(bounds);

        const onKey = (e: KeyboardEvent) => {
            const k = e.key;
            if (k === "Escape") {
                e.preventDefault();
                onClose?.();
                return;
            }
            if (k === "ArrowLeft" || k === "a" || k === "A") {
                e.preventDefault();
                onPrev?.();
                return;
            }
            if (k === "ArrowRight" || k === "d" || k === "D") {
                e.preventDefault();
                onNext?.();
                return;
            }
        };
        window.addEventListener("keydown", onKey);

        const onResize = () => {
            map?.invalidateSize();
        };
        window.addEventListener("resize", onResize);

        onDestroy(() => {
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("resize", onResize);
        });
    });

    onDestroy(() => {
        try {
            map?.remove?.();
        } catch {}
        map = null;
        lockScroll(false);
    });

    // Swap image URL when prop changes; keep zoom/center
    $: if (overlay && url && url !== currentUrl) {
        loading = true;
        currentUrl = url;
        try {
            overlay.setUrl(url);
        } catch {}
    }
</script>

<style>
    .overlay {
        position: fixed;
        inset: 0;
        z-index: 1000;
        background: #000; /* pure full-screen canvas */
    }
    .map {
        position: absolute;
        inset: 0;
    }
    :global(.leaflet-container) {
        background: #000;
    }
    .close {
        position: absolute;
        top: 12px;
        right: 12px;
        width: 32px;
        height: 32px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 6px;
        background: rgba(0, 0, 0, 0.4);
        color: #fff;
        cursor: pointer;
        z-index: 1001;
        user-select: none;
    }
    .close:hover {
        background: rgba(255, 255, 255, 0.1);
    }
    .edge {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 12%;
        background: transparent;
        border: 0;
        padding: 0;
        margin: 0;
        z-index: 1001;
        opacity: 0;
        transition: opacity 0.15s ease-in-out, background-color 0.15s ease-in-out;
    }
    .edge:focus-visible {
        opacity: 1;
    }
    .edge-left {
        left: 0;
        cursor: w-resize;
    }
    .edge-right {
        right: 0;
        cursor: e-resize;
    }
    .edge-left:hover {
        opacity: 1;
        background: linear-gradient(to right, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0));
    }
    .edge-right:hover {
        opacity: 1;
        background: linear-gradient(to left, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0));
    }
    .spinner {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 48px;
        height: 48px;
        margin-left: -24px;
        margin-top: -24px;
        border: 3px solid rgba(255, 255, 255, 0.25);
        border-top-color: #fff;
        border-radius: 50%;
        animation: spin 0.9s linear infinite;
        z-index: 1002;
    }
    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }
</style>

<div class="overlay" role="dialog" aria-modal="true">
    <div bind:this={mapEl} class="map" />
    <button class="close" title="Close (Esc)" on:click={() => onClose?.()}>✕</button>
    {#if onPrev}
        <button
            class="edge edge-left"
            aria-label="Previous"
            title="Previous (← / A)"
            on:click={() => onPrev?.()}
        />
    {/if}
    {#if onNext}
        <button
            class="edge edge-right"
            aria-label="Next"
            title="Next (→ / D)"
            on:click={() => onNext?.()}
        />
    {/if}
    {#if loading}
        <div class="spinner" aria-live="polite" aria-busy="true" title="Loading" />
    {/if}
    <!-- Future: hotkeys and next/prev navigation -->
</div>
