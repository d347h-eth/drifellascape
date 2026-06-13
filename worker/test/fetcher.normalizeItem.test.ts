import { describe, it, expect } from "vitest";
import { normalizeItem, normalizeMarketEvent } from "../src/fetcher.js";

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
            normalizeItem({
                ...base,
                priceInfo: { solPrice: { rawAmount: undefined } },
            }),
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

describe("normalizeMarketEvent", () => {
    it("normalizes buyNow sales to lamports from numeric price", () => {
        const item = {
            signature: "Sig111111111111111111111111111111111111111111",
            type: "buyNow",
            source: "magiceden_v2",
            tokenMint: "Mint111111111111111111111111111111111111111",
            slot: 123,
            blockTime: 1_781_301_192,
            buyer: "Buyer11111111111111111111111111111111111111",
            seller: "Seller1111111111111111111111111111111111111",
            price: 2.9814,
            priceInfo: {
                solPrice: {
                    rawAmount: "2981400000000000000",
                    decimals: 9,
                },
            },
            image: "https://example.com/sale.png",
        };

        expect(normalizeMarketEvent(item, "sale")).toEqual({
            event_type: "sale",
            signature: item.signature,
            source: item.source,
            slot: item.slot,
            block_time: item.blockTime,
            token_mint_addr: item.tokenMint,
            price: 2_981_400_000,
            seller: item.seller,
            buyer: item.buyer,
            image_url: item.image,
        });
    });

    it("normalizes list events and rejects wrong remote type", () => {
        const item = {
            signature: "Sig222222222222222222222222222222222222222222",
            type: "list",
            source: "magiceden_v2",
            tokenMint: "Mint222222222222222222222222222222222222222",
            slot: 456,
            blockTime: 1_781_372_543,
            seller: "Seller2222222222222222222222222222222222222",
            price: 3.440999833,
            image: "https://example.com/list.png",
        };

        const event = normalizeMarketEvent(item, "listing");
        expect(event?.event_type).toBe("listing");
        expect(event?.price).toBe(3_440_999_833);
        expect(event?.buyer).toBeUndefined();
        expect(normalizeMarketEvent(item, "sale")).toBeNull();
    });

    it("requires buyer for sale events", () => {
        const item = {
            signature: "Sig333333333333333333333333333333333333333333",
            type: "buyNow",
            source: "mmm",
            tokenMint: "Mint333333333333333333333333333333333333333",
            slot: 789,
            blockTime: 1_781_301_192,
            seller: "Seller3333333333333333333333333333333333333",
            price: 1,
        };

        expect(normalizeMarketEvent(item, "sale")).toBeNull();
    });
});
