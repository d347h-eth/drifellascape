import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const SOURCE_DIR = path.resolve(process.cwd(), "static", "full");

// Mode selection: 'width' resizes by width to 2560px; 'height' resizes by height to 540px.
// Adjust either constant below as needed; keep it simple and hard-coded per request.
const MODE: "width" | "height" = "height"; // change to "width" to produce 2560px-wide images
const TARGET_WIDTH_PX = 2560;
const TARGET_HEIGHT_PX = 540;

const TARGET_DIR = path.resolve(
    process.cwd(),
    "static",
    MODE === "width" ? "2560" : "540h",
);
const MAX_CONCURRENCY = 4;

async function ensureDirectoryExists(directoryPath: string): Promise<void> {
    await fs.mkdir(directoryPath, { recursive: true });
}

async function listPngFilesInDirectory(
    directoryPath: string,
): Promise<string[]> {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    return entries
        .filter(
            (entry) =>
                entry.isFile() &&
                path.extname(entry.name).toLowerCase() === ".png",
        )
        .map((entry) => path.join(directoryPath, entry.name));
}

function deriveTargetPathFromSource(sourceFilePath: string): string {
    const relativePath = path.relative(SOURCE_DIR, sourceFilePath);
    const dirname = path.dirname(relativePath);
    const basenameWithoutExt = path.basename(
        relativePath,
        path.extname(relativePath),
    );
    const targetDir = path.join(TARGET_DIR, dirname);
    const targetFilename = `${basenameWithoutExt}.jpg`;
    return path.join(targetDir, targetFilename);
}

async function convertPngToJpegResized(sourceFilePath: string): Promise<void> {
    const targetFilePath = deriveTargetPathFromSource(sourceFilePath);
    await ensureDirectoryExists(path.dirname(targetFilePath));

    const image = sharp(sourceFilePath, { failOn: "warning" });

    await image
        .resize({
            width: MODE === "width" ? TARGET_WIDTH_PX : undefined,
            height: MODE === "height" ? TARGET_HEIGHT_PX : undefined,
            fit: "inside",
            withoutEnlargement: true,
            kernel: sharp.kernel.lanczos3,
        })
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .jpeg({
            quality: 80,
            progressive: true,
            chromaSubsampling: "4:2:0",
            mozjpeg: false,
        })
        .toFile(targetFilePath);
}

async function runWithConcurrency<T>(
    items: T[],
    worker: (item: T, index: number) => Promise<void>,
    concurrency: number,
): Promise<void> {
    let currentIndex = 0;
    let active = 0;
    return new Promise((resolve, reject) => {
        const launchNext = (): void => {
            if (currentIndex >= items.length && active === 0) {
                resolve();
                return;
            }
            while (active < concurrency && currentIndex < items.length) {
                const myIndex = currentIndex++;
                active++;
                worker(items[myIndex], myIndex)
                    .then(() => {
                        active--;
                        launchNext();
                    })
                    .catch((error) => {
                        reject(error);
                    });
            }
        };
        launchNext();
    });
}

async function main(): Promise<void> {
    const startTimeMs = Date.now();
    await ensureDirectoryExists(TARGET_DIR);

    const pngFiles = await listPngFilesInDirectory(SOURCE_DIR);
    if (pngFiles.length === 0) {
        console.log(`No PNG files found in ${SOURCE_DIR}`);
        return;
    }
    console.log(
        `Found ${pngFiles.length} PNG file(s). Starting conversion to ${
            MODE === "width"
                ? `${TARGET_WIDTH_PX}px width`
                : `${TARGET_HEIGHT_PX}px height`
        } JPEG...`,
    );

    let processedCount = 0;
    await runWithConcurrency(
        pngFiles,
        async (sourceFilePath) => {
            await convertPngToJpegResized(sourceFilePath);
            processedCount++;
            if (processedCount % 10 === 0) {
                console.log(
                    `Processed ${processedCount}/${pngFiles.length} images...`,
                );
            }
        },
        MAX_CONCURRENCY,
    );

    const elapsedSec = ((Date.now() - startTimeMs) / 1000).toFixed(1);
    console.log(
        `Done. Converted ${processedCount} image(s) in ${elapsedSec}s.`,
    );
}

main().catch((error) => {
    console.error("Conversion failed:", error);
    process.exit(1);
});
