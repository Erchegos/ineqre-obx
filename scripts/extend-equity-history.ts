#!/usr/bin/env tsx
/**
 * Extend historical data for all equities back to 2000 (or as far as IBKR has)
 *
 * This script:
 * 1. Gets all equities and their current start dates
 * 2. For each equity starting after 2000, fetches older data from IBKR
 * 3. Inserts only the missing historical data (before current start date)
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { IBApi, EventName, Contract, SecType, BarSizeSetting, WhatToShow } from "@stoqey/ib";
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: 'apps/web/.env.local' });

const GATEWAY_PORT = 4002;
const CLIENT_ID = 900;
const TARGET_START_DATE = new Date('2000-01-01');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

interface EquityInfo {
  ticker: string;
  name: string;
  currentStartDate: Date;
  rows: number;
}

interface PriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function getEquitiesNeedingHistory(): Promise<EquityInfo[]> {
  const result = await pool.query(`
    SELECT s.ticker, s.name, MIN(p.date) as current_start, COUNT(*) as rows
    FROM stocks s
    JOIN prices_daily p ON s.ticker = p.ticker
    WHERE s.asset_type = 'equity'
    GROUP BY s.ticker, s.name
    HAVING MIN(p.date) > '2000-01-01'
    ORDER BY s.ticker
  `);

  return result.rows.map(r => ({
    ticker: r.ticker,
    name: r.name,
    currentStartDate: new Date(r.current_start),
    rows: parseInt(r.rows)
  }));
}

async function searchContract(api: IBApi, ticker: string): Promise<number | null> {
  return new Promise((resolve) => {
    const reqId = Math.floor(Math.random() * 10000);
    let conId: number | null = null;

    const timeout = setTimeout(() => {
      resolve(null);
    }, 8000);

    api.on(EventName.contractDetails, (id, details) => {
      if (id === reqId && details.contract.conId) {
        conId = details.contract.conId;
      }
    });

    api.on(EventName.contractDetailsEnd, (id) => {
      if (id === reqId) {
        clearTimeout(timeout);
        resolve(conId);
      }
    });

    api.on(EventName.error, (id, code, msg) => {
      if (id === reqId && code !== 2104 && code !== 2106 && code !== 2158) {
        if (code === 200) {
          // No security definition found
          clearTimeout(timeout);
          resolve(null);
        }
      }
    });

    const contract: Contract = {
      symbol: ticker,
      secType: SecType.STK,
      exchange: "OSE",
      currency: "NOK",
    };

    api.reqContractDetails(reqId, contract);
  });
}

async function fetchHistoricalData(
  api: IBApi,
  conId: number,
  ticker: string,
  endDate: string,  // Format: YYYYMMDD HH:MM:SS
  duration: string
): Promise<PriceBar[]> {
  return new Promise((resolve) => {
    const reqId = Math.floor(Math.random() * 10000);
    const bars: PriceBar[] = [];

    const timeout = setTimeout(() => {
      resolve(bars);
    }, 30000);

    api.on(EventName.historicalData, (id, date, open, high, low, close, volume) => {
      if (id === reqId && date && !date.includes("finished") && /^\d{8}$/.test(date)) {
        bars.push({
          date: date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
          open,
          high,
          low,
          close,
          volume: Math.round(volume)  // Round volume to integer
        });
      }
    });

    api.on(EventName.historicalDataEnd, (id) => {
      if (id === reqId) {
        clearTimeout(timeout);
        resolve(bars);
      }
    });

    api.on(EventName.error, (id, code, msg) => {
      if (id === reqId) {
        if (code === 162) {
          // No data available
          clearTimeout(timeout);
          resolve(bars);
        } else if (code !== 2104 && code !== 2106 && code !== 2158) {
          console.log(`    Error ${code} for ${ticker}: ${msg}`);
        }
      }
    });

    const contract: Contract = {
      conId,
      symbol: ticker,
      secType: SecType.STK,
      exchange: "OSE",
      currency: "NOK",
    };

    api.reqHistoricalData(
      reqId,
      contract,
      endDate,
      duration,
      BarSizeSetting.DAYS_ONE,
      WhatToShow.TRADES,
      1,  // Use RTH
      1,  // Format date as string
      false
    );
  });
}

async function insertPriceData(ticker: string, bars: PriceBar[], beforeDate: Date): Promise<number> {
  let inserted = 0;
  let errors = 0;

  for (const bar of bars) {
    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bar.date)) continue;

    const barDate = new Date(bar.date);
    if (isNaN(barDate.getTime())) continue;

    // Only insert data before the current start date
    if (barDate >= beforeDate) continue;

    try {
      await pool.query(`
        INSERT INTO prices_daily (ticker, date, open, high, low, close, volume)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (ticker, date) DO NOTHING
      `, [ticker, bar.date, bar.open, bar.high, bar.low, bar.close, Math.round(bar.volume)]);
      inserted++;
    } catch (e: any) {
      errors++;
      // Only log first few errors per ticker
      if (errors <= 3 && !e.message.includes('duplicate')) {
        console.error(`    Insert error: ${e.message}`);
      }
    }
  }

  return inserted;
}

async function main() {
  console.log("=== Extend Equity Historical Data ===\n");
  console.log("Target: Data back to 2000 (or as far as IBKR has)\n");

  // Get equities needing more history
  const equities = await getEquitiesNeedingHistory();
  console.log(`Found ${equities.length} equities with data starting after 2000\n`);

  // Connect to IBKR
  console.log("Connecting to IB Gateway...");
  const api = new IBApi({ port: GATEWAY_PORT, clientId: CLIENT_ID });

  await new Promise<void>((resolve, reject) => {
    api.on(EventName.connected, () => {
      console.log("Connected to IB Gateway\n");
      resolve();
    });
    api.on(EventName.error, (id, code, msg) => {
      if (code === 502 || code === 504) {
        reject(new Error(`Connection failed: ${msg}`));
      }
    });
    api.connect();
    setTimeout(() => reject(new Error("Connection timeout")), 15000);
  });

  let totalInserted = 0;
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const equity of equities) {
    processed++;
    const progress = `[${processed}/${equities.length}]`;

    console.log(`${progress} ${equity.ticker} - Current start: ${equity.currentStartDate.toISOString().slice(0, 10)}`);

    // Find contract
    const conId = await searchContract(api, equity.ticker);

    if (!conId) {
      console.log(`    Skipped: Contract not found on OSE`);
      skipped++;
      await new Promise(r => setTimeout(r, 500));
      continue;
    }

    // Calculate how much history to request
    // Request data ending at current start date
    const endDate = equity.currentStartDate.toISOString().slice(0, 10).replace(/-/g, '') + " 23:59:59";

    // Calculate years needed (from 2000 to current start)
    const yearsNeeded = equity.currentStartDate.getFullYear() - 2000;

    if (yearsNeeded <= 0) {
      console.log(`    Skipped: Already has data from ${equity.currentStartDate.getFullYear()}`);
      skipped++;
      continue;
    }

    // IBKR max duration is about 20 years for daily data
    const duration = Math.min(yearsNeeded + 1, 20) + " Y";

    console.log(`    Fetching ${duration} of history (conId: ${conId})...`);

    try {
      const bars = await fetchHistoricalData(api, conId, equity.ticker, endDate, duration);

      if (bars.length === 0) {
        console.log(`    No additional history available`);
        failed++;
      } else {
        const firstDate = bars[0]?.date;
        const lastDate = bars[bars.length - 1]?.date;
        console.log(`    Received ${bars.length} bars (${firstDate} to ${lastDate})`);

        // Insert only data before current start
        const inserted = await insertPriceData(equity.ticker, bars, equity.currentStartDate);
        totalInserted += inserted;
        console.log(`    Inserted ${inserted} new rows`);
      }
    } catch (e: any) {
      console.log(`    Error: ${e.message}`);
      failed++;
    }

    // Rate limit to avoid IBKR pacing violations
    await new Promise(r => setTimeout(r, 2500));
  }

  api.disconnect();

  console.log("\n=== Summary ===");
  console.log(`Processed: ${processed} equities`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total new rows inserted: ${totalInserted}`);

  await pool.end();
  process.exit(0);
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
