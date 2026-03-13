/**
 * Aggregate Harvest Quarterly Estimates
 *
 * Two estimation methods combined:
 * 1. Model-based: Historical same-quarter average with YoY trend
 * 2. AIS-tracked: Raw wellboat trip volumes (supplementary)
 *
 * For each company/quarter:
 *   EST.VOL = avg of same-quarter actuals from prior years × (1 + YoY growth)
 *   AIS.VOL = sum of tracked trip volumes (for coverage monitoring)
 *
 * Run: npx tsx scripts/aggregate-harvest-estimates.ts [--dry-run]
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import pg from "pg";
const { Pool } = pg;
const connStr = (process.env.DATABASE_URL || "").trim().replace(/^["']|["']$/g, "").replace(/[?&]sslmode=\w+/g, "");
const pool = new Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false } });

const DRY_RUN = process.argv.includes("--dry-run");

const COMPANY_NAMES: Record<string, string> = {
  MOWI: "Mowi ASA",
  SALM: "SalMar ASA",
  LSG: "Lerøy Seafood Group ASA",
  GSF: "Grieg Seafood ASA",
  BAKKA: "Bakkafrost ASA",
  AUSS: "Austevoll Seafood ASA",
};

const TICKERS = Object.keys(COMPANY_NAMES);

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  Aggregate Harvest Quarterly Estimates (v2)");
  console.log("═══════════════════════════════════════════════════\n");
  if (DRY_RUN) console.log("(DRY RUN)\n");

  // 1. Load all historical actuals from salmon_quarterly_ops
  const { rows: allOps } = await pool.query(`
    SELECT ticker, year, quarter,
           harvest_tonnes_gwt::float AS harvest,
           price_realization_per_kg::float AS price
    FROM salmon_quarterly_ops
    ORDER BY ticker, year, quarter
  `);

  // Build lookup: ticker → { quarter → [{ year, harvest, price }] }
  const opsMap: Record<string, Record<number, { year: number; harvest: number | null; price: number | null }[]>> = {};
  for (const r of allOps) {
    if (!opsMap[r.ticker]) opsMap[r.ticker] = {};
    if (!opsMap[r.ticker][r.quarter]) opsMap[r.ticker][r.quarter] = [];
    opsMap[r.ticker][r.quarter].push({ year: r.year, harvest: r.harvest, price: r.price });
  }

  // 2. Load AIS trip aggregates
  const { rows: aisAggs } = await pool.query(`
    SELECT origin_ticker AS ticker,
           EXTRACT(YEAR FROM departure_time)::int AS year,
           EXTRACT(QUARTER FROM departure_time)::int AS quarter,
           COUNT(*)::int AS trip_count,
           SUM(estimated_volume_tonnes)::float AS ais_volume,
           CASE
             WHEN SUM(CASE WHEN spot_price_at_harvest IS NOT NULL THEN estimated_volume_tonnes ELSE 0 END) > 0
             THEN SUM(COALESCE(spot_price_at_harvest, 0) * estimated_volume_tonnes) /
                  NULLIF(SUM(CASE WHEN spot_price_at_harvest IS NOT NULL THEN estimated_volume_tonnes ELSE 0 END), 0)
             ELSE NULL
           END::float AS vwap_price
    FROM harvest_trips
    WHERE origin_ticker IS NOT NULL
    GROUP BY origin_ticker, EXTRACT(YEAR FROM departure_time), EXTRACT(QUARTER FROM departure_time)
    ORDER BY year DESC, quarter DESC, ticker
  `);

  // Build AIS lookup: ticker-year-quarter → { trip_count, ais_volume, vwap_price }
  const aisMap: Record<string, { trip_count: number; ais_volume: number; vwap_price: number | null }> = {};
  for (const r of aisAggs) {
    aisMap[`${r.ticker}-${r.year}-${r.quarter}`] = {
      trip_count: r.trip_count,
      ais_volume: r.ais_volume,
      vwap_price: r.vwap_price,
    };
  }

  // 3. Determine which quarters to estimate
  //    All quarters with AIS data + current quarter for all tickers
  const now = new Date();
  const curYear = now.getFullYear();
  const curQuarter = Math.ceil((now.getMonth() + 1) / 3);

  // Collect all unique (ticker, year, quarter) combinations we need
  const combos = new Set<string>();
  for (const r of aisAggs) combos.add(`${r.ticker}-${r.year}-${r.quarter}`);
  for (const tk of TICKERS) combos.add(`${tk}-${curYear}-${curQuarter}`);
  // Also add recent quarters from actuals for historical comparison
  for (const r of allOps) {
    if (r.year >= curYear - 1) combos.add(`${r.ticker}-${r.year}-${r.quarter}`);
  }

  console.log(`Processing ${combos.size} company/quarter combinations\n`);
  console.log(`${"TICKER".padEnd(7)} ${"QTR".padEnd(8)} ${"MODEL EST".padEnd(12)} ${"AIS TRACK".padEnd(12)} ${"ACTUAL".padEnd(12)} ${"ACC".padEnd(8)}`);
  console.log("─".repeat(65));

  for (const combo of Array.from(combos).sort()) {
    const [ticker, yearStr, quarterStr] = combo.split("-");
    const year = parseInt(yearStr);
    const quarter = parseInt(quarterStr);
    const companyName = COMPANY_NAMES[ticker] || ticker;

    // Get historical same-quarter data for this company
    const sameQHistory = (opsMap[ticker]?.[quarter] || [])
      .filter(h => h.harvest != null && h.harvest > 0 && h.year < year)
      .sort((a, b) => b.year - a.year); // most recent first

    // Calculate model-based estimate
    let modelEstimate: number | null = null;
    let estPrice: number | null = null;

    if (sameQHistory.length >= 2) {
      // Use last 2 years same-quarter average with YoY trend
      const recent = sameQHistory[0].harvest!;
      const prior = sameQHistory[1].harvest!;
      const yoyGrowth = (recent - prior) / prior;
      // Cap growth at ±30% to avoid extreme extrapolation
      const cappedGrowth = Math.max(-0.3, Math.min(0.3, yoyGrowth));
      modelEstimate = Math.round(recent * (1 + cappedGrowth));
    } else if (sameQHistory.length === 1) {
      // Only one prior year — use it directly
      modelEstimate = Math.round(sameQHistory[0].harvest!);
    }

    // Price estimate: use Fish Pool VWAP from AIS tracking if available,
    // otherwise use average of same-quarter historical prices
    const aisData = aisMap[combo];
    estPrice = aisData?.vwap_price ?? null;
    if (!estPrice && sameQHistory.length > 0) {
      const prices = sameQHistory.filter(h => h.price != null && h.price > 10).map(h => h.price!);
      if (prices.length > 0) estPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    }

    // Get actual data
    const actualRow = allOps.find(r => r.ticker === ticker && r.year === year && r.quarter === quarter);
    const actualVolume = actualRow?.harvest || null;
    const actualPrice = actualRow?.price || null;

    // Calculate accuracy (model estimate vs actual)
    let accuracyPct: number | null = null;
    if (actualVolume && actualVolume > 0 && modelEstimate && modelEstimate > 0) {
      accuracyPct = ((modelEstimate - actualVolume) / actualVolume) * 100;
    }

    const label = `${ticker.padEnd(7)} Q${quarter} ${year}`;
    const mEst = modelEstimate ? `${(modelEstimate / 1000).toFixed(1)}kt` : "—";
    const aVol = aisData ? `${(aisData.ais_volume / 1000).toFixed(1)}kt` : "—";
    const actVol = actualVolume ? `${(actualVolume / 1000).toFixed(1)}kt` : "—";
    const accStr = accuracyPct != null ? `${accuracyPct > 0 ? "+" : ""}${accuracyPct.toFixed(1)}%` : "—";

    console.log(`  ${label}  ${mEst.padEnd(12)} ${aVol.padEnd(12)} ${actVol.padEnd(12)} ${accStr}`);

    if (!DRY_RUN) {
      await pool.query(
        `INSERT INTO harvest_quarterly_estimates
          (ticker, company_name, year, quarter, estimated_harvest_tonnes,
           trip_count, estimated_avg_price_nok,
           actual_harvest_tonnes, actual_price_realization, estimation_accuracy_pct, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
         ON CONFLICT (ticker, year, quarter) DO UPDATE SET
           estimated_harvest_tonnes = EXCLUDED.estimated_harvest_tonnes,
           trip_count = EXCLUDED.trip_count,
           estimated_avg_price_nok = EXCLUDED.estimated_avg_price_nok,
           actual_harvest_tonnes = EXCLUDED.actual_harvest_tonnes,
           actual_price_realization = EXCLUDED.actual_price_realization,
           estimation_accuracy_pct = EXCLUDED.estimation_accuracy_pct,
           updated_at = NOW()`,
        [
          ticker, companyName, year, quarter,
          modelEstimate,
          aisData?.trip_count || 0,
          estPrice ? parseFloat(estPrice.toFixed(2)) : null,
          actualVolume ? Math.round(actualVolume) : null,
          actualPrice ? parseFloat(actualPrice.toFixed(2)) : null,
          accuracyPct != null ? parseFloat(accuracyPct.toFixed(2)) : null,
        ]
      );
    }
  }

  console.log("\nDone.");
  await pool.end();
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
