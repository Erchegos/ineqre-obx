#!/usr/bin/env node
/**
 * Fetch FX Rates from Norges Bank API (Free, No API Key Required)
 *
 * Fetches daily FX spot rates for NOK/USD, NOK/EUR, NOK/GBP
 * Uses official Norges Bank exchange rates
 *
 * Usage: npx tsx scripts/fx/fetch-fx-rates-fixer.ts [--backfill DAYS]
 */

import { Pool } from "pg";

// Remove sslmode parameter from connection string - we'll handle SSL in config
const connectionString = (process.env.DATABASE_URL || '').replace(/[?&]sslmode=\w+/g, '');

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

interface NorgesBankRate {
  date: string;
  USD: number;
  EUR: number;
  GBP: number;
}

async function fetchFromNorgesBank(days: number = 252): Promise<NorgesBankRate[]> {
  console.log(`Fetching FX rates from Norges Bank for last ${days} days...`);

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const formatDate = (d: Date) => d.toISOString().split('T')[0];

  const url = `https://data.norges-bank.no/api/data/EXR/B.USD+EUR+GBP.NOK.SP?format=sdmx-json&startPeriod=${formatDate(startDate)}&endPeriod=${formatDate(endDate)}&locale=en`;

  console.log(`Fetching from: ${url.substring(0, 100)}...`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    // Parse Norges Bank SDMX-JSON format
    const observations = data.data.dataSets[0].series;
    const structure = data.data.structure.dimensions.observation[0].values;

    const ratesByDate: Map<string, Partial<NorgesBankRate>> = new Map();

    // Process each currency series
    Object.keys(observations).forEach((seriesKey) => {
      const series = observations[seriesKey];
      const seriesIndex = parseInt(seriesKey.split(':')[1]);
      const currency = ['USD', 'EUR', 'GBP'][seriesIndex];

      Object.keys(series.observations).forEach((obsIndex) => {
        const dateIndex = parseInt(obsIndex);
        const date = structure[dateIndex].id;
        const rate = series.observations[obsIndex][0];

        if (!ratesByDate.has(date)) {
          ratesByDate.set(date, { date });
        }

        const entry = ratesByDate.get(date)!;
        entry[currency as 'USD' | 'EUR' | 'GBP'] = rate;
      });
    });

    // Convert to array and filter complete records
    const rates: NorgesBankRate[] = Array.from(ratesByDate.values())
      .filter((r) => r.USD && r.EUR && r.GBP)
      .map((r) => ({
        date: r.date!,
        USD: r.USD!,
        EUR: r.EUR!,
        GBP: r.GBP!,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    console.log(`Fetched ${rates.length} complete trading days`);
    return rates;
  } catch (error) {
    console.error('Error fetching from Norges Bank:', error);
    throw error;
  }
}

async function storeFXRates(rates: NorgesBankRate[]): Promise<void> {
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

  for (const rate of rates) {
    for (const [currency, value] of Object.entries(rate)) {
      if (currency === 'date') continue;

      const pair = `NOK${currency}`;

      try {
        await pool.query(query, [pair, rate.date, value, 'norges_bank']);
        inserted++;
      } catch (error) {
        console.error(`Error storing ${pair} on ${rate.date}:`, error);
      }
    }
  }

  console.log(`Stored ${inserted} FX rates`);
}

async function main() {
  try {
    const args = process.argv.slice(2);
    let days = 252;

    if (args.includes('--backfill')) {
      const idx = args.indexOf('--backfill');
      days = parseInt(args[idx + 1]) || 252;
    }

    console.log('FX Rates Fetcher - Norges Bank');
    console.log('===============================\n');

    const rates = await fetchFromNorgesBank(days);

    if (rates.length === 0) {
      console.error('No rates fetched. Exiting.');
      process.exit(1);
    }

    await storeFXRates(rates);

    // Verify data
    const verifyQuery = `
      SELECT
        currency_pair,
        COUNT(*) as count,
        MIN(date) as earliest,
        MAX(date) as latest,
        ROUND(AVG(spot_rate)::numeric, 4) as avg_rate
      FROM fx_spot_rates
      WHERE source = 'norges_bank'
      GROUP BY currency_pair
      ORDER BY currency_pair
    `;

    const result = await pool.query(verifyQuery);
    console.log('\nDatabase Summary (Norges Bank):');
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
