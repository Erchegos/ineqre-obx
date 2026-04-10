import type { MetadataRoute } from "next";
import { pool } from "@/lib/db";

const BASE = "https://ineqre.vercel.app";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Static pages
  const staticPages = [
    { url: `${BASE}/`, changeFrequency: "daily" as const, priority: 1.0 },
    { url: `${BASE}/stocks`, changeFrequency: "daily" as const, priority: 0.9 },
    { url: `${BASE}/research`, changeFrequency: "daily" as const, priority: 0.8 },
    { url: `${BASE}/news`, changeFrequency: "hourly" as const, priority: 0.8 },
    { url: `${BASE}/correlation`, changeFrequency: "daily" as const, priority: 0.7 },
    { url: `${BASE}/volatility/obx`, changeFrequency: "daily" as const, priority: 0.8 },
    { url: `${BASE}/options`, changeFrequency: "daily" as const, priority: 0.7 },
    { url: `${BASE}/portfolio`, changeFrequency: "weekly" as const, priority: 0.7 },
    { url: `${BASE}/backtest`, changeFrequency: "daily" as const, priority: 0.6 },
    { url: `${BASE}/std-channel-strategy`, changeFrequency: "daily" as const, priority: 0.6 },
    { url: `${BASE}/fx`, changeFrequency: "daily" as const, priority: 0.7 },
    { url: `${BASE}/seafood`, changeFrequency: "daily" as const, priority: 0.7 },
    { url: `${BASE}/shipping`, changeFrequency: "daily" as const, priority: 0.7 },
    { url: `${BASE}/commodities`, changeFrequency: "daily" as const, priority: 0.7 },
    { url: `${BASE}/sectors`, changeFrequency: "daily" as const, priority: 0.6 },
    { url: `${BASE}/financials`, changeFrequency: "daily" as const, priority: 0.7 },
    { url: `${BASE}/flow`, changeFrequency: "daily" as const, priority: 0.6 },
    { url: `${BASE}/alpha`, changeFrequency: "daily" as const, priority: 0.6 },
  ];

  // Dynamic stock pages
  let stockPages: MetadataRoute.Sitemap = [];
  try {
    const result = await pool.query<{ ticker: string }>(
      `SELECT ticker FROM stocks WHERE asset_type = 'equity' ORDER BY ticker`
    );
    stockPages = result.rows.map((r) => ({
      url: `${BASE}/stocks/${r.ticker}`,
      changeFrequency: "daily" as const,
      priority: 0.5,
    }));
  } catch {
    // silently fail — sitemap still works with static pages
  }

  return [...staticPages, ...stockPages];
}
