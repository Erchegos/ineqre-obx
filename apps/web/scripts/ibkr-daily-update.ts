// apps/web/scripts/ibkr-daily-update.ts
import { config } from "dotenv";
import { resolve } from "path";
import { Client } from "pg";
import { IBKRClient, ALL_TICKERS } from "@ineqre/ibkr";
import type { PriceData } from "@ineqre/ibkr";

// Load environment variables from .env.local
config({ path: resolve(__dirname, "../.env.local") });

const IBKR_BASE_URL = process.env.IBKR_GATEWAY_URL || "https://localhost:5000";
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

async function upsertPrice(client: Client, price: PriceData): Promise<void> {
  const query = `
    INSERT INTO public.prices_daily
      (ticker, date, open, high, low, close, adj_close, volume, source)
    VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (ticker, date) DO UPDATE SET
      open = EXCLUDED.open,
      high = EXCLUDED.high,
      low = EXCLUDED.low,
      close = EXCLUDED.close,
      volume = EXCLUDED.volume,
      source = EXCLUDED.source
  `;

  await client.query(query, [
    price.ticker,
    price.date,
    price.open,
    price.high,
    price.low,
    price.close,
    null, // adj_close
    price.volume,
    "ibkr",
  ]);
}

async function updateTicker(
  ibkr: IBKRClient,
  db: Client,
  ticker: string
): Promise<{ success: boolean; date?: string; count?: number; error?: string }> {
  try {
    const contract = await ibkr.searchContract(ticker, "OSE");

    if (!contract) {
      return { success: false, error: "Contract not found" };
    }

    // Fetch last 5 days to ensure we catch all recent data
    const histData = await ibkr.getHistoricalData(contract.conid, "5d", "1d");

    if (!histData || !histData.data || histData.data.length === 0) {
      return { success: false, error: "No data returned" };
    }

    const prices = ibkr.convertBarsToPrice(ticker, histData.data);

    if (prices.length === 0) {
      return { success: false, error: "No price data" };
    }

    // Upsert ALL bars from the last 5 days to backfill missing data
    for (const price of prices) {
      await upsertPrice(db, price);
    }

    const latestPrice = prices[prices.length - 1];
    return { success: true, date: latestPrice.date, count: prices.length };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message ?? String(error),
    };
  }
}

async function main() {
  console.log("=== IBKR Daily Update ===");
  console.log(`Time: ${new Date().toISOString()}\n`);

  const ibkr = new IBKRClient({ baseUrl: IBKR_BASE_URL });
  const db = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // Health check
    const healthy = await ibkr.healthCheck();
    if (!healthy) {
      throw new Error(`IBKR Gateway not responding at ${IBKR_BASE_URL}`);
    }
    console.log("✓ IBKR Gateway connected");

    await db.connect();
    console.log("✓ Database connected\n");

    const results: Array<{
      ticker: string;
      success: boolean;
      date?: string;
      count?: number;
      error?: string;
    }> = [];

    for (const ticker of ALL_TICKERS) {
      console.log(`[${ticker}] Updating...`);
      const result = await updateTicker(ibkr, db, ticker);
      results.push({ ticker, ...result });

      if (result.success) {
        console.log(`[${ticker}] ✓ Updated: ${result.date} (${result.count} bars inserted)`);
      } else {
        console.log(`[${ticker}] ✗ Failed: ${result.error}`);
      }

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Summary
    console.log("\n=== Update Summary ===\n");
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    console.log(`✓ Successful: ${successful.length}/${results.length}`);
    console.log(`✗ Failed: ${failed.length}/${results.length}`);

    if (failed.length > 0) {
      console.log("\nFailed tickers:");
      failed.forEach((r) => console.log(`  - ${r.ticker}: ${r.error}`));
    }
  } catch (error) {
    console.error("\n✗ Fatal error:", error);
    process.exit(1);
  } finally {
    await db.end();
  }
}

main();
