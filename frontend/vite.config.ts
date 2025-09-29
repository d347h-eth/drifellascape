import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import sveltePreprocess from "svelte-preprocess";

export default defineConfig({
    plugins: [
        svelte({
            preprocess: sveltePreprocess(),
        }),
    ],
    server: {
        port: 5173,
        strictPort: true,
        host: true,
    },
    preview: {
        host: true,
        port: 4173,
        strictPort: true,
        // Allow requests for production domain(s) when using `vite preview`
        // Set to true to disable host checking entirely (fastest for first deploy)
        allowedHosts: true,
    },
});
