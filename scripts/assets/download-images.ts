import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as http from "node:http";
import * as https from "node:https";

const CSV_FILE = path.resolve(process.cwd(), "logs", "mint_to_image-page2.csv");
const OUTPUT_DIR = path.resolve(process.cwd(), "static", "full");
const LOGS_DIR = path.resolve(process.cwd(), "logs");
const LOG_FILE = path.join(LOGS_DIR, "image-download.log");

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000; // 2 seconds
const REQUEST_THROTTLE_MS = 1000; // at most 1 request per second
const MAX_REDIRECTS = 5;

let lastRequestAt = 0;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureDirs() {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await fs.mkdir(LOGS_DIR, { recursive: true });
}

async function logError(message: string) {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    try {
        await fs.appendFile(LOG_FILE, line, "utf8");
    } catch (e) {
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

function chooseHttpModule(protocol: string) {
    if (protocol === "http:") return http;
    if (protocol === "https:") return https;
    throw new Error(`Unsupported protocol: ${protocol}`);
}

function httpGetBuffer(
    urlStr: string,
    timeoutMs = 30000,
    redirects = 0,
): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        let urlObj: URL;
        try {
            urlObj = new URL(urlStr);
        } catch (e) {
            reject(new Error(`Invalid URL: ${urlStr}`));
            return;
        }
        const mod = chooseHttpModule(urlObj.protocol);
        const req = mod.get(
            urlObj,
            {
                timeout: timeoutMs,
                headers: {
                    Accept: "image/*,application/octet-stream;q=0.9,*/*;q=0.8",
                    "User-Agent": "drifella-explorer-image-downloader/1.0",
                },
            },
            (res) => {
                const { statusCode, headers } = res;
                const chunks: Buffer[] = [];
                // Handle redirects
                if (
                    statusCode &&
                    statusCode >= 300 &&
                    statusCode < 400 &&
                    headers.location
                ) {
                    res.resume();
                    if (redirects >= MAX_REDIRECTS) {
                        reject(new Error(`Too many redirects for ${urlStr}`));
                        return;
                    }
                    const nextUrl = new URL(
                        headers.location,
                        urlObj,
                    ).toString();
                    httpGetBuffer(nextUrl, timeoutMs, redirects + 1).then(
                        resolve,
                        reject,
                    );
                    return;
                }
                res.on("data", (chunk) =>
                    chunks.push(
                        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
                    ),
                );
                res.on("end", () => {
                    if (statusCode && statusCode >= 200 && statusCode < 300) {
                        resolve(Buffer.concat(chunks));
                    } else {
                        const sc = statusCode ?? 0;
                        const preview = Buffer.concat(chunks)
                            .toString("utf8")
                            .slice(0, 200);
                        reject(new Error(`HTTP ${sc} - ${preview}`));
                    }
                });
            },
        );
        req.on("timeout", () => {
            req.destroy(new Error("Request timed out"));
        });
        req.on("error", (err) => reject(err));
    });
}

async function fetchImageWithRetry(url: string): Promise<Buffer> {
    let attempt = 0;
    let backoff = INITIAL_BACKOFF_MS;
    while (attempt < MAX_RETRIES) {
        attempt += 1;
        await throttle();
        lastRequestAt = Date.now();
        try {
            return await httpGetBuffer(url);
        } catch (err) {
            const msg = `Error fetching url=${url} attempt=${attempt}: ${String((err as Error)?.message || err)}`;
            await logError(msg);
            if (attempt >= MAX_RETRIES) {
                throw err;
            }
            await sleep(backoff);
            backoff *= 2; // exponential backoff
        }
    }
    throw new Error(`Unreachable: exceeded retries for url=${url}`);
}

function parseCsv(content: string): Array<Record<string, string>> {
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return [];

    const header = parseCsvLine(lines[0]);
    const rows: Array<Record<string, string>> = [];
    for (let i = 1; i < lines.length; i++) {
        const fields = parseCsvLine(lines[i]);
        const row: Record<string, string> = {};
        for (let j = 0; j < header.length; j++) {
            row[header[j]] = fields[j] ?? "";
        }
        rows.push(row);
    }
    return rows;
}

function parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (inQuotes) {
            if (char === '"') {
                if (i + 1 < line.length && line[i + 1] === '"') {
                    current += '"';
                    i += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                current += char;
            }
        } else {
            if (char === ",") {
                result.push(current);
                current = "";
            } else if (char === '"') {
                inQuotes = true;
            } else {
                current += char;
            }
        }
    }
    result.push(current);
    return result.map((s) => s.trim());
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function main() {
    await ensureDirs();

    const csvContent = await fs.readFile(CSV_FILE, "utf8");
    const rows = parseCsv(csvContent);

    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;

    for (const row of rows) {
        const tokenMintAddr = (
            row["token_mint_addr"] ||
            row["mint"] ||
            row["token"] ||
            ""
        ).trim();
        const imageUrl = (
            row["image_url"] ||
            row["image"] ||
            row["url"] ||
            ""
        ).trim();
        if (!tokenMintAddr || !imageUrl) {
            await logError(
                `Skipping row with missing data: ${JSON.stringify(row)}`,
            );
            continue;
        }

        const outPath = path.join(OUTPUT_DIR, `${tokenMintAddr}.png`);
        const outRel = path.relative(process.cwd(), outPath);

        if (await fileExists(outPath)) {
            process.stdout.write(`Exists, skipping: ${outRel}\n`);
            skipCount += 1;
            continue;
        }

        process.stdout.write(`Downloading ${imageUrl} -> ${outRel}\n`);
        try {
            const buffer = await fetchImageWithRetry(imageUrl);
            await fs.writeFile(outPath, buffer);
            successCount += 1;
        } catch (err) {
            await logError(
                `Failed to download ${imageUrl} -> ${outRel} after ${MAX_RETRIES} attempts: ${String((err as Error)?.message || err)}`,
            );
            failCount += 1;
        }
    }

    process.stdout.write(
        `Done. Success: ${successCount}, Skipped: ${skipCount}, Failed: ${failCount}\n`,
    );
}

main().catch(async (err) => {
    await logError(`Fatal error: ${String(err?.message || err)}`);
    process.stderr.write(`Fatal error: ${String(err?.message || err)}\n`);
    process.exit(1);
});
