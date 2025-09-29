// Centralized purpose classes for trait grouping and navigation
export const PURPOSES = [
    "left",
    "middle",
    "right",
    "decor",
    "items",
    "undefined",
] as const;

export type Purpose = (typeof PURPOSES)[number];

export function normalizedPurpose(p: string | null | undefined): Purpose {
    const v = (p || "").toLowerCase();
    return (PURPOSES.find((x) => x === v) ?? "undefined") as Purpose;
}
