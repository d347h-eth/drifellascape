import { expect, test, type Page, type Route } from "playwright/test";
import { attachDiagnostics, capturePageDiagnostics } from "./app";

const soldMint = "MarketSoldMint31911111111111111111111111111111";
const prevMint = "MarketSoldMint31811111111111111111111111111111";
const nextMint = "MarketSoldMint32011111111111111111111111111111";

function tokenRow(tokenNum: number, mint: string) {
    return {
        token_id: tokenNum,
        token_mint_addr: mint,
        token_num: tokenNum,
        token_name: `Drifella III #${tokenNum}`,
        image_url: `https://example.test/${tokenNum}.png`,
        traits: [],
    };
}

const listingRows = [
    {
        ...tokenRow(318, prevMint),
        price: 1_000_000_000,
        seller: "Seller3181111111111111111111111111111111111",
        listing_source: "M2",
    },
    {
        ...tokenRow(319, soldMint),
        price: 2_000_000_000,
        seller: "Seller3191111111111111111111111111111111111",
        listing_source: "M2",
    },
    {
        ...tokenRow(320, nextMint),
        price: 3_000_000_000,
        seller: "Seller3201111111111111111111111111111111111",
        listing_source: "M2",
    },
];

const tokenRows = [
    tokenRow(318, prevMint),
    tokenRow(319, soldMint),
    tokenRow(320, nextMint),
];

const transparentPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
);

type SearchBody = Record<string, unknown>;

type MockApiOptions = {
    currentListingExists?: boolean;
};

function readSearchBody(route: Route): SearchBody {
    try {
        return route.request().postDataJSON() as SearchBody;
    } catch {
        return {};
    }
}

async function fulfillSearch(
    route: Route,
    items: Record<string, unknown>[],
    options: { versionId?: number | null; sort?: string } = {},
) {
    await route.fulfill({
        json: {
            versionId: options.versionId ?? null,
            total: items.length,
            offset: 0,
            limit: 50,
            sort: options.sort ?? "token_asc",
            items,
        },
    });
}

async function mockApi(page: Page, options: MockApiOptions = {}) {
    let tokenSearches = 0;
    const tokenSearchBodies: SearchBody[] = [];
    const listingSearchBodies: SearchBody[] = [];

    await page.route("**/traits/catalog", async (route) => {
        await route.fulfill({ json: { total_tokens: 3, buckets: [] } });
    });
    await page.route("**/listings/search", async (route) => {
        const body = readSearchBody(route);
        listingSearchBodies.push(body);
        const items =
            body.anchorMint === soldMint &&
            options.currentListingExists === false
                ? [listingRows[0], listingRows[2]]
                : listingRows;
        await fulfillSearch(route, items, {
            versionId: 1,
            sort: String(body.sort ?? "price_asc"),
        });
    });
    await page.route("**/tokens/search", async (route) => {
        tokenSearches += 1;
        tokenSearchBodies.push(readSearchBody(route));
        await fulfillSearch(route, tokenRows);
    });
    await page.route("**/market/events**", async (route) => {
        const url = new URL(route.request().url());
        const eventType =
            url.searchParams.get("type") === "listing" ? "listing" : "sale";
        await route.fulfill({
            json: {
                type: eventType,
                total: 1,
                offset: 0,
                limit: 50,
                items: [
                    {
                        id: 1,
                        event_type: eventType,
                        signature: `Market${eventType}Signature319`,
                        source: "MAGIC_EDEN",
                        slot: 123,
                        block_time: Math.floor(Date.now() / 1000) - 60,
                        token_mint_addr: soldMint,
                        token_num: 319,
                        token_name: "Drifella III #319",
                        price: 1_000_000_000,
                        seller: "ssssSeller3191111111111111111111111111111",
                        buyer: "bbbbBuyer31911111111111111111111111111111",
                        image_url: `https://example.test/${soldMint}.jpg`,
                    },
                ],
            },
        });
    });
    await page.route(
        "https://app.drifellascape.art/static/art/**",
        async (route) => {
            await route.fulfill({
                body: transparentPng,
                contentType: "image/png",
            });
        },
    );

    return {
        tokenSearches: () => tokenSearches,
        tokenSearchBodies: () => tokenSearchBodies.slice(),
        listingSearchBodies: () => listingSearchBodies.slice(),
    };
}

async function currentGalleryToken(page: Page): Promise<string | null> {
    return (await currentGalleryPosition(page)).label;
}

async function currentGalleryPosition(
    page: Page,
): Promise<{ label: string | null; ratio: number; snapped: boolean }> {
    return await page.locator(".scroller").evaluate((element) => {
        const scroller = element as HTMLElement;
        const width = scroller.clientWidth || 1;
        const ratio = scroller.scrollLeft / width;
        const index = Math.max(0, Math.round(ratio));
        const slides = Array.from(
            scroller.querySelectorAll<HTMLElement>("section.slide"),
        );
        return {
            label: slides[index]?.getAttribute("aria-label") ?? null,
            ratio,
            snapped: Math.abs(ratio - Math.round(ratio)) < 0.02,
        };
    });
}

test("market feed stays open in Gallery and event clicks land on the exact token", async ({
    page,
}, testInfo) => {
    test.skip(
        testInfo.project.name !== "desktop",
        "market side-panel is desktop-only",
    );
    const diagnostics = capturePageDiagnostics(page);

    try {
        const api = await mockApi(page);
        await page.goto("/", { waitUntil: "domcontentloaded" });

        await page.getByRole("button", { name: "Grid" }).click();
        await expect(
            page.getByRole("button", { name: "Gallery" }),
        ).toBeVisible();

        await page.getByRole("button", { name: "Sales feed" }).click();
        await expect(
            page.getByRole("dialog", { name: "Sales feed" }),
        ).toBeVisible();

        await page
            .getByRole("button", { name: "Open #319 in gallery" })
            .click();

        await expect(
            page.getByRole("dialog", { name: "Sales feed" }),
        ).toBeVisible();
        await expect(page.locator(".scroller")).toBeVisible();
        await expect(page.locator(".scroller")).toHaveCSS(
            "visibility",
            "visible",
        );
        await expect
            .poll(() => currentGalleryToken(page), {
                message: "current gallery slide",
            })
            .toBe("Token 319");
        await expect(page.locator(".center .token-input")).toHaveValue("#319");

        await page.waitForTimeout(700);
        expect(api.tokenSearches()).toBe(1);
        expect(api.tokenSearchBodies()[0]?.anchorMint).toBe(soldMint);

        await page.getByRole("button", { name: "Sales feed" }).click();
        await expect(
            page.getByRole("dialog", { name: "Sales feed" }),
        ).toHaveCount(0);
        await expect
            .poll(
                async () => {
                    const position = await currentGalleryPosition(page);
                    return `${position.label}:${position.snapped ? "snapped" : "loose"}`;
                },
                {
                    message: "gallery stays snapped after closing market panel",
                },
            )
            .toBe("Token 319:snapped");

        await page.getByRole("button", { name: "Sales feed" }).click();
        await expect(
            page.getByRole("dialog", { name: "Sales feed" }),
        ).toBeVisible();
        await expect
            .poll(
                async () => {
                    const position = await currentGalleryPosition(page);
                    return `${position.label}:${position.snapped ? "snapped" : "loose"}`;
                },
                {
                    message:
                        "gallery stays snapped after reopening market panel",
                },
            )
            .toBe("Token 319:snapped");
        await page.waitForTimeout(700);
        expect(api.tokenSearches()).toBe(1);
    } catch (error) {
        await attachDiagnostics(testInfo, diagnostics);
        throw error;
    }
});

test("listing feed event clicks land in Listings mode when the current listing exists", async ({
    page,
}, testInfo) => {
    test.skip(
        testInfo.project.name !== "desktop",
        "market side-panel is desktop-only",
    );
    const diagnostics = capturePageDiagnostics(page);

    try {
        const api = await mockApi(page);
        await page.goto("/", { waitUntil: "domcontentloaded" });

        await page.getByRole("button", { name: "Listings feed" }).click();
        await expect(
            page.getByRole("dialog", { name: "Listings feed" }),
        ).toBeVisible();

        await page
            .getByRole("button", { name: "Open #319 in gallery" })
            .click();

        await expect(
            page.getByRole("dialog", { name: "Listings feed" }),
        ).toBeVisible();
        await expect
            .poll(() => currentGalleryToken(page), {
                message: "current gallery slide",
            })
            .toBe("Token 319");
        await expect(page.locator(".center .token-input")).toHaveValue("#319");
        await expect(
            page.locator(".toggle-strip").getByRole("button", {
                name: "Listings",
            }),
        ).toBeVisible();
        await expect
            .poll(
                () =>
                    api
                        .listingSearchBodies()
                        .filter((body) => body.anchorMint === soldMint).length,
                { message: "anchored current listing probe" },
            )
            .toBe(1);

        await page.waitForTimeout(700);
        expect(api.tokenSearches()).toBe(0);
        const anchoredListing = api
            .listingSearchBodies()
            .find((body) => body.anchorMint === soldMint);
        expect(anchoredListing?.sort).toBe("price_asc");
    } catch (error) {
        await attachDiagnostics(testInfo, diagnostics);
        throw error;
    }
});

test("listing feed event clicks fall back to Tokens mode when the current listing is gone", async ({
    page,
}, testInfo) => {
    test.skip(
        testInfo.project.name !== "desktop",
        "market side-panel is desktop-only",
    );
    const diagnostics = capturePageDiagnostics(page);

    try {
        const api = await mockApi(page, { currentListingExists: false });
        await page.goto("/", { waitUntil: "domcontentloaded" });

        await page.getByRole("button", { name: "Listings feed" }).click();
        await expect(
            page.getByRole("dialog", { name: "Listings feed" }),
        ).toBeVisible();

        await page
            .getByRole("button", { name: "Open #319 in gallery" })
            .click();

        await expect(
            page.getByRole("dialog", { name: "Listings feed" }),
        ).toBeVisible();
        await expect
            .poll(() => currentGalleryToken(page), {
                message: "current gallery slide",
            })
            .toBe("Token 319");
        await expect(page.locator(".center .token-input")).toHaveValue("#319");
        await expect(
            page.locator(".toggle-strip").getByRole("button", {
                name: "Tokens",
            }),
        ).toBeVisible();
        await expect
            .poll(() => api.tokenSearches(), {
                message: "token fallback search",
            })
            .toBe(1);

        const anchoredListing = api
            .listingSearchBodies()
            .find((body) => body.anchorMint === soldMint);
        expect(anchoredListing?.sort).toBe("price_asc");
        expect(api.tokenSearchBodies()[0]?.anchorMint).toBe(soldMint);
        expect(api.tokenSearchBodies()[0]?.sort).toBe("token_asc");
    } catch (error) {
        await attachDiagnostics(testInfo, diagnostics);
        throw error;
    }
});
