import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { initializeDatabase } from "@drifellascape/database";
import { ListingsCache } from "./cache.js";
import type {
    ListingRow,
    ListingsSearchBody,
    TraitFilterGroup,
} from "./types.js";
import {
    searchListingsByTraits,
    searchListingsByValues,
    attachTraits,
} from "./repo.js";

function getEnvPort(): number {
    const raw = process.env.DRIFELLASCAPE_PORT;
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
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
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

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(Buffer.from(c)));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}

function sanitizeIds(arr: any): number[] {
    if (!Array.isArray(arr)) return [];
    const out: number[] = [];
    for (const v of arr) {
        const n = Number(v);
        if (Number.isFinite(n)) out.push(n);
    }
    return Array.from(new Set(out));
}

function sanitizeGroups(arr: any): TraitFilterGroup[] {
    if (!Array.isArray(arr)) return [];
    const out: TraitFilterGroup[] = [];
    for (const g of arr) {
        const typeId = Number(g?.typeId);
        const valueIds = sanitizeIds(g?.valueIds);
        if (Number.isFinite(typeId) && valueIds.length > 0)
            out.push({ typeId, valueIds });
    }
    return out;
}

async function handleListingsSearch(req: IncomingMessage, res: ServerResponse) {
    try {
        const raw = await readBody(req);
        let body: ListingsSearchBody;
        try {
            body = raw ? (JSON.parse(raw) as ListingsSearchBody) : ({} as any);
        } catch {
            return sendJson(res, 400, { error: "Invalid JSON" });
        }
        const sort = (body.sort || "price_asc").toLowerCase();
        const offset = clamp(Number(body.offset) || 0, 0, 1_000_000);
        const limit = clamp(Number(body.limit) || 100, 1, 200);
        const mode = (body.mode || "value").toLowerCase();
        const includeTraits = body.includeTraits !== false; // default true

        if (mode === "trait") {
            const groups = sanitizeGroups(body.traits);
            const { versionId, total, items } = searchListingsByTraits(
                groups,
                sort,
                offset,
                limit,
            );
            const enriched = includeTraits ? attachTraits(items) : items;
            return sendJson(res, 200, {
                versionId,
                total,
                offset,
                limit,
                sort,
                items: enriched,
            });
        }
        // default: value-based
        const valueIds = sanitizeIds(body.valueIds);
        const { versionId, total, items } = searchListingsByValues(
            valueIds,
            sort,
            offset,
            limit,
        );
        const enriched = includeTraits ? attachTraits(items) : items;
        return sendJson(res, 200, {
            versionId,
            total,
            offset,
            limit,
            sort,
            items: enriched,
        });
    } catch (e: any) {
        return sendJson(res, 500, { error: String(e?.message || e) });
    }
}

function route(req: IncomingMessage, res: ServerResponse) {
    const url = req.url || "/";
    if (req.method === "OPTIONS") return void sendJson(res, 204, {});
    if (req.method === "GET" && url.startsWith("/listings"))
        return void handleListings(req, res);
    if (req.method === "POST" && url.startsWith("/listings/search"))
        return void handleListingsSearch(req, res);
    // minimal not-found
    sendJson(res, 404, { error: "Not found" });
}

async function startRefreshLoop() {
    const interval = Number(
        process.env.DRIFELLASCAPE_BACKEND_REFRESH_MS || 30000,
    );
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
