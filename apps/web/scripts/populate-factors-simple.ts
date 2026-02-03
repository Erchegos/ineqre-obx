/**
 * Simple script to populate factors for 3 tickers
 * No dependencies on pool, all inline
 */

import { Client } from "pg";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });

const DATABASE_URL = process.env.DATABASE_URL;
const TEST_TICKERS = ["STB", "TOM", "TGS"];

// Inline implementations to avoid SSL issues
function computeLogReturns(prices: any[]) {
  const returns: any[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1].close;
    const curr = prices[i].close;
    if (prev > 0 && curr > 0) {
      returns.push({ date: prices[i].date, return: Math.log(curr / prev) });
    }
  }
  return returns;
}

function calculateMomentum(prices: any[], targetDate: string) {
  const targetIdx = prices.findIndex((p) => p.date === targetDate);
  if (targetIdx === -1) return {};

  const getReturn = (monthsBack: number, monthsEnd: number = 0) => {
    const endIdx = targetIdx - monthsEnd * 21;
    const startIdx = targetIdx - monthsBack * 21;
    if (startIdx < 0 || endIdx < 0) return null;
    const pStart = prices[startIdx]?.adjClose;
    const pEnd = prices[endIdx]?.adjClose;
    if (!pStart || !pEnd || pStart <= 0 || pEnd <= 0) return null;
    return Math.log(pEnd / pStart);
  };

  return {
    mom1m: getReturn(1, 0),
    mom6m: getReturn(7, 1),
    mom11m: getReturn(12, 1),
    mom36m: getReturn(48, 12),
    chgmom: null,
  };
}

function calculateVolatility(returns: any[], targetDate: string) {
  const targetIdx = returns.findIndex((r) => r.date === targetDate);
  if (targetIdx === -1) return {};

  const calcVol = (window: number) => {
    if (targetIdx < window) return null;
    const slice = returns.slice(targetIdx - window, targetIdx);
    const mean = slice.reduce((sum, r) => sum + r.return, 0) / slice.length;
    const variance =
      slice.reduce((sum, r) => sum + Math.pow(r.return - mean, 2), 0) /
      (slice.length - 1);
    return Math.sqrt(variance * 252);
  };

  let maxret = null;
  if (targetIdx >= 21) {
    const slice = returns.slice(targetIdx - 21, targetIdx);
    maxret = Math.max(...slice.map((r) => r.return));
  }

  return {
    vol1m: calcVol(21),
    vol3m: calcVol(63),
    vol12m: calcVol(252),
    maxret,
  };
}

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("  Populating Factors for 3 Tickers (STB, TOM, TGS)");
  console.log("=".repeat(70) + "\n");

  if (!DATABASE_URL) {
    console.error("❌ DATABASE_URL not set");
    process.exit(1);
  }

  const db = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await db.connect();
    console.log("✓ Connected to database\n");

    const endDate = new Date().toISOString().split("T")[0];
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 3); // Get 3 years of data
    const startDateStr = startDate.toISOString().split("T")[0];

    for (const ticker of TEST_TICKERS) {
      console.log(`\n[${ticker}] Fetching price data...`);

      const priceQuery = `
        SELECT date::text, adj_close AS "adjClose", close, volume
        FROM prices_daily
        WHERE ticker = $1 AND date BETWEEN $2 AND $3 AND close > 0
        ORDER BY date ASC
      `;

      const result = await db.query(priceQuery, [ticker, startDateStr, endDate]);
      const prices = result.rows;

      console.log(`[${ticker}] Found ${prices.length} price points`);

      if (prices.length < 252) {
        console.log(`[${ticker}] ⚠️  Insufficient data`);
        continue;
      }

      const returns = computeLogReturns(prices);
      let count = 0;

      for (let i = 252; i < prices.length; i++) {
        const targetDate = prices[i].date;
        const momentum = calculateMomentum(prices, targetDate);
        const volatility = calculateVolatility(returns, targetDate);
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
            null,
            null,
            dumJan,
          ]
        );
        count++;
      }

      console.log(`[${ticker}] ✓ Inserted ${count} rows`);
    }

    // Show summary
    console.log("\n" + "=".repeat(70));
    console.log("Summary");
    console.log("=".repeat(70));

    const summary = await db.query(`
      SELECT ticker, COUNT(*) as rows, MIN(date) as earliest, MAX(date) as latest
      FROM factor_technical
      WHERE ticker IN ('STB', 'TOM', 'TGS')
      GROUP BY ticker ORDER BY ticker
    `);

    console.log("\n✅ Factor data in database:\n");
    summary.rows.forEach((row) => {
      console.log(`  ${row.ticker}: ${row.rows} rows (${row.earliest} to ${row.latest})`);
    });

    console.log("\n✅ Complete! Ready to test ML service and APIs.\n");
  } catch (error: any) {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
  } finally {
    await db.end();
  }
}

main();
