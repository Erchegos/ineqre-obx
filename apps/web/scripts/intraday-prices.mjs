#!/usr/bin/env node
/**
 * 15-minute intraday price update for Oslo Børs equities via Yahoo Finance batch quote API.
 * Upserts today's OHLCV row in prices_daily during market hours (09:00–16:30 Oslo time).
 * Uses batch v7/quote API (~3 calls for 224 tickers vs 224 sequential calls in backfill-yahoo.mjs).
 *
 * Usage: node scripts/intraday-prices.mjs
 */

import pg from 'pg';
import { readFileSync } from 'fs';

const { Pool } = pg;

// Load DATABASE_URL: env var (VPS/Docker) takes priority, fallback to .env.local (local dev)
let dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  try {
    const envContent = readFileSync('.env.local', 'utf-8');
    dbUrl = envContent.match(/DATABASE_URL="?([^"\n]+)"?/)?.[1]?.trim();
  } catch { /* not present */ }
}
if (!dbUrl) throw new Error('DATABASE_URL not set — set env var or create .env.local');

const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

// Oslo Børs tickers: DB ticker → Yahoo Finance symbol
const OL_STOCKS = {
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
  'ZAL': 'ZAL.OL', 'ZAP': 'ZAP.OL', 'OSEAX': 'OSEAX.OL', 'OSEBX': 'OSEBX.OL',
};

/** Today's date in Oslo timezone (YYYY-MM-DD) */
function osloToday() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });
}

/** Returns true if Oslo Børs is currently open (Mon-Fri 09:00–16:30 CET/CEST) */
function isMarketOpen() {
  const now = new Date();
  const day = now.toLocaleString('en-US', { weekday: 'short', timeZone: 'Europe/Oslo' });
  if (day === 'Sat' || day === 'Sun') return false;
  const timeStr = now.toLocaleTimeString('sv-SE', { timeZone: 'Europe/Oslo', hour12: false });
  const [h, m] = timeStr.split(':').map(Number);
  const minutes = h * 60 + m;
  return minutes >= 9 * 60 && minutes < 16 * 60 + 30;
}

/** Fetch current quotes for up to 100 Yahoo symbols in one API call */
async function fetchBatchQuotes(yahooSymbols) {
  const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(yahooSymbols.join(','))}&fields=regularMarketOpen,regularMarketHigh,regularMarketLow,regularMarketPrice,regularMarketVolume&formatted=false&crumb=`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; InEqRe-intraday/1.0)',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Yahoo API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.quoteResponse?.result ?? [];
}

/** Upsert today's OHLCV row — overwrites on (ticker, date) conflict */
async function upsertBatch(rows) {
  for (const row of rows) {
    await pool.query(`
      INSERT INTO prices_daily (ticker, date, open, high, low, close, adj_close, volume, source)
      VALUES ($1, $2::date, $3, $4, $5, $6, $6, $7, 'yahoo-intraday')
      ON CONFLICT (ticker, date) DO UPDATE SET
        open       = EXCLUDED.open,
        high       = GREATEST(prices_daily.high, EXCLUDED.high),
        low        = LEAST(prices_daily.low, EXCLUDED.low),
        close      = EXCLUDED.close,
        adj_close  = EXCLUDED.adj_close,
        volume     = EXCLUDED.volume,
        source     = EXCLUDED.source,
        inserted_at = NOW()
    `, [row.ticker, row.date, row.open, row.high, row.low, row.close, row.volume]);
  }
  return rows.length;
}

async function main() {
  if (!isMarketOpen()) {
    console.log(`[${new Date().toISOString()}] Market closed — skipping intraday update`);
    await pool.end();
    return;
  }

  const today = osloToday();
  const entries = Object.entries(OL_STOCKS);
  const BATCH = 100;

  let updated = 0;
  let skipped = 0;
  const t0 = Date.now();

  for (let i = 0; i < entries.length; i += BATCH) {
    const chunk = entries.slice(i, i + BATCH);
    const symbols = chunk.map(([, sym]) => sym);
    const symToDb = Object.fromEntries(chunk.map(([db, sym]) => [sym, db]));

    let quotes;
    try {
      quotes = await fetchBatchQuotes(symbols);
    } catch (err) {
      console.error(`Batch ${Math.floor(i / BATCH) + 1} fetch error: ${err.message}`);
      continue;
    }

    const rows = [];
    for (const q of quotes) {
      const dbTicker = symToDb[q.symbol];
      if (!dbTicker) continue;
      const c = q.regularMarketPrice;
      if (!c) { skipped++; continue; }
      rows.push({
        ticker: dbTicker,
        date: today,
        open: q.regularMarketOpen ?? c,
        high: q.regularMarketHigh ?? c,
        low: q.regularMarketLow ?? c,
        close: c,
        volume: q.regularMarketVolume ?? 0,
      });
    }

    try {
      updated += await upsertBatch(rows);
    } catch (err) {
      console.error(`DB upsert error: ${err.message}`);
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[${new Date().toISOString()}] Intraday update: ${updated} tickers in ${elapsed}s (${skipped} skipped)`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
