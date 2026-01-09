import { headers } from "next/headers";

function getBaseUrl(): string {
  const h = headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) throw new Error("Missing host header");
  return `${proto}://${host}`;
}

async function fetchStocks(limit = 5000): Promise<{ count: number; rows: StockRow[] }> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/api/stocks?limit=${limit}`;

  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to load stocks (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { count?: number; rows?: StockRow[] };

  return {
    count: typeof json.count === "number" ? json.count : 0,
    rows: Array.isArray(json.rows) ? json.rows : [],
  };
}
