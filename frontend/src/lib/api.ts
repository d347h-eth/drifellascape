import type { ApiResponse, ListingsSearchBody } from "./types";

const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? "http://localhost:3000";

export async function postSearchListings(body: ListingsSearchBody): Promise<ApiResponse> {
  const res = await fetch(`${API_BASE}/listings/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as ApiResponse;
}

