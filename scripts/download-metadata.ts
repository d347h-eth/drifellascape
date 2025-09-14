import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as https from "node:https";

const BASE_URL =
    "https://lime-given-booby-462.mypinata.cloud/ipfs/bafybeihvgvggho4jvvmikybbil4ylylabztxhyn6sczi5w2kvzejcozu2a/{id}";
const START_ID = 0;
const END_ID = 1332; // inclusive

const METADATA_DIR = path.resolve(process.cwd(), "metadata");
const LOGS_DIR = path.resolve(process.cwd(), "logs");
const LOG_FILE = path.join(LOGS_DIR, "metadata-download.log");

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000; // 2 seconds
const REQUEST_THROTTLE_MS = 1000; // at most 1 request per second

let lastRequestAt = 0;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureDirs() {
    await fs.mkdir(METADATA_DIR, { recursive: true });
    await fs.mkdir(LOGS_DIR, { recursive: true });
}

async function logError(message: string) {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    try {
        await fs.appendFile(LOG_FILE, line, "utf8");
    } catch (e) {
        // As a fallback, print to stderr if logging fails
        process.stderr.write(`Failed to write log: ${String(e)}\n`);
        process.stderr.write(line);
    }
}

async function throttle() {
    const now = Date.now();
    const elapsed = now - lastRequestAt;
    if (elapsed < REQUEST_THROTTLE_MS) {
        await sleep(REQUEST_THROTTLE_MS - elapsed);
    }
}

function httpGet(url: string, timeoutMs = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = https.get(
            url,
            { timeout: timeoutMs, headers: { Accept: "application/json" } },
            (res) => {
                const { statusCode } = res;
                const chunks: Buffer[] = [];
                res.on("data", (chunk) =>
                    chunks.push(
                        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
                    ),
                );
                res.on("end", () => {
                    const body = Buffer.concat(chunks).toString("utf8");
                    if (statusCode && statusCode >= 200 && statusCode < 300) {
                        resolve(body);
                    } else {
                        const sc = statusCode ?? 0;
                        reject(new Error(`HTTP ${sc} - ${body.slice(0, 200)}`));
                    }
                });
            },
        );

        req.on("timeout", () => {
            req.destroy(new Error("Request timed out"));
        });

        req.on("error", (err) => {
            reject(err);
        });
    });
}

function buildUrl(id: number): string {
    return BASE_URL.replace("{id}", String(id));
}

async function fetchWithRetry(id: number): Promise<string> {
    let attempt = 0;
    let backoff = INITIAL_BACKOFF_MS;
    while (attempt < MAX_RETRIES) {
        attempt += 1;
        await throttle();
        lastRequestAt = Date.now();
        try {
            const url = buildUrl(id);
            return await httpGet(url);
        } catch (err) {
            const msg = `Error fetching id=${id} attempt=${attempt}: ${String((err as Error)?.message || err)}`;
            await logError(msg);
            if (attempt >= MAX_RETRIES) {
                throw err;
            }
            await sleep(backoff);
            backoff *= 2; // exponential backoff
        }
    }
    throw new Error(`Unreachable: exceeded retries for id=${id}`);
}

async function main() {
    await ensureDirs();
    let successCount = 0;
    let failCount = 0;

    for (let id = START_ID; id <= END_ID; id++) {
        const outPath = path.join(METADATA_DIR, `${id}.json`);
        process.stdout.write(
            `Downloading ${id} -> ${path.relative(process.cwd(), outPath)}\n`,
        );
        try {
            const body = await fetchWithRetry(id);
            // Optionally validate it's JSON
            try {
                JSON.parse(body);
            } catch (e) {
                await logError(
                    `Non-JSON response for id=${id}: ${(e as Error).message}`,
                );
            }
            await fs.writeFile(outPath, body, "utf8");
            successCount += 1;
        } catch (err) {
            await logError(
                `Failed to download id=${id} after ${MAX_RETRIES} attempts: ${String((err as Error)?.message || err)}`,
            );
            failCount += 1;
        }
    }

    process.stdout.write(
        `Done. Success: ${successCount}, Failed: ${failCount}\n`,
    );
}

// Run if invoked directly
main().catch(async (err) => {
    await logError(`Fatal error: ${String(err?.message || err)}`);
    process.stderr.write(`Fatal error: ${String(err?.message || err)}\n`);
    process.exit(1);
});
