<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import "leaflet/dist/leaflet.css";

    export let url: string;
    export let onClose: () => void;
    export let onPrev: (() => void) | undefined;
    export let onNext: (() => void) | undefined;
    export let maxZoomFactor: number = 4; // 4x over fit-to-view

    const IMG_WIDTH = 3125;
    const IMG_HEIGHT = 1327;

    let mapEl: HTMLDivElement | null = null;
    let map: any = null;
    let loading = true;
    let overlay: any = null;
    let currentUrl: string | null = null;
    let imageBounds: any = null;
    let baseZoomByWidth = 0;
    let keyHandler: ((e: KeyboardEvent) => void) | null = null;
    let resizeHandler: (() => void) | null = null;

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

    // Compute base zoom so image width fits container width
    function computeBaseZoomByWidth(): number {
        if (!map) return 0;
        const size = map.getSize();
        return Math.log2(size.x / IMG_WIDTH);
    }

    // Compute zoom to fit full image height; cap to 1:1 (<= 0)
    function computeZoomForHeight(): number {
        if (!map) return 0;
        const size = map.getSize();
        const z = Math.log2(size.y / IMG_HEIGHT);
        return Math.min(z, 0);
    }

    function setViewFitWidthCentered(animate: boolean) {
        if (!map) return;
        baseZoomByWidth = computeBaseZoomByWidth();
        map.setMinZoom(baseZoomByWidth);
        map.setMaxZoom(baseZoomByWidth + Math.log2(maxZoomFactor));
        const center = [(IMG_HEIGHT / 2) as any, (IMG_WIDTH / 2) as any];
        map.setView(center as any, baseZoomByWidth, { animate });
    }

    function setViewFitHeightAt(centerX: number, animate: boolean) {
        if (!map) return;
        const zH = computeZoomForHeight();
        const minZ = Math.min(baseZoomByWidth, zH);
        map.setMinZoom(minZ);
        map.setMaxZoom(minZ + Math.log2(maxZoomFactor));
        const clampedX = Math.max(0, Math.min(IMG_WIDTH, centerX));
        const center = [(IMG_HEIGHT / 2) as any, clampedX as any];
        map.setView(center as any, zH, { animate });
    }

    onMount(async () => {
        lockScroll(true);
        const L = await import("leaflet");
        if (!mapEl) return;

        // Known image dimensions; can be made dynamic later
        const imgWidth = IMG_WIDTH;
        const imgHeight = IMG_HEIGHT;
        const southWest: [number, number] = [0, 0];
        const northEast: [number, number] = [imgHeight, imgWidth];
        const bounds = (L as any).latLngBounds(southWest as any, northEast as any);
        imageBounds = bounds;

        map = L.map(mapEl, {
            crs: L.CRS.Simple,
            zoomControl: false,
            attributionControl: false,
            zoomSnap: 0.1,
            zoomAnimation: false,
            doubleClickZoom: false,
            wheelDebounceTime: 0,
            wheelPxPerZoomLevel: 120,
        });
        if (mapEl) {
            mapEl.style.background = "#000";
        }
        overlay = L.imageOverlay(url, bounds, { interactive: false }).addTo(map);
        overlay.on("load", () => {
            loading = false;
            try { overlay.setOpacity(1); } catch {}
        });
        map.invalidateSize(false);
        // Fit-by-width base zoom computation
        const size = map.getSize();
        baseZoomByWidth = Math.log2(size.x / IMG_WIDTH);
        map.setMinZoom(baseZoomByWidth);
        const extra = Math.log2(maxZoomFactor);
        map.setMaxZoom(baseZoomByWidth + extra);
        const center = [(IMG_HEIGHT / 2) as any, (IMG_WIDTH / 2) as any];
        map.setView(center as any, baseZoomByWidth, { animate: false });

        keyHandler = (e: KeyboardEvent) => {
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
            if (k === "s" || k === "S") {
                e.preventDefault();
                setViewFitWidthCentered(true);
                return;
            }
            if (k === "w" || k === "W") {
                e.preventDefault();
                setViewFitHeightAt(IMG_WIDTH / 2, true);
                return;
            }
            if (k === "q" || k === "Q") {
                e.preventDefault();
                setViewFitHeightAt(IMG_WIDTH / 2 - 980, true);
                return;
            }
            if (k === "e" || k === "E") {
                e.preventDefault();
                setViewFitHeightAt(IMG_WIDTH / 2 + 980, true);
                return;
            }
        };
        window.addEventListener("keydown", keyHandler);

        resizeHandler = () => {
            if (!map) return;
            map.invalidateSize(false);
            baseZoomByWidth = computeBaseZoomByWidth();
            map.setMinZoom(baseZoomByWidth);
            map.setMaxZoom(baseZoomByWidth + Math.log2(maxZoomFactor));
        };
        window.addEventListener("resize", resizeHandler);

        // Double-click resets to centered fit-by-width
        map.on("dblclick", () => setViewFitWidthCentered(true));

    });

    onDestroy(() => {
        if (keyHandler) {
            window.removeEventListener("keydown", keyHandler);
            keyHandler = null;
        }
        if (resizeHandler) {
            window.removeEventListener("resize", resizeHandler);
            resizeHandler = null;
        }
        try {
            map?.remove?.();
        } catch {}
        map = null;
        lockScroll(false);
    });

    // Swap image URL when prop changes; reset to fit-by-width centered.
    // To avoid flicker, hide current overlay (opacity 0) before repositioning and swapping URL.
    $: if (overlay && url && url !== currentUrl) {
        loading = true;
        currentUrl = url;
        try {
            if (map) setViewFitWidthCentered(false);
            try { overlay.setOpacity(0); } catch {}
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
    /* Prefer sharp sampling to reduce blur during scaling */
    :global(.leaflet-image-layer) {
        image-rendering: -webkit-optimize-contrast; /* Chrome */
        image-rendering: crisp-edges;               /* Firefox */
        image-rendering: pixelated;                 /* Fallback */
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
        z-index: 1003;
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
    .edge:focus {
        outline: none;
        box-shadow: none;
    }
    .edge-left {
        left: 0;
        cursor: w-resize;
    }
    .edge-right {
        right: 0;
        top: 56px; /* don't overlap close button area */
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
            tabindex="-1"
            on:mousedown|preventDefault
            on:click={() => onPrev?.()}
        />
    {/if}
    {#if onNext}
        <button
            class="edge edge-right"
            aria-label="Next"
            title="Next (→ / D)"
            tabindex="-1"
            on:mousedown|preventDefault
            on:click={() => onNext?.()}
        />
    {/if}
    {#if loading}
        <div class="spinner" aria-live="polite" aria-busy="true" title="Loading" />
    {/if}
    <!-- Future: hotkeys and next/prev navigation -->
</div>
