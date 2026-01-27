#!/usr/bin/env tsx
/**
 * Fetch FX Rates from Interactive Brokers
 *
 * Fetches daily FX spot rates for NOK/USD, NOK/EUR, NOK/GBP
 * Stores in fx_spot_rates table
 *
 * Usage: tsx scripts/fx/fetch-fx-rates.ts [--backfill DAYS]
 */

import { IBKRClient } from "../../packages/ibkr/src/client";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const FX_PAIRS = [
  { pair: 'NOKUSD', symbol: 'USD.NOK', exchange: 'IDEALPRO' },
  { pair: 'NOKEUR', symbol: 'EUR.NOK', exchange: 'IDEALPRO' },
  { pair: 'NOKGBP', symbol: 'GBP.NOK', exchange: 'IDEALPRO' },
];

interface FXRate {
  pair: string;
  date: string;
  spot: number;
  source: string;
}

async function fetchFXRatesFromIBKR(days: number = 5): Promise<FXRate[]> {
  console.log(`Fetching FX rates for last ${days} days...`);

  const client = new IBKRClient({
    baseUrl: process.env.IBKR_API_URL || 'https://localhost:4002',
  });

  const allRates: FXRate[] = [];

  for (const { pair, symbol, exchange } of FX_PAIRS) {
    try {
      console.log(`\nFetching ${pair} (${symbol})...`);

      // Search for contract
      const contract = await client.searchContract(symbol, exchange);
      if (!contract) {
        console.error(`Contract not found: ${symbol}`);
        continue;
      }

      console.log(`Found contract: ${contract.conid} - ${contract.description}`);

      // Fetch historical data
      const data = await client.getHistoricalData(
        contract.conid,
        `${days}d`,
        '1d'
      );

      if (!data || !data.data || data.data.length === 0) {
        console.error(`No data returned for ${pair}`);
        continue;
      }

      // Convert to FX rate format
      for (const bar of data.data) {
        const date = new Date(bar.t);
        allRates.push({
          pair,
          date: date.toISOString().slice(0, 10),
          spot: bar.c, // Use close price as spot
          source: 'ibkr',
        });
      }

      console.log(`Fetched ${data.data.length} bars for ${pair}`);
    } catch (error) {
      console.error(`Error fetching ${pair}:`, error);
    }
  }

  return allRates;
}

async function storeFXRates(rates: FXRate[]): Promise<void> {
  console.log(`\nStoring ${rates.length} FX rates in database...`);

  const query = `
    INSERT INTO fx_spot_rates (currency_pair, date, spot_rate, mid, source, inserted_at)
    VALUES ($1, $2, $3, $3, $4, NOW())
    ON CONFLICT (currency_pair, date, source) DO UPDATE SET
      spot_rate = EXCLUDED.spot_rate,
      mid = EXCLUDED.mid,
      inserted_at = NOW()
  `;

  let inserted = 0;
  let updated = 0;

  for (const rate of rates) {
    try {
      const result = await pool.query(query, [
        rate.pair,
        rate.date,
        rate.spot,
        rate.source,
      ]);

      if (result.rowCount && result.rowCount > 0) {
        inserted++;
      } else {
        updated++;
      }
    } catch (error) {
      console.error(`Error storing rate for ${rate.pair} on ${rate.date}:`, error);
    }
  }

  console.log(`Inserted: ${inserted}, Updated: ${updated}`);
}

async function main() {
  try {
    const args = process.argv.slice(2);
    let days = 5;

    if (args.includes('--backfill')) {
      const idx = args.indexOf('--backfill');
      days = parseInt(args[idx + 1]) || 30;
    }

    console.log('FX Rates Fetcher');
    console.log('================\n');

    const rates = await fetchFXRatesFromIBKR(days);

    if (rates.length === 0) {
      console.error('No rates fetched. Exiting.');
      process.exit(1);
    }

    await storeFXRates(rates);

    // Verify data
    const verifyQuery = `
      SELECT currency_pair, COUNT(*) as count, MAX(date) as latest_date
      FROM fx_spot_rates
      GROUP BY currency_pair
      ORDER BY currency_pair
    `;

    const result = await pool.query(verifyQuery);
    console.log('\nDatabase Summary:');
    console.table(result.rows);

    await pool.end();
    console.log('\nDone!');
  } catch (error) {
    console.error('Fatal error:', error);
    await pool.end();
    process.exit(1);
  }
}

main();
