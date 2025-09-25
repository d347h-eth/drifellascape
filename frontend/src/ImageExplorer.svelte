<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import "leaflet/dist/leaflet.css";

    export let url: string;
    export let onClose: () => void;
    export let onPrev: (() => void) | undefined;
    export let onNext: (() => void) | undefined;
    export let maxZoomFactor: number = 8; // 8x over fit-to-view (one more step from previous)
    // When entering from gallery, keep the gallery visible (no black backdrop)
    // until the full-res image finishes first load. Spinner shows meanwhile.
    export let transparentUntilFirstLoad: boolean = true;

    const IMG_WIDTH = 3125;
    const IMG_HEIGHT = 1327;
    const REGION_HEIGHT = 1007;
    const REGION_TOP_CENTER = (IMG_HEIGHT - REGION_HEIGHT) / 2; // vertically centered region
    const REGION_TOP = REGION_TOP_CENTER + 36; // adjusted placement per visual alignment

    let mapEl: HTMLDivElement | null = null;
    let map: any = null;
    let loading = true;
    let overlay: any = null;
    let currentUrl: string | null = null;
    let imageBounds: any = null;
    let baseZoomByWidth = 0;
    let keyHandlerDown: ((e: KeyboardEvent) => void) | null = null;
    let keyHandlerUp: ((e: KeyboardEvent) => void) | null = null;
    let resizeHandler: (() => void) | null = null;
    let debug = false;
    let debugRect: any = null;
    let firstLoadDone = false;
    let swapToken = 0;

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
        // Keep 1:1 cap for full-image fit (Q/W/E)
        return Math.min(z, 0);
    }

    // Compute zoom to fit a region height exactly to viewport height
    function computeZoomForRegion(regionHeight: number): number {
        if (!map) return 0;
        const size = map.getSize();
        // Exact region fit (no cap); epsilon avoids 1px overflow from rounding.
        return Math.log2(size.y / regionHeight) - 1e-6;
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

    function setViewRegionHeightAt(centerX: number, top: number, height: number, animate: boolean) {
        if (!map) return;
        // Ensure layout is up-to-date before measuring
        map.invalidateSize(false);
        // Compute exact zoom so region height fits viewport height
        const zR = computeZoomForRegion(height);
        // Do not cap to fit-by-width; allow region zoom fully.
        // Provide a generous lower bound so Leaflet doesn't clamp.
        map.setMinZoom(zR - 5);
        map.setMaxZoom(zR + Math.log2(maxZoomFactor));
        const clampedX = Math.max(0, Math.min(IMG_WIDTH, centerX));
        const centerY = Math.max(0, Math.min(IMG_HEIGHT, top + height / 2));
        const center = [centerY as any, clampedX as any];
        map.setView(center as any, zR, { animate });
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
            zoomSnap: 0, // allow arbitrary fractional zoom (no snapping)
            zoomDelta: 0.01,
            zoomAnimation: false,
            doubleClickZoom: false,
            wheelDebounceTime: 0,
            wheelPxPerZoomLevel: 480,
        });
        // Backdrop: keep transparent before first image load (spinner over gallery)
        if (mapEl) {
            mapEl.style.background = transparentUntilFirstLoad ? "transparent" : "#000";
        }
        // Start with hidden overlay; fade in on 'load'
        overlay = L.imageOverlay(url, bounds, { interactive: false, opacity: 0 }).addTo(map);
        overlay.on("load", () => {
            loading = false;
            firstLoadDone = true;
            try { overlay.setOpacity(1); } catch {}
            // After first load, ensure backdrop is solid for subsequent swaps
            if (mapEl) mapEl.style.background = "#000";
        });
        map.invalidateSize(false);
        // Fit-by-width and snap to integer zoom levels
        setViewFitWidthCentered(false);

        keyHandlerDown = (e: KeyboardEvent) => {
            const k = e.key;
            if (k === "Escape") {
                e.preventDefault();
                onClose?.();
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
            if (k === "1") {
                e.preventDefault();
                setViewRegionHeightAt(IMG_WIDTH / 2 - 980, REGION_TOP, REGION_HEIGHT, true);
                return;
            }
            if (k === "2") {
                e.preventDefault();
                setViewRegionHeightAt(IMG_WIDTH / 2, REGION_TOP, REGION_HEIGHT, true);
                return;
            }
            if (k === "3") {
                e.preventDefault();
                setViewRegionHeightAt(IMG_WIDTH / 2 + 980, REGION_TOP, REGION_HEIGHT, true);
                return;
            }
            if (k === "g" || k === "G") {
                e.preventDefault();
                debug = !debug;
                // Reuse on-mount helper to toggle debug rectangle
                updateDebug();
                return;
            }
        };
        keyHandlerUp = (e: KeyboardEvent) => {
            const k = e.key;
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
        window.addEventListener("keydown", keyHandlerDown);
        window.addEventListener("keyup", keyHandlerUp);

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

        // Debug rectangle for region of interest (toggle with 'G')
        const updateDebug = () => {
            if (!map) return;
            if (debug) {
                if (!debugRect) {
                    debugRect = (L as any)
                        .rectangle(
                            (L as any).latLngBounds(
                                [REGION_TOP, 0] as any,
                                [REGION_TOP + REGION_HEIGHT, IMG_WIDTH] as any,
                            ),
                            { color: "#00FFFF", weight: 1, fill: false, interactive: false },
                        )
                        .addTo(map);
                }
            } else if (debugRect) {
                try {
                    debugRect.remove();
                } catch {}
                debugRect = null;
            }
        };
        updateDebug();

    });

    onDestroy(() => {
        if (keyHandlerDown) { window.removeEventListener("keydown", keyHandlerDown); keyHandlerDown = null; }
        if (keyHandlerUp) { window.removeEventListener("keyup", keyHandlerUp); keyHandlerUp = null; }
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
    // For first entry: keep overlay hidden (spinner over gallery) until first load completes.
    // For next/prev: preload the new image first while keeping the current image visible, then swap instantly.
    $: if (overlay && url && url !== currentUrl) {
        loading = true;
        currentUrl = url;
        try {
            if (!firstLoadDone) {
                // Initial entry: overlay starts hidden; swap URL and let on('load') reveal it
                if (map) setViewFitWidthCentered(false);
                overlay.setUrl(url);
            } else {
                // Subsequent swaps: preload image, keep showing current image with spinner, then swap instantly
                const token = ++swapToken;
                const img = new Image();
                // Hint to decode off-main-thread when possible
                try { (img as any).decoding = 'async'; } catch {}
                img.onload = () => {
                    if (token !== swapToken) return; // superseded by a newer navigation
                    try { if (map) setViewFitWidthCentered(false); } catch {}
                    try { overlay.setUrl(url); } catch {}
                    // overlay 'load' handler will clear spinner
                };
                img.onerror = () => {
                    if (token !== swapToken) return;
                    // Fallback: swap immediately if preload fails
                    try { if (map) setViewFitWidthCentered(false); } catch {}
                    try { overlay.setUrl(url); } catch {}
                };
                img.src = url;
            }
        } catch {}
    }

    // Keep backdrop transparent only before the first image is loaded when configured
    $: if (mapEl) {
        const preload = transparentUntilFirstLoad && !firstLoadDone && loading;
        mapEl.style.background = preload ? "transparent" : "#000";
    }
</script>

<style>
    .overlay {
        position: fixed;
        inset: 0;
        z-index: 1000;
        background: #000; /* becomes transparent during initial preload */
    }
    .map {
        position: absolute;
        inset: 0;
    }
    :global(.leaflet-container) {
        background: #000;
    }
    /* While preloading the first image, keep backdrop transparent to reveal gallery */
    .overlay.preload { background: transparent; }
    .overlay.preload :global(.leaflet-container) { background: transparent !important; }
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
        width: 25px;
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

<div class="overlay" class:preload={(transparentUntilFirstLoad && !firstLoadDone && loading)} role="dialog" aria-modal="true">
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
