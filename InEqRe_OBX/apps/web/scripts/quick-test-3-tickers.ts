/**
 * Quick Test: Calculate factors for 3 tickers (AKER, DNB, EQNR)
 * Takes ~2-3 minutes
 */

import { Client } from "pg";
import { config } from "dotenv";
import { resolve } from "path";
import {
  calculateMomentumFactors,
  calculateVolatilityFactors,
  calculateNOKVolume,
} from "../src/lib/factors";

type PriceData = { date: string; adjClose: number; close: number; volume: number };

function computeLogReturns(prices: PriceData[]): { date: string; logReturn: number }[] {
  const returns: { date: string; logReturn: number }[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push({
      date: prices[i].date,
      logReturn: Math.log(prices[i].adjClose / prices[i - 1].adjClose),
    });
  }
  return returns;
}

config({ path: resolve(__dirname, "../.env.local") });

const DATABASE_URL = process.env.DATABASE_URL;
const TEST_TICKERS = ["AKER", "DNB", "EQNR"];

async function calculateForTicker(db: Client, ticker: string) {
  console.log(`\n[${"=".repeat(60)}]`);
  console.log(`Processing: ${ticker}`);
  console.log(`[${"=".repeat(60)}]`);

  try {
    // Fetch last 300 days of data
    const endDate = new Date().toISOString().split("T")[0];
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 300);
    const startDateStr = startDate.toISOString().split("T")[0];

    const priceQuery = `
      SELECT date::text, adj_close AS "adjClose", close, volume
      FROM prices_daily
      WHERE ticker = $1 AND date BETWEEN $2 AND $3 AND close > 0
      ORDER BY date ASC
    `;

    const result = await db.query(priceQuery, [ticker, startDateStr, endDate]);
    const prices: PriceData[] = result.rows.map((row) => ({
      date: row.date,
      adjClose: parseFloat(row.adjClose || row.close),
      close: parseFloat(row.close),
      volume: parseInt(row.volume, 10),
    }));

    console.log(`Fetched ${prices.length} price points`);

    if (prices.length < 252) {
      console.log(`⚠️  Insufficient data (need 252+)`);
      return;
    }

    const returns = computeLogReturns(prices);
    let insertCount = 0;

    // Calculate for dates where we have sufficient history
    for (let i = 252; i < prices.length; i++) {
      const targetDate = prices[i].date;
      const momentum = calculateMomentumFactors(prices, targetDate);
      const volatility = calculateVolatilityFactors(returns, targetDate);
      const nokvol = await calculateNOKVolume(ticker, targetDate);
      const dumJan = new Date(targetDate).getMonth() === 0 ? 1 : 0;

      await db.query(
        `
        INSERT INTO factor_technical (
          ticker, date, mom1m, mom6m, mom11m, mom36m, chgmom,
          vol1m, vol3m, vol12m, maxret, beta, ivol, dum_jan
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (ticker, date) DO UPDATE SET
          mom1m = EXCLUDED.mom1m, mom6m = EXCLUDED.mom6m,
          vol1m = EXCLUDED.vol1m, vol3m = EXCLUDED.vol3m
      `,
        [
          ticker,
          targetDate,
          momentum.mom1m,
          momentum.mom6m,
          momentum.mom11m,
          momentum.mom36m,
          momentum.chgmom,
          volatility.vol1m,
          volatility.vol3m,
          volatility.vol12m,
          volatility.maxret,
          null, // beta (expensive, skip for now)
          null, // ivol (expensive, skip for now)
          dumJan,
        ]
      );

      insertCount++;
    }

    console.log(`✓ Inserted ${insertCount} factor rows for ${ticker}`);
  } catch (error: any) {
    console.error(`✗ Error: ${error.message}`);
  }
}

async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║  Quick Test: Calculate Factors for 3 Tickers              ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  if (!DATABASE_URL) {
    console.error("❌ DATABASE_URL not set");
    process.exit(1);
  }

  const db = new Client({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
  });

  try {
    await db.connect();
    console.log("✓ Connected to database\n");

    for (const ticker of TEST_TICKERS) {
      await calculateForTicker(db, ticker);
    }

    // Show summary
    console.log(`\n${"=".repeat(60)}`);
    console.log("Summary");
    console.log("=".repeat(60));

    const countQuery = `
      SELECT ticker, COUNT(*) as rows, MIN(date) as earliest, MAX(date) as latest
      FROM factor_technical
      WHERE ticker IN ('AKER', 'DNB', 'EQNR')
      GROUP BY ticker
      ORDER BY ticker
    `;
    const summary = await db.query(countQuery);

    console.log("\nFactor data in database:");
    summary.rows.forEach((row) => {
      console.log(
        `  ${row.ticker}: ${row.rows} rows (${row.earliest} to ${row.latest})`
      );
    });

    console.log("\n✅ Test complete!");
    console.log("\nNext steps:");
    console.log("  1. Start ML service: cd ml-service && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt && uvicorn app.main:app --reload");
    console.log("  2. Train model: curl -X POST http://localhost:8000/train ...");
    console.log("  3. Test APIs: npm run dev (in apps/web)");
  } catch (error: any) {
    console.error("\n✗ Fatal error:", error.message);
    process.exit(1);
  } finally {
    await db.end();
  }
}

main();
