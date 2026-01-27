#!/usr/bin/env tsx
/**
 * Import fundamental data for newly added OSE stocks
 * - Fetches company overview from IBKR
 * - Updates stocks table with company names
 * - Inserts fundamentals into fundamentals_snapshot table
 */

import { FundamentalsClient, FundamentalsReportType } from "../packages/ibkr/src/fundamentals-client";
import { FundamentalsParser } from "../packages/ibkr/src/fundamentals-parser";
import { SecType } from "@stoqey/ib";
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});

// New tickers to import (from discovery script)
const NEW_TICKERS = [
  "NONG", "PARB", "AKSO", "BWO", "SOFF", "BONHR", "ODF", "HUNT", "KCC", "KID",
  "AKVA", "MULTI", "PHO", "NEXT", "IDEX", "OTEC", "PEXIP", "PCIB", "MEDI", "GSF",
  "ENDUR", "KMCP", "BOUV", "ABG", "NORBT", "NEL", "NAPA", "KOA", "2020", "ABL",
  "ARCH", "AKAST"
];

async function updateStockName(ticker: string, name: string, sector?: string): Promise<void> {
  await pool.query(`
    UPDATE stocks SET
      name = $2,
      sector = COALESCE($3, sector),
      updated_at = NOW()
    WHERE ticker = $1
  `, [ticker, name, sector || null]);
}

async function insertFundamentalsSnapshot(
  ticker: string,
  data: {
    peRatio?: number;
    pbRatio?: number;
    dividendYield?: number;
    marketCap?: number;
    sharesOutstanding?: number;
    evEbitda?: number;
    revenueTTM?: number;
    ebitdaTTM?: number;
  }
): Promise<void> {
  await pool.query(`
    INSERT INTO fundamentals_snapshot (
      ticker, as_of_date, pe_ratio, pb_ratio, dividend_yield,
      market_cap, shares_outstanding, ev_ebitda, revenue_ttm, ebitda_ttm, source
    ) VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8, $9, 'ibkr')
    ON CONFLICT (ticker, as_of_date, source) DO UPDATE SET
      pe_ratio = EXCLUDED.pe_ratio,
      pb_ratio = EXCLUDED.pb_ratio,
      dividend_yield = EXCLUDED.dividend_yield,
      market_cap = EXCLUDED.market_cap,
      shares_outstanding = EXCLUDED.shares_outstanding,
      ev_ebitda = EXCLUDED.ev_ebitda,
      revenue_ttm = EXCLUDED.revenue_ttm,
      ebitda_ttm = EXCLUDED.ebitda_ttm
  `, [
    ticker,
    data.peRatio || null,
    data.pbRatio || null,
    data.dividendYield || null,
    data.marketCap || null,
    data.sharesOutstanding || null,
    data.evEbitda || null,
    data.revenueTTM || null,
    data.ebitdaTTM || null,
  ]);
}

async function main() {
  console.log(`Importing fundamental data for ${NEW_TICKERS.length} new stocks...\n`);

  const client = new FundamentalsClient();
  const parser = new FundamentalsParser();

  const results: { ticker: string; success: boolean; name?: string; error?: string }[] = [];

  try {
    await client.connect();
    console.log("[OK] Connected to IB Gateway\n");

    for (let i = 0; i < NEW_TICKERS.length; i++) {
      const ticker = NEW_TICKERS[i];
      console.log(`[${i + 1}/${NEW_TICKERS.length}] Processing ${ticker}...`);

      try {
        // Fetch company overview
        const xml = await client.fetchFundamentalReport(
          ticker,
          "OSE",
          FundamentalsReportType.COMPANY_OVERVIEW,
          SecType.STK,
          "NOK"
        );

        // Parse the data
        const data = parser.parseCompanyOverview(xml);

        // Update stock name
        await updateStockName(ticker, data.companyName, data.sector);

        // Insert fundamentals snapshot
        await insertFundamentalsSnapshot(ticker, {
          peRatio: data.peRatio,
          pbRatio: data.priceToBook,
          dividendYield: data.dividendYield,
          marketCap: data.marketCap,
          sharesOutstanding: data.sharesOutstanding,
          revenueTTM: data.revenue,
          ebitdaTTM: data.ebitda,
        });

        results.push({ ticker, success: true, name: data.companyName });
        console.log(`  [OK] ${data.companyName}`);
        console.log(`       Sector: ${data.sector || "N/A"}`);
        console.log(`       Market Cap: ${data.marketCap ? (data.marketCap / 1e9).toFixed(2) + "B NOK" : "N/A"}`);
        console.log(`       P/E: ${data.peRatio?.toFixed(2) || "N/A"}\n`);

      } catch (e: any) {
        results.push({ ticker, success: false, error: e.message });
        console.log(`  [FAILED] ${e.message}\n`);
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Summary
    console.log("=".repeat(70));
    console.log("FUNDAMENTALS IMPORT SUMMARY");
    console.log("=".repeat(70));

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log(`Total: ${NEW_TICKERS.length}`);
    console.log(`Successful: ${successful.length}`);
    console.log(`Failed: ${failed.length}`);

    if (successful.length > 0) {
      console.log("\nSuccessfully imported:");
      successful.forEach(r => console.log(`  - ${r.ticker}: ${r.name}`));
    }

    if (failed.length > 0) {
      console.log("\nFailed:");
      failed.forEach(r => console.log(`  - ${r.ticker}: ${r.error}`));
    }

  } catch (error: any) {
    console.error("[ERROR]", error.message);
  } finally {
    await client.disconnect();
    await pool.end();
  }
}

main();
