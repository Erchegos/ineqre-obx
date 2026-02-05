#!/usr/bin/env node
/**
 * Backfill recent missing days using Yahoo Finance v8 chart API for ALL tickers
 * Usage: node scripts/backfill-yahoo.mjs
 */

import { spawn } from 'child_process';
import pg from 'pg';
import { readFileSync } from 'fs';

const { Pool } = pg;

// Load .env.local
const envContent = readFileSync('.env.local', 'utf-8');
const dbUrl = envContent.match(/DATABASE_URL="([^"]+)"/)?.[1];

const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false }
});

// Complete mapping: DB ticker → Yahoo Finance ticker
const STOCKS = {
  // --- Norwegian Equities (Oslo Børs: .OL suffix) ---
  '2020': '2020.OL',
  'ABG': 'ABG.OL',
  'ABL': 'ABL.OL',
  'AFG': 'AFG.OL',
  'AKAST': 'AKAST.OL',
  'AKER': 'AKER.OL',
  'AKRBP': 'AKRBP.OL',
  'AKSO': 'AKSO.OL',
  'AKVA': 'AKVA.OL',
  'ARCH': 'ARCH.OL',
  'ATEA': 'ATEA.OL',
  'AUSS': 'AUSS.OL',
  'AUTO': 'AUTO.OL',
  'BAKKA': 'BAKKA.OL',
  'BONHR': 'BONHR.OL',
  'BOUV': 'BOUV.OL',
  'BRG': 'BRG.OL',
  'BWLPG': 'BWLPG.OL',
  'BWO': 'BWO.OL',
  'CADLR': 'CADLR.OL',
  'CMBTO': 'CMBTO.OL',
  'DNB': 'DNB.OL',
  'DOFG': 'DOFG.OL',
  'ELK': 'ELK.OL',
  'ENDUR': 'ENDUR.OL',
  'ENTRA': 'ENTRA.OL',
  'EQNR': 'EQNR.OL',
  'FRO': 'FRO.OL',
  'GJF': 'GJF.OL',
  'GSF': 'GSF.OL',
  'HAFNI': 'HAFNI.OL',
  'HAUTO': 'HAUTO.OL',
  'HAVI': 'HAVI.OL',
  'HEX': 'HEX.OL',
  'HUNT': 'HUNT.OL',
  'IDEX': 'IDEX.OL',
  'KCC': 'KCC.OL',
  'KID': 'KID.OL',
  'KIT': 'KIT.OL',
  'KMCP': 'KMCP.OL',
  'KOA': 'KOA.OL',
  'KOG': 'KOG.OL',
  'LSG': 'LSG.OL',
  'MEDI': 'MEDI.OL',
  'MING': 'MING.OL',
  'MOWI': 'MOWI.OL',
  'MPCC': 'MPCC.OL',
  'MULTI': 'MULTI.OL',
  'NAPA': 'NAPA.OL',
  'NAS': 'NAS.OL',
  'NEL': 'NEL.OL',
  'NEXT': 'NEXT.OL',
  'NHY': 'NHY.OL',
  'NOD': 'NOD.OL',
  'NONG': 'NONG.OL',
  'NORBT': 'NORBT.OL',
  'OBX': 'OBX.OL',
  'ODF': 'ODF.OL',
  'ODL': 'ODL.OL',
  'OET': 'OET.OL',
  'OLT': 'OLT.OL',
  'ORK': 'ORK.OL',
  'OTEC': 'OTEC.OL',
  'PARB': 'PARB.OL',
  'PCIB': 'PCIB.OL',
  'PEXIP': 'PEXIP.OL',
  'PHO': 'PHO.OL',
  'PROT': 'PROT.OL',
  'RECSI': 'RECSI.OL',
  'SALM': 'SALM.OL',
  'SB1NO': 'SB1NO.OL',
  'SCATC': 'SCATC.OL',
  'SNI': 'SNI.OL',
  'SOFF': 'SOFF.OL',
  'SPOL': 'SPOL.OL',
  'STB': 'STB.OL',
  'SUBC': 'SUBC.OL',
  'SWON': 'SWON.OL',
  'TECH': 'TECH.OL',
  'TEL': 'TEL.OL',
  'TGS': 'TGS.OL',
  'TIETO': 'TIETO.OL',
  'TOM': 'TOM.OL',
  'VAR': 'VAR.OL',
  'VEI': 'VEI.OL',
  'VEND': 'VEND.OL',
  'WAWI': 'WAWI.OL',
  'WWI': 'WWI.OL',
  'WWIB': 'WWIB.OL',
  'YAR': 'YAR.OL',

  // --- New tickers (2026-02-05) ---
  'DNO': 'DNO.OL',
  'BNOR': 'BNOR.OL',
  'ELO': 'ELO.OL',
  'EPR': 'EPR.OL',
  'GIGA': 'GIGA.OL',
  'HSHP': 'HSHP.OL',
  'LINK': 'LINK.OL',
  'NORCO': 'NCLH',
  'PEN': 'PEN.OL',
  'PLSV': 'PLSV.OL',

  // --- Dual-Listed US Stocks ---
  'BORR.US': 'BORR',
  'BWLP.US': 'BWLP',
  'CDLR': 'CDLR',
  'ECO.US': 'ECO',
  'EQNR.US': 'EQNR',
  'FLNG.US': 'FLNG',
  'FRO.US': 'FRO',
  'HAFN.US': 'HAFN',

  // --- US ETFs ---
  'COPX': 'COPX',
  'DBB': 'DBB',
  'DBC': 'DBC',
  'EFA': 'EFA',
  'EWD': 'EWD',
  'EWN': 'EWN',
  'GLD': 'GLD',
  'IWM': 'IWM',
  'NORW': 'NORW',
  'QQQ': 'QQQ',
  'SLV': 'SLV',
  'SPY': 'SPY',
  'USO': 'USO',
  'VGK': 'VGK',
  'XLE': 'XLE',
  'XOP': 'XOP',

  // --- Indexes ---
  'DAX': '^GDAXI',
  'ESTX50': '^STOXX50E',
  'NDX': '^NDX',
  'OSEAX': 'OSEAX.OL',
  'OSEBX': 'OSEBX.OL',
  'SPX': '^GSPC',
  'VIX': '^VIX',
};

/**
 * Fetch data using Yahoo Finance v8 chart API (no auth required)
 */
async function fetchYahooChart(yahooTicker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?range=1mo&interval=1d`;

  return new Promise((resolve, reject) => {
    const curl = spawn('curl', ['-s', '-L', '-H', 'User-Agent: Mozilla/5.0', url]);
    let data = '';

    curl.stdout.on('data', (chunk) => {
      data += chunk;
    });

    curl.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`curl failed with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error(`Failed to parse JSON: ${data.substring(0, 200)}`));
      }
    });
  });
}

/**
 * Parse Yahoo v8 chart response into price rows
 */
function parseChartData(json, ticker) {
  const result = json?.chart?.result?.[0];
  if (!result || !result.timestamp || !result.indicators?.quote?.[0]) {
    return [];
  }

  const timestamps = result.timestamp;
  const quote = result.indicators.quote[0];
  const adjClose = result.indicators.adjclose?.[0]?.adjclose;

  const prices = [];

  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    const d = new Date(ts * 1000);

    // Skip weekends
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;

    // Format date as YYYY-MM-DD
    const date = d.toISOString().slice(0, 10);

    const open = quote.open?.[i];
    const high = quote.high?.[i];
    const low = quote.low?.[i];
    const close = quote.close?.[i];
    const volume = quote.volume?.[i] ?? 0;
    const adj = adjClose?.[i] ?? close;

    // Skip if close is null/undefined (market was closed)
    if (close == null) continue;

    prices.push({
      ticker,
      date,
      open: open ?? close,
      high: high ?? close,
      low: low ?? close,
      close,
      adj_close: adj,
      volume
    });
  }

  return prices;
}

async function upsertPrices(prices) {
  let inserted = 0;
  let updated = 0;

  for (const price of prices) {
    try {
      const result = await pool.query(`
        INSERT INTO prices_daily (ticker, date, open, high, low, close, adj_close, volume, source)
        VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, 'yahoo')
        ON CONFLICT (ticker, date) DO UPDATE SET
          open = EXCLUDED.open,
          high = EXCLUDED.high,
          low = EXCLUDED.low,
          close = EXCLUDED.close,
          adj_close = EXCLUDED.adj_close,
          volume = EXCLUDED.volume,
          source = EXCLUDED.source
        RETURNING (xmax = 0) AS is_insert
      `, [
        price.ticker,
        price.date,
        price.open,
        price.high,
        price.low,
        price.close,
        price.adj_close,
        price.volume
      ]);

      if (result.rows[0]?.is_insert) {
        inserted++;
      } else {
        updated++;
      }
    } catch (err) {
      // Skip individual row errors silently
    }
  }

  return { inserted, updated };
}

async function main() {
  console.log('=== Backfilling ALL Tickers via Yahoo Finance v8 Chart API ===');
  console.log(`Total tickers to process: ${Object.keys(STOCKS).length}\n`);

  let totalInserted = 0;
  let totalUpdated = 0;
  let failed = [];
  let succeeded = 0;

  try {
    await pool.connect();
    console.log('Database connected\n');

    const entries = Object.entries(STOCKS);
    for (let i = 0; i < entries.length; i++) {
      const [ticker, yahooTicker] = entries[i];
      try {
        process.stdout.write(`[${i + 1}/${entries.length}] ${ticker.padEnd(10)} `);

        const json = await fetchYahooChart(yahooTicker);

        if (json?.chart?.error) {
          console.log(`ERROR: ${json.chart.error.description}`);
          failed.push({ ticker, reason: json.chart.error.description });
          continue;
        }

        const prices = parseChartData(json, ticker);

        if (prices.length === 0) {
          console.log('NO DATA');
          failed.push({ ticker, reason: 'no data returned' });
          continue;
        }

        const { inserted, updated } = await upsertPrices(prices);
        totalInserted += inserted;
        totalUpdated += updated;
        succeeded++;
        console.log(`+${inserted} new, ${updated} updated (${prices[0]?.date} → ${prices[prices.length - 1]?.date})`);

        // Small delay to be polite
        await new Promise(r => setTimeout(r, 200));
      } catch (error) {
        console.log(`ERROR: ${error.message}`);
        failed.push({ ticker, reason: error.message });
      }
    }

    console.log('\n=== SUMMARY ===');
    console.log(`Succeeded: ${succeeded}/${entries.length}`);
    console.log(`Total inserted: ${totalInserted}`);
    console.log(`Total updated: ${totalUpdated}`);
    if (failed.length > 0) {
      console.log(`\nFailed tickers (${failed.length}):`);
      failed.forEach(f => console.log(`  ${f.ticker}: ${f.reason}`));
    }
    console.log('\nBackfill complete!');
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
