import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { initializeDatabase } from "@drifellascape/database";
import { ListingsCache } from "./cache.js";
import type { ListingRow } from "./types.js";

function getEnvPort(): number {
    const raw = process.env.PORT;
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : 3000;
}

function parseQuery(url: string): URLSearchParams {
    const u = new URL(url, "http://localhost");
    return u.searchParams;
}

function sendJson(res: ServerResponse, status: number, body: any) {
    const json = JSON.stringify(body);
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("access-control-allow-origin", "*");
    res.end(json);
}

function sortListings(items: ListingRow[], sort: string): ListingRow[] {
    if (sort === "price_desc") {
        return [...items].sort((a, b) => b.price - a.price);
    }
    // default asc
    return [...items].sort((a, b) => a.price - b.price);
}

function clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
}

const cache = new ListingsCache();

async function handleListings(req: IncomingMessage, res: ServerResponse) {
    try {
        const snap = await cache.ensureLoaded();
        const params = parseQuery(req.url || "/listings");
        const sort = (params.get("sort") || "price_asc").toLowerCase();
        const offset = clamp(Number(params.get("offset")) || 0, 0, 1000000);
        const limit = clamp(Number(params.get("limit")) || 100, 1, 200);

        const sorted = sortListings(snap.items, sort);
        const slice = sorted.slice(offset, offset + limit);
        sendJson(res, 200, {
            versionId: snap.versionId,
            total: sorted.length,
            offset,
            limit,
            sort,
            items: slice,
        });
    } catch (e: any) {
        sendJson(res, 500, { error: String(e?.message || e) });
    }
}

function route(req: IncomingMessage, res: ServerResponse) {
    const url = req.url || "/";
    if (req.method === "GET" && url.startsWith("/listings"))
        return void handleListings(req, res);
    // minimal not-found
    sendJson(res, 404, { error: "Not found" });
}

async function startRefreshLoop() {
    const interval = Number(process.env.BACKEND_REFRESH_MS || 30000);
    // Priming load
    await cache.ensureLoaded().catch(() => {});
    setInterval(
        () => {
            cache.refreshIfChanged().catch(() => {});
        },
        Math.max(5000, interval),
    );
}

export async function startServer() {
    // Initialize DB and run migrations once at startup
    await initializeDatabase();
    await startRefreshLoop();
    const port = getEnvPort();
    const server = createServer(route);
    server.listen(port, () => {
        // eslint-disable-next-line no-console
        console.log(`Backend listening on http://localhost:${port}`);
    });
}

// Run if invoked directly
if (import.meta.url === `file://${process.argv[1]}`) {
    startServer().catch((err) => {
        // eslint-disable-next-line no-console
        console.error("Backend failed to start:", err);
        process.exit(1);
    });
}
