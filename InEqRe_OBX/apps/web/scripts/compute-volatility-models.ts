#!/usr/bin/env tsx
/**
 * Compute Volatility Models — Daily Pre-computation Pipeline
 *
 * Calls the Python ML service for each ticker and stores results
 * in the `volatility_models` table so the frontend loads instantly.
 *
 * Models computed: GARCH(1,1), MSGARCH, VaR/CVaR, VaR Backtest, Jump Detection
 *
 * Prerequisites:
 *   - Python ML service running: cd ml-service && uvicorn app.main:app --port 8000
 *   - DATABASE_URL set
 *
 * Usage:
 *   npx tsx scripts/compute-volatility-models.ts              # All tickers
 *   npx tsx scripts/compute-volatility-models.ts --ticker=EQNR # Single ticker
 *   npx tsx scripts/compute-volatility-models.ts --force       # Recompute even if today's data exists
 */

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { pool } from "../src/lib/db";

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";
const LIMIT = 1260; // ~5 years of daily data

// ─── Helpers ──────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function getTickers(): Promise<string[]> {
  const result = await pool.query<{ ticker: string }>(`
    SELECT DISTINCT ticker
    FROM prices_daily
    WHERE close IS NOT NULL AND close > 0
    GROUP BY ticker
    HAVING COUNT(*) >= 100
    ORDER BY ticker
  `);
  return result.rows.map((r) => r.ticker);
}

async function hasResultToday(ticker: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM volatility_models WHERE ticker = $1 AND computed_date = $2 LIMIT 1`,
    [ticker, today()]
  );
  return result.rowCount !== null && result.rowCount > 0;
}

async function callMlService(ticker: string): Promise<any> {
  const url = `${ML_SERVICE_URL}/volatility/full/${encodeURIComponent(ticker)}?limit=${LIMIT}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(60000), // 60s per ticker
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ML service returned ${res.status}: ${text}`);
  }

  return res.json();
}

async function storeResult(ticker: string, data: any): Promise<void> {
  const hasGarch = !!(data.garch && !data.garch.error);
  const hasRegime = !!(data.regime && !data.regime.error);
  const hasVar = !!(data.var && !data.var.error);
  const hasJumps = !!(data.jumps && !data.jumps.error);
  const nObs = data.n_observations ?? null;

  await pool.query(
    `INSERT INTO volatility_models (ticker, computed_date, model_data, has_garch, has_regime, has_var, has_jumps, n_observations)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (ticker, computed_date)
     DO UPDATE SET
       model_data = EXCLUDED.model_data,
       has_garch = EXCLUDED.has_garch,
       has_regime = EXCLUDED.has_regime,
       has_var = EXCLUDED.has_var,
       has_jumps = EXCLUDED.has_jumps,
       n_observations = EXCLUDED.n_observations,
       created_at = now()`,
    [ticker, today(), JSON.stringify(data), hasGarch, hasRegime, hasVar, hasJumps, nObs]
  );
}

// ─── Main ─────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const tickerArg = args.find((a) => a.startsWith("--ticker="));
  const singleTicker = tickerArg?.split("=")[1]?.toUpperCase();

  // Check ML service health
  try {
    const healthRes = await fetch(`${ML_SERVICE_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!healthRes.ok) throw new Error("unhealthy");
    console.log(`[OK] ML service reachable at ${ML_SERVICE_URL}`);
  } catch {
    console.error(`[FATAL] ML service not reachable at ${ML_SERVICE_URL}`);
    console.error("  Start it: cd ml-service && uvicorn app.main:app --port 8000");
    process.exit(1);
  }

  const tickers = singleTicker ? [singleTicker] : await getTickers();
  console.log(`[INFO] Processing ${tickers.length} tickers (date: ${today()}, force: ${force})`);

  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (const ticker of tickers) {
    try {
      // Skip if already computed today (unless --force)
      if (!force && (await hasResultToday(ticker))) {
        skipped++;
        continue;
      }

      const data = await callMlService(ticker);
      await storeResult(ticker, data);
      success++;

      const models = [
        data.garch && !data.garch.error ? "GARCH" : null,
        data.regime && !data.regime.error ? "MSGARCH" : null,
        data.var && !data.var.error ? "VaR" : null,
        data.jumps && !data.jumps.error ? "Jumps" : null,
      ].filter(Boolean);
      console.log(`  [OK] ${ticker} — ${models.join(", ") || "no models"} (${data.n_observations} obs)`);
    } catch (e: any) {
      failed++;
      console.error(`  [FAIL] ${ticker} — ${e?.message ?? e}`);
    }
  }

  console.log(`\n[DONE] ${success} stored, ${skipped} skipped (already today), ${failed} failed`);

  await pool.end();
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
