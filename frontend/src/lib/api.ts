import type { ApiResponse, ListingsSearchBody, ListingRow, TokenRow } from "./types";

const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? "http://localhost:3000";

export async function postSearchListings(body: ListingsSearchBody): Promise<ApiResponse<ListingRow>> {
  const res = await fetch(`${API_BASE}/listings/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as ApiResponse<ListingRow>;
}

export async function postSearchTokens(body: ListingsSearchBody): Promise<ApiResponse<TokenRow>> {
  const res = await fetch(`${API_BASE}/tokens/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as ApiResponse<TokenRow>;
}
