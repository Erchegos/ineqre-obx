#!/usr/bin/env node
/**
 * fix-ohlc-spikes.mjs — Detect and fix erroneous OHLC spikes by cross-checking with Yahoo Finance
 *
 * A "spike" is a day where the high or low is far from both open AND close,
 * but open ≈ close (small body). This pattern indicates bad data, not real volatility.
 *
 * Usage:
 *   node scripts/fix-ohlc-spikes.mjs              # Dry run (report only)
 *   node scripts/fix-ohlc-spikes.mjs --fix        # Fix confirmed bad data
 *   node scripts/fix-ohlc-spikes.mjs --ticker=STB # Single ticker
 *   node scripts/fix-ohlc-spikes.mjs --threshold=15  # Spike threshold % (default 15)
 */

import { spawn } from 'child_process';
import { createRequire } from 'module';
import { readFileSync } from 'fs';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { Pool } = pg;

// Load .env.local
const envContent = readFileSync('.env.local', 'utf-8');
const dbUrl = envContent.match(/DATABASE_URL="([^"]+)"/)?.[1];

const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false }
});

// Parse args
const args = process.argv.slice(2);
const doFix = args.includes('--fix');
const tickerArg = args.find(a => a.startsWith('--ticker='))?.split('=')[1];
const thresholdArg = args.find(a => a.startsWith('--threshold='))?.split('=')[1];
const SPIKE_THRESHOLD = parseFloat(thresholdArg || '15') / 100; // default 15%

// DB ticker → Yahoo ticker mapping (same as backfill-yahoo.mjs)
const YAHOO_MAP = {
  '2020': '2020.OL', 'ABG': 'ABG.OL', 'ABL': 'ABL.OL', 'AFG': 'AFG.OL',
  'AKAST': 'AKAST.OL', 'AKER': 'AKER.OL', 'AKRBP': 'AKRBP.OL', 'AKSO': 'AKSO.OL',
  'AKVA': 'AKVA.OL', 'ARCH': 'ARCH.OL', 'ATEA': 'ATEA.OL', 'AUSS': 'AUSS.OL',
  'AUTO': 'AUTO.OL', 'BAKKA': 'BAKKA.OL', 'BONHR': 'BONHR.OL', 'BOUV': 'BOUV.OL',
  'BRG': 'BRG.OL', 'BWLPG': 'BWLPG.OL', 'BWO': 'BWO.OL', 'CADLR': 'CADLR.OL',
  'CMBTO': 'CMBTO.OL', 'DNB': 'DNB.OL', 'DOFG': 'DOFG.OL', 'ELK': 'ELK.OL',
  'ENDUR': 'ENDUR.OL', 'ENTRA': 'ENTRA.OL', 'EQNR': 'EQNR.OL', 'FRO': 'FRO.OL',
  'GJF': 'GJF.OL', 'GSF': 'GSF.OL', 'HAFNI': 'HAFNI.OL', 'HAUTO': 'HAUTO.OL',
  'HAVI': 'HAVI.OL', 'HEX': 'HEX.OL', 'HUNT': 'HUNT.OL', 'IDEX': 'IDEX.OL',
  'KCC': 'KCC.OL', 'KID': 'KID.OL', 'KIT': 'KIT.OL', 'KMCP': 'KMCP.OL',
  'KOA': 'KOA.OL', 'KOG': 'KOG.OL', 'LSG': 'LSG.OL', 'MEDI': 'MEDI.OL',
  'MING': 'MING.OL', 'MOWI': 'MOWI.OL', 'MPCC': 'MPCC.OL', 'MULTI': 'MULTI.OL',
  'NAPA': 'NAPA.OL', 'NAS': 'NAS.OL', 'NEL': 'NEL.OL', 'NEXT': 'NEXT.OL',
  'NHY': 'NHY.OL', 'NOD': 'NOD.OL', 'NONG': 'NONG.OL', 'NORBT': 'NORBT.OL',
  'OBX': 'OBX.OL', 'ODF': 'ODF.OL', 'ODL': 'ODL.OL', 'OET': 'OET.OL',
  'OLT': 'OLT.OL', 'ORK': 'ORK.OL', 'OTEC': 'OTEC.OL', 'PARB': 'PARB.OL',
  'PCIB': 'PCIB.OL', 'PEXIP': 'PEXIP.OL', 'PHO': 'PHO.OL', 'PROT': 'PROT.OL',
  'RECSI': 'RECSI.OL', 'SALM': 'SALM.OL', 'SB1NO': 'SB1NO.OL', 'SCATC': 'SCATC.OL',
  'SNI': 'SNI.OL', 'SOFF': 'SOFF.OL', 'SPOL': 'SPOL.OL', 'STB': 'STB.OL',
  'SUBC': 'SUBC.OL', 'SWON': 'SWON.OL', 'TECH': 'TECH.OL', 'TEL': 'TEL.OL',
  'TGS': 'TGS.OL', 'TIETO': 'TIETO.OL', 'TOM': 'TOM.OL', 'VAR': 'VAR.OL',
  'VEI': 'VEI.OL', 'VEND': 'VEND.OL', 'WAWI': 'WAWI.OL', 'WWI': 'WWI.OL',
  'WWIB': 'WWIB.OL', 'YAR': 'YAR.OL', 'DNO': 'DNO.OL', 'BNOR': 'BNOR.OL',
  'ELO': 'ELO.OL', 'EPR': 'EPR.OL', 'GIGA': 'GIGA.OL', 'HSHP': 'HSHP.OL',
  'LINK': 'LINK.OL', 'NORCO': 'NORCO.OL', 'PEN': 'PEN.OL', 'PLSV': 'PLSV.OL',
  'ACR': 'ACR.OL', 'AFISH': 'AFISH.OL', 'AFK': 'AFK.OL', 'AGLX': 'AGLX.OL',
  'AKBM': 'AKBM.OL', 'ALNG': 'ALNG.OL', 'ANDF': 'ANDF.OL', 'APR': 'APR.OL',
  'ARR': 'ARR.OL', 'AURG': 'AURG.OL', 'AZT': 'AZT.OL', 'B2I': 'B2I.OL',
  'BELCO': 'BELCO.OL', 'BEWI': 'BEWI.OL', 'BIEN': 'BIEN.OL', 'BMA': 'BMA.OL',
  'BOR': 'BOR.OL', 'BRUT': 'BRUT.OL', 'BWE': 'BWE.OL', 'CAMBI': 'CAMBI.OL',
  'CLOUD': 'CLOUD.OL', 'CRNA': 'CRNA.OL', 'DELIA': 'DELIA.OL', 'DFENS': 'DFENS.OL',
  'DVD': 'DVD.OL', 'EIOF': 'EIOF.OL', 'ELIMP': 'ELIMP.OL', 'ELMRA': 'ELMRA.OL',
  'ENH': 'ENH.OL', 'ENSU': 'ENSU.OL', 'ENVIP': 'ENVIP.OL', 'GENT': 'GENT.OL',
  'GEOS': 'GEOS.OL', 'GKP': 'GKP.OL', 'GOGL': 'GOGL.OL', 'GRONG': 'GRONG.OL',
  'GYL': 'GYL.OL', 'HBC': 'HBC.OL', 'HDLY': 'HDLY.OL', 'HELG': 'HELG.OL',
  'HGSB': 'HGSB.OL', 'HKY': 'HKY.OL', 'INSTA': 'INSTA.OL', 'ISLAX': 'ISLAX.OL',
  'ITERA': 'ITERA.OL', 'IWS': 'IWS.OL', 'JAREN': 'JAREN.OL', 'JIN': 'JIN.OL',
  'KLDVK': 'KLDVK.OL', 'KOMPL': 'KOMPL.OL', 'KRAB': 'KRAB.OL', 'LUMI': 'LUMI.OL',
  'LYTIX': 'LYTIX.OL', 'MAS': 'MAS.OL', 'MELG': 'MELG.OL', 'MGN': 'MGN.OL',
  'MORG': 'MORG.OL', 'MORLD': 'MORLD.OL', 'NCOD': 'NCOD.OL', 'NKR': 'NKR.OL',
  'NOAP': 'NOAP.OL', 'NOHAL': 'NOHAL.OL', 'NOL': 'NOL.OL', 'NOM': 'NOM.OL',
  'NORAM': 'NORAM.OL', 'NORDH': 'NORDH.OL', 'NORSE': 'NORSE.OL', 'NRC': 'NRC.OL',
  'NSKOG': 'NSKOG.OL', 'NTI': 'NTI.OL', 'NYKD': 'NYKD.OL', 'ODFB': 'ODFB.OL',
  'ODFJELL-B': 'ODFJELL-B.OL', 'OKEA': 'OKEA.OL', 'OMDA': 'OMDA.OL', 'OTL': 'OTL.OL',
  'OTOVO': 'OTOVO.OL', 'PLT': 'PLT.OL', 'PNOR': 'PNOR.OL', 'POL': 'POL.OL',
  'PPG': 'PPG.OL', 'PRS': 'PRS.OL', 'PUBLI': 'PUBLI.OL', 'PYRUM': 'PYRUM.OL',
  'QEC': 'QEC.OL', 'RANA': 'RANA.OL', 'REACH': 'REACH.OL', 'REFL': 'REFL.OL',
  'RING': 'RING.OL', 'ROGS': 'ROGS.OL', 'SAGA': 'SAGA.OL', 'SALME': 'SALME.OL',
  'SATS': 'SATS.OL', 'SB68': 'SB68.OL', 'SBNOR': 'SBNOR.OL', 'SBO': 'SBO.OL',
  'SCANA': 'SCANA.OL', 'SDSD': 'SDSD.OL', 'SEA1': 'SEA1.OL', 'SKUE': 'SKUE.OL',
  'SMCRT': 'SMCRT.OL', 'SMOP': 'SMOP.OL', 'SNOR': 'SNOR.OL', 'SNTIA': 'SNTIA.OL',
  'SOAG': 'SOAG.OL', 'SOMA': 'SOMA.OL', 'SPOG': 'SPOG.OL', 'STECH': 'STECH.OL',
  'STST': 'STST.OL', 'TEKNA': 'TEKNA.OL', 'TINDE': 'TINDE.OL', 'TRMED': 'TRMED.OL',
  'TRSB': 'TRSB.OL', 'VDI': 'VDI.OL', 'VISTN': 'VISTN.OL', 'VOW': 'VOW.OL',
  'VTURA': 'VTURA.OL', 'VVL': 'VVL.OL', 'WEST': 'WEST.OL', 'XPLRA': 'XPLRA.OL',
  'ZAL': 'ZAL.OL', 'ZAP': 'ZAP.OL',
  // Dual-listed US
  'BORR.US': 'BORR', 'BWLP.US': 'BWLP', 'CDLR': 'CDLR', 'ECO.US': 'ECO',
  'EQNR.US': 'EQNR', 'FLNG.US': 'FLNG', 'FRO.US': 'FRO', 'HAFN.US': 'HAFN',
  // US ETFs
  'COPX': 'COPX', 'DBB': 'DBB', 'DBC': 'DBC', 'EFA': 'EFA', 'EWD': 'EWD',
  'EWN': 'EWN', 'GLD': 'GLD', 'IWM': 'IWM', 'NORW': 'NORW', 'QQQ': 'QQQ',
  'SLV': 'SLV', 'SPY': 'SPY', 'USO': 'USO', 'VGK': 'VGK', 'XLE': 'XLE', 'XOP': 'XOP',
  // Indexes
  'DAX': '^GDAXI', 'ESTX50': '^STOXX50E', 'NDX': '^NDX', 'OSEAX': 'OSEAX.OL',
  'OSEBX': 'OSEBX.OL', 'SPX': '^GSPC', 'VIX': '^VIX',
};

/**
 * Fetch Yahoo v8 chart data for a specific date range
 */
async function fetchYahooRange(yahooTicker, fromDate, toDate) {
  // Add 1 day buffer on each side
  const from = Math.floor(new Date(fromDate).getTime() / 1000) - 86400;
  const to = Math.floor(new Date(toDate).getTime() / 1000) + 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?period1=${from}&period2=${to}&interval=1d`;

  return new Promise((resolve, reject) => {
    const curl = spawn('curl', ['-s', '-L', '-H', 'User-Agent: Mozilla/5.0', url]);
    let data = '';
    curl.stdout.on('data', (chunk) => { data += chunk; });
    curl.on('close', (code) => {
      if (code !== 0) return reject(new Error(`curl failed with code ${code}`));
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(new Error(`Failed to parse JSON: ${data.substring(0, 200)}`)); }
    });
  });
}

/**
 * Parse Yahoo response into { date: { open, high, low, close } } map
 */
function parseYahooToMap(json) {
  const result = json?.chart?.result?.[0];
  if (!result?.timestamp || !result?.indicators?.quote?.[0]) return {};

  const timestamps = result.timestamp;
  const quote = result.indicators.quote[0];
  const map = {};

  for (let i = 0; i < timestamps.length; i++) {
    const d = new Date(timestamps[i] * 1000);
    const date = d.toISOString().slice(0, 10);
    const open = quote.open?.[i];
    const high = quote.high?.[i];
    const low = quote.low?.[i];
    const close = quote.close?.[i];
    if (close == null) continue;
    map[date] = {
      open: round4(open ?? close),
      high: round4(high ?? close),
      low: round4(low ?? close),
      close: round4(close),
    };
  }
  return map;
}

function round4(n) { return Math.round(n * 10000) / 10000; }

/**
 * Convert a pg Date (midnight local time) to YYYY-MM-DD string using local timezone.
 * IMPORTANT: pg driver returns `date` columns as JS Date at midnight LOCAL time.
 * Using .toISOString() would shift to UTC, which in CET (UTC+1) moves the date back by 1 day.
 */
function localDateStr(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Detect spikes: high/low far from both open AND close, with small body
 */
async function findSpikes(ticker) {
  const tickerFilter = ticker ? `AND ticker = $1` : '';
  const params = ticker ? [ticker] : [];

  const { rows } = await pool.query(`
    SELECT ticker, date, open, high, low, close
    FROM prices_daily
    WHERE close > 5
      AND date > '2020-01-01'
      AND (
        (high > open * ${1 + SPIKE_THRESHOLD} AND high > close * ${1 + SPIKE_THRESHOLD})
        OR
        (low < open * ${1 - SPIKE_THRESHOLD} AND low < close * ${1 - SPIKE_THRESHOLD})
      )
      AND ABS(close - open) / GREATEST(open, close) < 0.15
      ${tickerFilter}
    ORDER BY ticker, date
  `, params);

  return rows;
}

async function main() {
  console.log('=== OHLC Spike Detector & Fixer ===');
  console.log(`Mode: ${doFix ? '🔧 FIX (will update DB)' : '👀 DRY RUN (report only)'}`);
  console.log(`Threshold: ${(SPIKE_THRESHOLD * 100).toFixed(0)}% wick beyond body`);
  if (tickerArg) console.log(`Ticker: ${tickerArg}`);
  console.log('');

  // Step 1: Find all spike candidates
  const spikes = await findSpikes(tickerArg);
  console.log(`Found ${spikes.length} spike candidates\n`);

  if (spikes.length === 0) {
    console.log('No spikes found. Database looks clean!');
    await pool.end();
    return;
  }

  // Step 2: Group by ticker for batch Yahoo fetches
  const byTicker = {};
  for (const row of spikes) {
    if (!byTicker[row.ticker]) byTicker[row.ticker] = [];
    byTicker[row.ticker].push(row);
  }

  let fixedCount = 0;
  let confirmedBad = 0;
  let yahooAlsoBad = 0;
  let noYahooData = 0;
  let skippedNoMapping = 0;

  const fixes = [];

  for (const [ticker, rows] of Object.entries(byTicker)) {
    const yahooTicker = YAHOO_MAP[ticker];
    if (!yahooTicker) {
      skippedNoMapping += rows.length;
      continue;
    }

    // Find date range for this ticker's spikes
    const dates = rows.map(r => localDateStr(r.date));
    const minDate = dates.reduce((a, b) => a < b ? a : b);
    const maxDate = dates.reduce((a, b) => a > b ? a : b);

    // Fetch Yahoo data for the range
    let yahooMap = {};
    try {
      // Yahoo v8 max range is ~2y per call, so we may need multiple calls
      const fromDate = new Date(minDate);
      const toDate = new Date(maxDate);
      const diffMs = toDate - fromDate;
      const oneYear = 365 * 86400 * 1000;

      if (diffMs > oneYear * 1.5) {
        // Fetch in chunks
        let cursor = new Date(fromDate);
        while (cursor < toDate) {
          const chunkEnd = new Date(Math.min(cursor.getTime() + oneYear, toDate.getTime()));
          const json = await fetchYahooRange(yahooTicker, cursor.toISOString().slice(0, 10), chunkEnd.toISOString().slice(0, 10));
          Object.assign(yahooMap, parseYahooToMap(json));
          cursor = new Date(chunkEnd.getTime() + 86400 * 1000);
          await sleep(300);
        }
      } else {
        const json = await fetchYahooRange(yahooTicker, minDate, maxDate);
        yahooMap = parseYahooToMap(json);
      }
    } catch (err) {
      console.log(`  ⚠ Failed to fetch Yahoo data for ${ticker}: ${err.message}`);
      noYahooData += rows.length;
      continue;
    }

    // Compare each spike date
    for (const row of rows) {
      const date = localDateStr(row.date);
      const yahoo = yahooMap[date];
      const dbOpen = parseFloat(row.open);
      const dbHigh = parseFloat(row.high);
      const dbLow = parseFloat(row.low);
      const dbClose = parseFloat(row.close);
      const bodyTop = Math.max(dbOpen, dbClose);
      const bodyBot = Math.min(dbOpen, dbClose);

      if (!yahoo) {
        noYahooData++;
        continue;
      }

      // Check if Yahoo has the same spike (then it's real, not bad data)
      const yahooHighSpike = yahoo.high > yahoo.close * (1 + SPIKE_THRESHOLD) && yahoo.high > yahoo.open * (1 + SPIKE_THRESHOLD);
      const yahooLowSpike = yahoo.low < yahoo.close * (1 - SPIKE_THRESHOLD) && yahoo.low < yahoo.open * (1 - SPIKE_THRESHOLD);

      // Determine what needs fixing
      let newHigh = dbHigh;
      let newLow = dbLow;
      let reason = '';

      // Fix high spike if DB has it but Yahoo doesn't
      if (dbHigh > bodyTop * (1 + SPIKE_THRESHOLD)) {
        if (!yahooHighSpike && yahoo.high < bodyTop * (1 + SPIKE_THRESHOLD)) {
          newHigh = yahoo.high;
          reason += `high: ${dbHigh.toFixed(2)} → ${yahoo.high.toFixed(2)}`;
        } else {
          // Yahoo also shows a spike — could be real
          yahooAlsoBad++;
          continue;
        }
      }

      // Fix low spike if DB has it but Yahoo doesn't
      if (dbLow < bodyBot * (1 - SPIKE_THRESHOLD)) {
        if (!yahooLowSpike && yahoo.low > bodyBot * (1 - SPIKE_THRESHOLD)) {
          newLow = yahoo.low;
          reason += (reason ? ', ' : '') + `low: ${dbLow.toFixed(2)} → ${yahoo.low.toFixed(2)}`;
        } else {
          yahooAlsoBad++;
          continue;
        }
      }

      if (newHigh === dbHigh && newLow === dbLow) {
        yahooAlsoBad++;
        continue;
      }

      confirmedBad++;
      console.log(`  ${ticker} ${date}: ${reason} (Yahoo confirms fix)`);

      fixes.push({ ticker, date, newHigh, newLow, dbHigh, dbLow });
    }

    // Rate limit Yahoo API
    await sleep(200);
  }

  console.log('\n=== Summary ===');
  console.log(`Spike candidates:    ${spikes.length}`);
  console.log(`Confirmed bad data:  ${confirmedBad}`);
  console.log(`Yahoo also spiked:   ${yahooAlsoBad} (kept — likely real volatility)`);
  console.log(`No Yahoo data:       ${noYahooData}`);
  console.log(`No ticker mapping:   ${skippedNoMapping}`);

  // Step 3: Apply fixes
  if (doFix && fixes.length > 0) {
    console.log(`\n🔧 Applying ${fixes.length} fixes...`);
    for (const fix of fixes) {
      await pool.query(`
        UPDATE prices_daily
        SET high = $1, low = $2
        WHERE ticker = $3 AND date = $4
      `, [fix.newHigh, fix.newLow, fix.ticker, fix.date]);
      fixedCount++;
    }
    console.log(`✅ Fixed ${fixedCount} rows`);
  } else if (fixes.length > 0) {
    console.log(`\n👀 Run with --fix to apply ${fixes.length} corrections`);
  } else {
    console.log('\n✅ No fixes needed');
  }

  await pool.end();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => {
  console.error('Fatal error:', err);
  pool.end();
  process.exit(1);
});
