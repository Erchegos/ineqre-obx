/**
 * Export factor data with actual returns for the Python optimizer
 *
 * Usage: npx tsx scripts/export-factors-for-optimizer.ts [--ticker TICKER] [--output-dir PATH]
 *
 * Exports CSV files with all 19 factors + actual_return for each ML-ready ticker.
 * Output goes to ~/Documents/Intelligence_Equity_Research/PredOptimizer/data/factors/
 */

import { pool } from "../src/lib/db";
import * as fs from "fs";
import * as path from "path";

const DEFAULT_OUTPUT_DIR = path.join(
  process.env.HOME || "~",
  "Documents/Intelligence_Equity_Research/PredOptimizer/data/factors"
);

interface FactorRow {
  ticker: string;
  date: string;
  mom1m: number | null;
  mom6m: number | null;
  mom11m: number | null;
  mom36m: number | null;
  chgmom: number | null;
  vol1m: number | null;
  vol3m: number | null;
  vol12m: number | null;
  maxret: number | null;
  beta: number | null;
  ivol: number | null;
  dum_jan: number | null;
  bm: number | null;
  ep: number | null;
  dy: number | null;
  sp: number | null;
  sg: number | null;
  mktcap: number | null;
  nokvol: number | null;
  actual_return: number | null;
}

async function getMLReadyTickers(): Promise<string[]> {
  const result = await pool.query<{ ticker: string }>(`
    SELECT ft_agg.ticker
    FROM (
      SELECT ticker
      FROM factor_technical
      GROUP BY ticker
      HAVING COUNT(*) >= 100
    ) ft_agg
    INNER JOIN LATERAL (
      SELECT 1
      FROM factor_technical ft2
      WHERE ft2.ticker = ft_agg.ticker
        AND ft2.beta IS NOT NULL
        AND ft2.ivol IS NOT NULL
      ORDER BY ft2.date DESC
      LIMIT 1
    ) beta_check ON true
    INNER JOIN LATERAL (
      SELECT 1
      FROM factor_fundamentals ff
      WHERE ff.ticker = ft_agg.ticker
        AND ff.bm IS NOT NULL
        AND ff.mktcap IS NOT NULL
        AND ff.nokvol IS NOT NULL
      ORDER BY ff.date DESC
      LIMIT 1
    ) fund_check ON true
    ORDER BY ft_agg.ticker
  `);
  return result.rows.map(r => r.ticker);
}

async function exportTickerFactors(ticker: string, outputDir: string): Promise<number> {
  // Query factor data with actual returns (21-day forward log return)
  const result = await pool.query<FactorRow>(`
    WITH factor_data AS (
      SELECT
        ft.ticker,
        ft.date,
        ft.mom1m,
        ft.mom6m,
        ft.mom11m,
        ft.mom36m,
        ft.chgmom,
        ft.vol1m,
        ft.vol3m,
        ft.vol12m,
        ft.maxret,
        ft.beta,
        ft.ivol,
        ft.dum_jan,
        ff.bm,
        ff.ep,
        ff.dy,
        ff.sp,
        ff.sg,
        ff.mktcap,
        ff.nokvol
      FROM factor_technical ft
      LEFT JOIN LATERAL (
        SELECT bm, ep, dy, sp, sg, mktcap, nokvol
        FROM factor_fundamentals ff2
        WHERE ff2.ticker = ft.ticker AND ff2.date <= ft.date
        ORDER BY ff2.date DESC LIMIT 1
      ) ff ON true
      WHERE ft.ticker = $1
      ORDER BY ft.date
    ),
    with_returns AS (
      SELECT
        fd.*,
        -- Calculate 21-day forward log return using prices
        LN(future_price.adj_close / current_price.adj_close) AS actual_return
      FROM factor_data fd
      LEFT JOIN prices_daily current_price
        ON current_price.ticker = fd.ticker AND current_price.date = fd.date
      LEFT JOIN LATERAL (
        SELECT adj_close, date
        FROM prices_daily p
        WHERE p.ticker = fd.ticker
          AND p.date > fd.date + INTERVAL '18 days'
          AND p.date <= fd.date + INTERVAL '25 days'
        ORDER BY p.date
        LIMIT 1
      ) future_price ON true
    )
    SELECT * FROM with_returns
    WHERE actual_return IS NOT NULL
    ORDER BY date
  `, [ticker]);

  if (result.rows.length === 0) {
    console.log(`  [${ticker}] No data with returns found, skipping`);
    return 0;
  }

  // Generate CSV content
  const headers = [
    "date", "actual_return",
    "mom1m", "mom6m", "mom11m", "mom36m", "chgmom",
    "vol1m", "vol3m", "vol12m", "maxret",
    "beta", "ivol",
    "bm", "ep", "dy", "sp", "sg", "mktcap", "nokvol",
    "dum_jan"
  ];

  const csvLines = [headers.join(",")];

  for (const row of result.rows) {
    // Helper to safely format numeric values (PostgreSQL may return strings)
    const fmt = (val: any, decimals: number = 6): string => {
      if (val === null || val === undefined) return "";
      const num = typeof val === "string" ? parseFloat(val) : val;
      return isNaN(num) ? "" : num.toFixed(decimals);
    };

    const values = [
      row.date,
      fmt(row.actual_return, 6),
      fmt(row.mom1m, 6),
      fmt(row.mom6m, 6),
      fmt(row.mom11m, 6),
      fmt(row.mom36m, 6),
      fmt(row.chgmom, 6),
      fmt(row.vol1m, 6),
      fmt(row.vol3m, 6),
      fmt(row.vol12m, 6),
      fmt(row.maxret, 6),
      fmt(row.beta, 6),
      fmt(row.ivol, 6),
      fmt(row.bm, 6),
      fmt(row.ep, 6),
      fmt(row.dy, 6),
      fmt(row.sp, 6),
      fmt(row.sg, 6),
      fmt(row.mktcap, 2),
      fmt(row.nokvol, 2),
      row.dum_jan?.toString() ?? "0"
    ];
    csvLines.push(values.join(","));
  }

  const csvContent = csvLines.join("\n");
  const outputPath = path.join(outputDir, `${ticker}.csv`);
  fs.writeFileSync(outputPath, csvContent);

  return result.rows.length;
}

async function main() {
  const args = process.argv.slice(2);
  let specificTicker: string | null = null;
  let outputDir = DEFAULT_OUTPUT_DIR;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--ticker" && args[i + 1]) {
      specificTicker = args[i + 1].toUpperCase();
      i++;
    } else if (args[i] === "--output-dir" && args[i + 1]) {
      outputDir = args[i + 1];
      i++;
    }
  }

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`Created output directory: ${outputDir}`);
  }

  console.log("=".repeat(60));
  console.log("FACTOR DATA EXPORT FOR OPTIMIZER");
  console.log("=".repeat(60));
  console.log(`Output directory: ${outputDir}`);
  console.log("");

  // Get tickers to export
  let tickers: string[];
  if (specificTicker) {
    tickers = [specificTicker];
    console.log(`Exporting single ticker: ${specificTicker}`);
  } else {
    tickers = await getMLReadyTickers();
    console.log(`Found ${tickers.length} ML-ready tickers`);
  }
  console.log("");

  // Export each ticker
  let successCount = 0;
  let totalRows = 0;
  const results: { ticker: string; rows: number }[] = [];

  for (const ticker of tickers) {
    try {
      const rows = await exportTickerFactors(ticker, outputDir);
      if (rows > 0) {
        console.log(`  [${ticker}] Exported ${rows} rows`);
        successCount++;
        totalRows += rows;
        results.push({ ticker, rows });
      }
    } catch (error: any) {
      console.error(`  [${ticker}] Error: ${error.message}`);
    }
  }

  console.log("");
  console.log("=".repeat(60));
  console.log("EXPORT SUMMARY");
  console.log("=".repeat(60));
  console.log(`Tickers exported: ${successCount}/${tickers.length}`);
  console.log(`Total rows: ${totalRows.toLocaleString()}`);
  console.log(`Output directory: ${outputDir}`);
  console.log("");

  // Show tickers with sufficient history for optimization (36+ months)
  const optimizableCount = results.filter(r => r.rows >= 36).length;
  console.log(`Tickers with 36+ months history (optimizable): ${optimizableCount}`);
  console.log("");

  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
