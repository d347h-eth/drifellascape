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

async function fulfillSearch(route: Route, items: Record<string, unknown>[]) {
    await route.fulfill({
        json: {
            versionId: null,
            total: items.length,
            offset: 0,
            limit: 50,
            sort: "token_asc",
            items,
        },
    });
}

async function mockApi(page: Page) {
    let tokenSearches = 0;
    const tokenSearchBodies: Record<string, unknown>[] = [];

    await page.route("**/traits/catalog", async (route) => {
        await route.fulfill({ json: { total_tokens: 3, buckets: [] } });
    });
    await page.route("**/listings/search", async (route) => {
        await route.fulfill({
            json: {
                versionId: 1,
                total: listingRows.length,
                offset: 0,
                limit: 50,
                sort: "price_asc",
                items: listingRows,
            },
        });
    });
    await page.route("**/tokens/search", async (route) => {
        tokenSearches += 1;
        try {
            tokenSearchBodies.push(route.request().postDataJSON());
        } catch {
            tokenSearchBodies.push({});
        }
        await fulfillSearch(route, tokenRows);
    });
    await page.route("**/market/events**", async (route) => {
        await route.fulfill({
            json: {
                type: "sale",
                total: 1,
                offset: 0,
                limit: 50,
                items: [
                    {
                        id: 1,
                        event_type: "sale",
                        signature: "MarketSaleSignature319",
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
    await page.route("https://app.drifellascape.art/static/art/**", async (route) => {
        await route.fulfill({
            body: transparentPng,
            contentType: "image/png",
        });
    });

    return {
        tokenSearches: () => tokenSearches,
        tokenSearchBodies: () => tokenSearchBodies.slice(),
    };
}

async function currentGalleryToken(page: Page): Promise<string | null> {
    return await page.locator(".scroller").evaluate((element) => {
        const scroller = element as HTMLElement;
        const width = scroller.clientWidth || 1;
        const index = Math.max(0, Math.round(scroller.scrollLeft / width));
        const slides = Array.from(
            scroller.querySelectorAll<HTMLElement>("section.slide"),
        );
        return slides[index]?.getAttribute("aria-label") ?? null;
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
    } catch (error) {
        await attachDiagnostics(testInfo, diagnostics);
        throw error;
    }
});
