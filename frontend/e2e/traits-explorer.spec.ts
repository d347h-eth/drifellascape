import { expect, test, type Page, type Route } from "playwright/test";
import { attachDiagnostics, capturePageDiagnostics } from "./app";

const fillerBuckets = Array.from({ length: 28 }, (_, index) => ({
    type_id: 400 + index,
    type_name: `Node ${String(index).padStart(2, "0")}`,
    spatial_group: "zzfill",
    purpose_class: "decor",
    tokens_with_type: 10,
    values: [
        {
            value_id: 500 + index,
            value: `Stone ${String(index).padStart(2, "0")}`,
            tokens_with_type_value: 1,
            rarity_pct: 10,
        },
    ],
}));

const catalog = {
    total_tokens: 10,
    buckets: [
        {
            type_id: 1,
            type_name: "Background",
            spatial_group: "middle",
            purpose_class: "decor",
            tokens_with_type: 10,
            values: [
                {
                    value_id: 101,
                    value: "Blue",
                    tokens_with_type_value: 5,
                    rarity_pct: 50,
                },
                {
                    value_id: 102,
                    value: "Amber",
                    tokens_with_type_value: 1,
                    rarity_pct: 10,
                },
                {
                    value_id: 103,
                    value: "Zebra",
                    tokens_with_type_value: 2,
                    rarity_pct: 20,
                },
            ],
        },
        {
            type_id: 2,
            type_name: "Eyes",
            spatial_group: "left",
            purpose_class: "special",
            tokens_with_type: 10,
            values: [
                {
                    value_id: 201,
                    value: "Laser",
                    tokens_with_type_value: 1,
                    rarity_pct: 10,
                },
                {
                    value_id: 202,
                    value: "Green",
                    tokens_with_type_value: 7,
                    rarity_pct: 70,
                },
            ],
        },
        {
            type_id: 3,
            type_name: "Headwear",
            spatial_group: "right",
            purpose_class: "items",
            tokens_with_type: 10,
            values: [
                {
                    value_id: 301,
                    value: "Cap",
                    tokens_with_type_value: 3,
                    rarity_pct: 30,
                },
                {
                    value_id: 302,
                    value: "Crown",
                    tokens_with_type_value: 1,
                    rarity_pct: 10,
                },
            ],
        },
        ...fillerBuckets,
        {
            type_id: 99,
            type_name: "Tail",
            spatial_group: "za",
            purpose_class: "items",
            tokens_with_type: 10,
            values: [
                {
                    value_id: 901,
                    value: "Tail Glow",
                    tokens_with_type_value: 1,
                    rarity_pct: 10,
                },
                {
                    value_id: 902,
                    value: "Tail Green",
                    tokens_with_type_value: 2,
                    rarity_pct: 20,
                },
            ],
        },
    ],
};

const searchResponse = {
    versionId: 1,
    total: 1,
    offset: 0,
    limit: 50,
    sort: "price_asc",
    items: [
        {
            token_id: 1,
            token_mint_addr: "Mint111111111111111111111111111111111111111",
            token_num: 1,
            token_name: "Drifella III #1",
            image_url: "https://example.test/1.png",
            price: 1_000_000_000,
            seller: "seller",
            listing_source: "M2",
            traits: [
                {
                    type_id: 1,
                    type_name: "Background",
                    spatial_group: "middle",
                    purpose_class: "decor",
                    value_id: 101,
                    value: "Blue",
                },
            ],
        },
    ],
};

const emptySearchResponse = {
    versionId: 1,
    total: 0,
    offset: 0,
    limit: 50,
    sort: "price_asc",
    items: [],
};

type MockSearchResponder =
    | Record<string, unknown>
    | ((
          body: Record<string, unknown>,
      ) => Record<string, unknown> | Promise<Record<string, unknown>>);

type MockApiOptions = {
    listingsSearch?: MockSearchResponder;
    tokensSearch?: MockSearchResponder;
};

async function fulfillSearch(
    route: Route,
    responder: MockSearchResponder,
): Promise<void> {
    let body: Record<string, unknown> = {};
    try {
        body = route.request().postDataJSON() as Record<string, unknown>;
    } catch {
        body = {};
    }
    const json =
        typeof responder === "function" ? await responder(body) : responder;
    await route.fulfill({ json });
}

async function mockApi(
    page: Page,
    options: MockApiOptions = {},
): Promise<void> {
    const listingsSearch = options.listingsSearch ?? searchResponse;
    const tokensSearch = options.tokensSearch ?? {
        ...searchResponse,
        versionId: null,
    };

    await page.route("**/traits/catalog", async (route) => {
        await route.fulfill({ json: catalog });
    });
    await page.route("**/listings/search", async (route) => {
        await fulfillSearch(route, listingsSearch);
    });
    await page.route("**/tokens/search", async (route) => {
        await fulfillSearch(route, tokensSearch);
    });
}

async function gotoApp(
    page: Page,
    options: MockApiOptions = {},
): Promise<void> {
    await mockApi(page, options);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const landscapeDismiss = page.getByText("Tap anywhere to dismiss");
    if (await landscapeDismiss.isVisible().catch(() => false)) {
        await page.mouse.click(8, 8);
        await expect(landscapeDismiss).toHaveCount(0);
    }
}

async function openMainBarIfCollapsed(page: Page): Promise<void> {
    const traitsButton = page.getByRole("button", { name: "Traits" });
    if (await traitsButton.isVisible().catch(() => false)) return;

    const openButton = page.getByTitle("Open");
    if (await openButton.isVisible().catch(() => false)) {
        await openButton.click();
    }
}

async function openTraitsExplorer(
    page: Page,
    options: MockApiOptions = {},
): Promise<void> {
    await gotoApp(page, options);
    await openMainBarIfCollapsed(page);

    await page.getByRole("button", { name: "Traits" }).click();
    await expect(page.getByTestId("traits-root-search")).toBeVisible();
}

test("opens with buckets closed and toggles bucket content from the header", async ({
    page,
}, testInfo) => {
    const diagnostics = capturePageDiagnostics(page);

    try {
        await openTraitsExplorer(page);

        const backgroundHeader = page.getByTestId("traits-bucket-header-1");
        await expect(backgroundHeader).toHaveAttribute(
            "aria-expanded",
            "false",
        );
        await expect(page.getByTestId("traits-value-101")).toHaveCount(0);
        await expect(page.getByText(/tokens$/)).toHaveCount(0);

        await backgroundHeader.click();
        await expect(backgroundHeader).toHaveAttribute("aria-expanded", "true");
        await expect(page.getByTestId("traits-value-101")).toBeVisible();

        await backgroundHeader.click();
        await expect(backgroundHeader).toHaveAttribute(
            "aria-expanded",
            "false",
        );
        await expect(page.getByTestId("traits-value-101")).toHaveCount(0);
    } catch (error) {
        await attachDiagnostics(testInfo, diagnostics);
        throw error;
    }
});

test("root search filters from the second character and hides bucket controls", async ({
    page,
}, testInfo) => {
    const diagnostics = capturePageDiagnostics(page);

    try {
        await openTraitsExplorer(page);

        const rootSearch = page.getByTestId("traits-root-search");
        await expect(rootSearch).toHaveAttribute("type", "text");

        await rootSearch.fill("z");
        await expect(page.getByTestId("traits-bucket-1")).toBeVisible();
        await expect(page.getByTestId("traits-bucket-2")).toBeVisible();
        await expect(page.getByTestId("traits-bucket-jump-1")).toHaveCount(0);
        await expect(page.getByTestId("traits-value-103")).toHaveCount(0);

        await rootSearch.fill("ze");
        await expect(page.getByTestId("traits-bucket-1")).toBeVisible();
        await expect(page.getByTestId("traits-bucket-jump-1")).toBeVisible();
        await expect(page.getByTestId("traits-value-103")).toBeVisible();
        await expect(page.getByTestId("traits-bucket-search-1")).toHaveCount(0);
        await expect(page.getByTestId("traits-bucket-sort-1")).toHaveCount(0);
        await expect(page.getByTestId("traits-bucket-2")).toHaveCount(0);

        await rootSearch.fill("back");
        await expect(page.getByTestId("traits-bucket-1")).toBeVisible();
        await expect(page.getByTestId("traits-bucket-jump-1")).toBeVisible();
        await expect(page.getByTestId("traits-value-101")).toHaveCount(0);
        await expect(page.getByTestId("traits-value-102")).toHaveCount(0);
        await expect(page.getByTestId("traits-value-103")).toHaveCount(0);

        await page.getByTestId("traits-root-reset").click();
        await expect(page.getByTestId("traits-bucket-1")).toBeVisible();
        await expect(page.getByTestId("traits-bucket-jump-1")).toHaveCount(0);
        await expect(
            page.getByTestId("traits-bucket-header-1"),
        ).toHaveAttribute("aria-expanded", "false");
        await expect(page.getByTestId("traits-value-201")).toHaveCount(0);
    } catch (error) {
        await attachDiagnostics(testInfo, diagnostics);
        throw error;
    }
});

test("root search jump transfers input into one bucket and scrolls to its header", async ({
    page,
}, testInfo) => {
    const diagnostics = capturePageDiagnostics(page);

    try {
        await openTraitsExplorer(page);

        const rootSearch = page.getByTestId("traits-root-search");
        await rootSearch.fill("tail");
        await expect(page.getByTestId("traits-bucket-99")).toBeVisible();
        await expect(page.getByTestId("traits-bucket-jump-99")).toBeVisible();

        await page.getByTestId("traits-bucket-jump-99").click();
        await expect(rootSearch).toHaveValue("");
        await expect(page.getByTestId("traits-bucket-search-99")).toHaveValue(
            "tail",
        );
        await expect(page.getByTestId("traits-bucket-sort-99")).toBeVisible();
        await expect(
            page.getByTestId("traits-bucket-header-99"),
        ).toHaveAttribute("aria-expanded", "true");
        await expect(
            page.getByTestId("traits-bucket-header-1"),
        ).toHaveAttribute("aria-expanded", "false");
        await expect(page.getByTestId("traits-value-901")).toBeVisible();
        await expect(page.getByTestId("traits-value-902")).toBeVisible();

        const headerTop = await page
            .getByTestId("traits-bucket-header-99")
            .evaluate((element) => element.getBoundingClientRect().top);
        const bodyTop = await page
            .locator(".panel-body")
            .evaluate((element) => element.getBoundingClientRect().top);
        expect(Math.abs(headerTop - bodyTop)).toBeLessThanOrEqual(1);
    } catch (error) {
        await attachDiagnostics(testInfo, diagnostics);
        throw error;
    }
});

test("bucket search overrides root search and bucket sort toggles value ordering", async ({
    page,
}, testInfo) => {
    const diagnostics = capturePageDiagnostics(page);

    try {
        await openTraitsExplorer(page);

        const background = page.getByTestId("traits-bucket-1");
        await page.getByTestId("traits-bucket-header-1").click();

        await expect(background.locator(".value-name")).toHaveText([
            "Amber",
            "Zebra",
            "Blue",
        ]);
        await background.getByTestId("traits-bucket-sort-1").click();
        await expect(background.locator(".value-name")).toHaveText([
            "Amber",
            "Blue",
            "Zebra",
        ]);

        await page.getByTestId("traits-root-search").fill("blu");
        await expect(background.locator(".value-name")).toHaveText(["Blue"]);
        await expect(
            background.getByTestId("traits-bucket-search-1"),
        ).toHaveCount(0);

        await background.getByTestId("traits-bucket-jump-1").click();
        await background.getByTestId("traits-bucket-search-1").fill("z");
        await expect(background.locator(".value-name")).toHaveText(["Zebra"]);
        await expect(page.getByTestId("traits-value-101")).toHaveCount(0);
    } catch (error) {
        await attachDiagnostics(testInfo, diagnostics);
        throw error;
    }
});

test("trait value clicks replace by default and ctrl-click adds side-panel pills", async ({
    page,
}, testInfo) => {
    const diagnostics = capturePageDiagnostics(page);

    try {
        await openTraitsExplorer(page);

        await page.getByTestId("traits-bucket-header-1").click();
        await page.getByTestId("traits-value-101").click();

        const bluePill = page.getByTestId("traits-filter-pill-101");
        await expect(bluePill).toBeVisible();
        await expect(bluePill).toContainText("Background: Blue");

        await page.getByTestId("traits-value-103").click();
        await expect(page.getByTestId("traits-filter-pill-101")).toHaveCount(0);
        await expect(page.getByTestId("traits-filter-pill-103")).toBeVisible();

        await page
            .getByTestId("traits-value-102")
            .click({ modifiers: ["Control"] });
        await expect(page.getByTestId("traits-filter-pill-103")).toBeVisible();
        await expect(page.getByTestId("traits-filter-pill-102")).toBeVisible();
        await expect(page.getByTestId("traits-bucket-header-1")).toHaveCSS(
            "color",
            "rgb(236, 126, 21)",
        );

        await page.getByTestId("traits-bucket-header-2").click();
        await page.getByTestId("traits-value-201").click();
        await expect(page.getByTestId("traits-filter-pill-102")).toHaveCount(0);
        await expect(page.getByTestId("traits-filter-pill-201")).toBeVisible();
        await expect(page.getByTestId("traits-bucket-header-1")).not.toHaveCSS(
            "color",
            "rgb(236, 126, 21)",
        );
        await expect(page.getByTestId("traits-bucket-header-2")).toHaveCSS(
            "color",
            "rgb(236, 126, 21)",
        );

        await page.getByTestId("traits-filter-pill-201").click();
        await expect(page.getByTestId("traits-filter-pill-201")).toHaveCount(0);
        await expect(page.getByTestId("traits-bucket-header-2")).not.toHaveCSS(
            "color",
            "rgb(236, 126, 21)",
        );
    } catch (error) {
        await attachDiagnostics(testInfo, diagnostics);
        throw error;
    }
});

test("empty listings state links to tokens browsing without filter hint when no filters are applied", async ({
    page,
}, testInfo) => {
    const diagnostics = capturePageDiagnostics(page);

    try {
        await gotoApp(page, {
            listingsSearch: emptySearchResponse,
            tokensSearch: {
                ...searchResponse,
                versionId: null,
                sort: "token_asc",
            },
        });

        await expect(page.getByText("No listings found.")).toBeVisible();
        await expect(
            page.getByText("Try to change the applied filters."),
        ).toHaveCount(0);

        await page.getByRole("button", { name: "tokens browsing" }).click();
        await expect(page.getByText("No listings found.")).toHaveCount(0);
        await expect(
            page.getByRole("button", { name: "Open 1 in gallery" }),
        ).toBeVisible();
    } catch (error) {
        await attachDiagnostics(testInfo, diagnostics);
        throw error;
    }
});

test("empty tokens state includes the filter hint only when filters are applied", async ({
    page,
}, testInfo) => {
    const diagnostics = capturePageDiagnostics(page);

    try {
        await openTraitsExplorer(page, {
            tokensSearch: {
                ...emptySearchResponse,
                versionId: null,
                sort: "token_asc",
            },
        });

        await page.getByTestId("traits-bucket-header-1").click();
        await page.getByTestId("traits-value-101").click();
        await page
            .getByRole("button", { name: "Close traits explorer" })
            .click();
        await page.keyboard.press("T");

        await expect(page.getByText("No tokens found.")).toBeVisible();
        await expect(
            page.getByText("Try to change the applied filters."),
        ).toBeVisible();
    } catch (error) {
        await attachDiagnostics(testInfo, diagnostics);
        throw error;
    }
});

test("F toggles traits explorer and clicked explorer buttons do not paint focus rings", async ({
    page,
}, testInfo) => {
    const diagnostics = capturePageDiagnostics(page);

    try {
        await gotoApp(page);

        await page.keyboard.press("F");
        await expect(page.getByTestId("traits-root-search")).toBeVisible();

        const backgroundHeader = page.getByTestId("traits-bucket-header-1");
        await backgroundHeader.click();
        await expect(backgroundHeader).toHaveAttribute("aria-expanded", "true");
        await expect(backgroundHeader).toHaveCSS("box-shadow", "none");

        await page.keyboard.press("F");
        await expect(page.getByTestId("traits-root-search")).toHaveCount(0);
    } catch (error) {
        await attachDiagnostics(testInfo, diagnostics);
        throw error;
    }
});

test("desktop main bar labels show the current state", async ({
    page,
}, testInfo) => {
    test.skip(
        testInfo.project.name !== "desktop",
        "desktop status labels only",
    );
    const diagnostics = capturePageDiagnostics(page);

    try {
        await gotoApp(page);

        await expect(page.getByRole("button", { name: "Grid" })).toBeVisible();
        await expect(
            page.getByRole("button", { name: "Listings", exact: true }),
        ).toBeVisible();

        await page
            .getByRole("button", { name: "Listings", exact: true })
            .click();
        await expect(
            page.getByRole("button", { name: "Tokens" }),
        ).toBeVisible();
        await expect(
            page.getByRole("button", { name: "Sort #↑" }),
        ).toBeVisible();

        await page.getByRole("button", { name: "Grid" }).click();
        await expect(
            page.getByRole("button", { name: "Gallery" }),
        ).toBeVisible();
    } catch (error) {
        await attachDiagnostics(testInfo, diagnostics);
        throw error;
    }
});
