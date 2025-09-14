import { describe, it, expect } from "vitest";
import { normalizeItem } from "../src/fetcher.js";

describe("normalizeItem", () => {
    it("parses a valid listing", () => {
        const item = {
            tokenMint: "Mint111111111111111111111111111111111111111",
            seller: "Seller1111111111111111111111111111111111111",
            priceInfo: { solPrice: { rawAmount: "1799000000" } },
            extra: { img: "https://example.com/img.png" },
            listingSource: "TENSOR_MARKETPLACE_LISTING",
            token: { name: "Drifella III #780" },
        };
        const norm = normalizeItem(item);
        expect(norm).toEqual({
            token_mint_addr: item.tokenMint,
            token_num: 780,
            price: 1_799_000_000,
            seller: item.seller,
            image_url: item.extra.img,
            listing_source: item.listingSource,
        });
    });

    it("returns null when required fields missing", () => {
        const base = {
            tokenMint: "Mint",
            seller: "Seller",
            priceInfo: { solPrice: { rawAmount: "1000000000" } },
            extra: { img: "https://img" },
            listingSource: "M2",
            token: { name: "Name #1" },
        };
        expect(normalizeItem({ ...base, tokenMint: undefined })).toBeNull();
        expect(normalizeItem({ ...base, seller: undefined })).toBeNull();
        expect(normalizeItem({ ...base, priceInfo: {} })).toBeNull();
        expect(
            normalizeItem({ ...base, priceInfo: { solPrice: { rawAmount: undefined } } }),
        ).toBeNull();
        expect(normalizeItem({ ...base, extra: {} })).toBeNull();
        expect(normalizeItem({ ...base, listingSource: undefined })).toBeNull();
    });

    it("allows missing token.name (token_num undefined)", () => {
        const item = {
            tokenMint: "Mint222222222222222222222222222222222222222",
            seller: "Seller2222222222222222222222222222222222222",
            priceInfo: { solPrice: { rawAmount: "1000000000" } },
            extra: { img: "https://example.com/2.png" },
            listingSource: "MMM",
            token: {},
        };
        const norm = normalizeItem(item)!;
        expect(norm.token_num).toBeUndefined();
        expect(norm.token_mint_addr).toBe(item.tokenMint);
        expect(norm.price).toBe(1_000_000_000);
    });

    it("rejects non-numeric price", () => {
        const item = {
            tokenMint: "Mint333333333333333333333333333333333333333",
            seller: "Seller3333333333333333333333333333333333333",
            priceInfo: { solPrice: { rawAmount: "abc" } },
            extra: { img: "https://example.com/3.png" },
            listingSource: "M3",
            token: { name: "Name #3" },
        };
        expect(normalizeItem(item)).toBeNull();
    });
});

