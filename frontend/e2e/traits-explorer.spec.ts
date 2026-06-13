import { expect, test, type Page } from "playwright/test";
import { attachDiagnostics, capturePageDiagnostics } from "./app";

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

async function mockApi(page: Page): Promise<void> {
    await page.route("**/traits/catalog", async (route) => {
        await route.fulfill({ json: catalog });
    });
    await page.route("**/listings/search", async (route) => {
        await route.fulfill({ json: searchResponse });
    });
    await page.route("**/tokens/search", async (route) => {
        await route.fulfill({ json: { ...searchResponse, versionId: null } });
    });
}

async function openTraitsExplorer(page: Page): Promise<void> {
    await mockApi(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const landscapeDismiss = page.getByText("Tap anywhere to dismiss");
    if (await landscapeDismiss.isVisible().catch(() => false)) {
        await page.mouse.click(8, 8);
        await expect(landscapeDismiss).toHaveCount(0);
    }

    const traitsButton = page.getByRole("button", { name: "Traits" });
    if (!(await traitsButton.isVisible().catch(() => false))) {
        const openButton = page.getByTitle("Open");
        if (await openButton.isVisible().catch(() => false)) {
            await openButton.click();
        }
    }

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

test("root search filters from the third character and reset restores closed buckets", async ({
    page,
}, testInfo) => {
    const diagnostics = capturePageDiagnostics(page);

    try {
        await openTraitsExplorer(page);

        const rootSearch = page.getByTestId("traits-root-search");
        await rootSearch.fill("la");
        await expect(page.getByTestId("traits-bucket-1")).toBeVisible();
        await expect(page.getByTestId("traits-bucket-2")).toBeVisible();
        await expect(page.getByTestId("traits-value-201")).toHaveCount(0);

        await rootSearch.fill("las");
        await expect(page.getByTestId("traits-bucket-1")).toHaveCount(0);
        await expect(page.getByTestId("traits-bucket-2")).toBeVisible();
        await expect(page.getByTestId("traits-value-201")).toBeVisible();
        await expect(page.getByTestId("traits-value-202")).toHaveCount(0);

        await page.getByTestId("traits-root-reset").click();
        await expect(page.getByTestId("traits-bucket-1")).toBeVisible();
        await expect(
            page.getByTestId("traits-bucket-header-1"),
        ).toHaveAttribute("aria-expanded", "false");
        await expect(page.getByTestId("traits-value-201")).toHaveCount(0);
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

        await background.getByTestId("traits-bucket-search-1").fill("z");
        await expect(background.locator(".value-name")).toHaveText(["Zebra"]);
        await expect(page.getByTestId("traits-value-101")).toHaveCount(0);
    } catch (error) {
        await attachDiagnostics(testInfo, diagnostics);
        throw error;
    }
});
