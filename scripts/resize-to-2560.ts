
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const SOURCE_DIR = path.resolve(process.cwd(), "static", "full");

type Mode = "width" | "height" | "meta";
const DEFAULT_MODE: Mode = "height";
const MODE_CONFIG: Record<Mode, {
    targetDirName: string;
    description: string;
    resizeOptions: sharp.ResizeOptions;
}> = {
    width: {
        targetDirName: "2560",
        description: "resize to 2560px width (fit inside)",
        resizeOptions: {
            width: 2560,
            fit: sharp.fit.inside,
            withoutEnlargement: true,
            kernel: sharp.kernel.lanczos3,
        },
    },
    height: {
        targetDirName: "540h",
        description: "resize to 540px height (fit inside)",
        resizeOptions: {
            height: 540,
            fit: sharp.fit.inside,
            withoutEnlargement: true,
            kernel: sharp.kernel.lanczos3,
        },
    },
    meta: {
        targetDirName: "meta",
        description: "resize & crop to 1200×630 (OG preview)",
        resizeOptions: {
            width: 1200,
            height: 630,
            fit: sharp.fit.cover,
            position: "centre",
            withoutEnlargement: true,
            kernel: sharp.kernel.lanczos3,
        },
    },
};

const allowedModes = Object.keys(MODE_CONFIG) as Mode[];
const modeArgRaw = process.argv[2]?.toLowerCase();
let MODE: Mode = DEFAULT_MODE;
if (modeArgRaw) {
    if ((allowedModes as string[]).includes(modeArgRaw)) {
        MODE = modeArgRaw as Mode;
    } else {
        console.error(
            `Invalid mode "${modeArgRaw}". Allowed values: ${allowedModes.join(", ")}.`,
        );
        process.exit(1);
    }
}

const TARGET_DIR = path.resolve(
    process.cwd(),
    "static",
    MODE_CONFIG[MODE].targetDirName,
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
        .resize(MODE_CONFIG[MODE].resizeOptions)
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
        `Found ${pngFiles.length} PNG file(s). Starting conversion using mode "${MODE}" (${MODE_CONFIG[MODE].description})...`,
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
        `Done. Converted ${processedCount} image(s) in ${elapsedSec}s. Output directory: ${TARGET_DIR}`,
    );
}

main().catch((error) => {
    console.error("Conversion failed:", error);
    process.exit(1);
});
