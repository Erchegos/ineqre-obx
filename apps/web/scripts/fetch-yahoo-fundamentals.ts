#!/usr/bin/env tsx

/**
 * Fetch Fundamental Factors from Yahoo Finance
 *
 * Fetches PE, PB, DY, PS, revenue growth, market cap, shares outstanding
 * for all OSE stocks and stores derived factors in factor_fundamentals.
 *
 * Usage:
 *   npx tsx scripts/fetch-yahoo-fundamentals.ts          # All stocks
 *   npx tsx scripts/fetch-yahoo-fundamentals.ts DNB      # Single ticker
 *   npx tsx scripts/fetch-yahoo-fundamentals.ts --backfill  # Backfill to all dates
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env.local') });

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { Pool } from 'pg';
import YF from 'yahoo-finance2';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Map DB tickers to Yahoo Finance symbols
// OSE stocks use .OL suffix, US-listed use no suffix or different symbol
const TICKER_TO_YAHOO: Record<string, string> = {
  // Standard OSE stocks → .OL suffix
  ABG: 'ABG.OL', ABL: 'ABL.OL', AFG: 'AFG.OL', AKAST: 'AKAST.OL',
  AKER: 'AKER.OL', AKRBP: 'AKRBP.OL', AKSO: 'AKSO.OL', AKVA: 'AKVA.OL',
  ARCH: 'ARCH.OL', ATEA: 'ATEA.OL', AUSS: 'AUSS.OL', AUTO: 'AUTO.OL',
  BAKKA: 'BAKKA.OL', BONHR: 'BONHR.OL', BOUV: 'BOUV.OL', BRG: 'BRG.OL',
  BWLPG: 'BWLPG.OL', BWO: 'BWO.OL', CADLR: 'CADLR.OL', CDLR: 'CDLR.OL',
  CMBTO: 'CMBTO.OL', DNB: 'DNB.OL', DOFG: 'DOFG.OL', ELK: 'ELK.OL',
  ENDUR: 'ENDUR.OL', ENTRA: 'ENTRA.OL', EQNR: 'EQNR.OL', FRO: 'FRO.OL',
  GJF: 'GJF.OL', GSF: 'GSF.OL', HAFNI: 'HAFNI.OL', HAUTO: 'HAUTO.OL',
  HAVI: 'HAVI.OL', HUNT: 'HUNT.OL', IDEX: 'IDEX.OL', KID: 'KID.OL',
  KIT: 'KIT.OL', KMCP: 'KMCP.OL', KOA: 'KOA.OL', KOG: 'KOG.OL',
  LSG: 'LSG.OL', MEDI: 'MEDI.OL', MING: 'MING.OL', MOWI: 'MOWI.OL',
  MPCC: 'MPCC.OL', MULTI: 'MULTI.OL', NAPA: 'NAPA.OL', NAS: 'NAS.OL',
  NEL: 'NEL.OL', NEXT: 'NEXT.OL', NHY: 'NHY.OL', NOD: 'NOD.OL',
  NONG: 'NONG.OL', NORBT: 'NORBT.OL', ODF: 'ODF.OL', ODL: 'ODL.OL',
  OET: 'OET.OL', OLT: 'OLT.OL', ORK: 'ORK.OL', OTEC: 'OTEC.OL',
  PARB: 'PARB.OL', PCIB: 'PCIB.OL', PEXIP: 'PEXIP.OL', PHO: 'PHO.OL',
  PROT: 'PROT.OL', RECSI: 'RECSI.OL', SALM: 'SALM.OL', SB1NO: 'SB1NO.OL',
  SCATC: 'SCATC.OL', SNI: 'SNI.OL', SOFF: 'SOFF.OL', SPOL: 'SPOL.OL',
  STB: 'STB.OL', SUBC: 'SUBC.OL', SWON: 'SWON.OL', TECH: 'TECH.OL',
  TEL: 'TEL.OL', TGS: 'TGS.OL', TIETO: 'TIETO.OL', TOM: 'TOM.OL',
  VAR: 'VAR.OL', VEI: 'VEI.OL', VEND: 'VEND.OL', WAWI: 'WAWI.OL',
  WWI: 'WWI.OL', WWIB: 'WWIB.OL', YAR: 'YAR.OL',

  // New tickers (2026-02-05)
  DNO: 'DNO.OL', BNOR: 'BNOR.OL', ELO: 'ELO.OL', EPR: 'EPR.OL',
  GIGA: 'GIGA.OL', HSHP: 'HSHP.OL', LINK: 'LINK.OL', PEN: 'PEN.OL',
  PLSV: 'PLSV.OL',

  // US-listed / dual-listed
  NORCO: 'NCLH',
  'BORR.US': 'BORR', 'BWLP.US': 'BWLP', 'ECO.US': 'ECO',
  'EQNR.US': 'EQNR', 'FLNG.US': 'FLNG', 'FRO.US': 'FRO',
  'HAFN.US': 'HAFN',
};

// Tickers to skip (indices, ETFs, commodities)
const SKIP_TICKERS = new Set([
  'OBX', 'OSEBX', 'OSEAX', 'SPX', 'SPY', 'QQQ', 'IWM', 'NDX', 'VIX',
  'GLD', 'SLV', 'DBC', 'DBB', 'EFA', 'VGK', 'EWD', 'EWN', 'XLE', 'XOP',
  'USO', 'COPX', 'DAX', 'ESTX50', 'HEX', 'NORW', '2020', 'KCC',
]);

interface FundamentalData {
  ticker: string;
  bm: number | null;        // Book-to-Market = 1/PB
  ep: number | null;        // Earnings/Price = 1/PE
  dy: number | null;        // Dividend yield (decimal)
  sp: number | null;        // Sales/Price = Revenue / MarketCap
  sg: number | null;        // Sales growth (YoY)
  mktcap: number | null;    // Market cap in NOK
  ev_ebitda: number | null;  // EV/EBITDA (trailing)
}

async function fetchFundamentals(
  yf: InstanceType<typeof YF>,
  ticker: string,
  yahooSymbol: string
): Promise<FundamentalData | null> {
  try {
    const [quote, summary] = await Promise.all([
      yf.quote(yahooSymbol),
      yf.quoteSummary(yahooSymbol, {
        modules: ['financialData', 'defaultKeyStatistics'],
      }),
    ]);

    const fd = summary.financialData as Record<string, unknown> || {};
    const dks = summary.defaultKeyStatistics as Record<string, unknown> || {};
    const pe = quote.trailingPE;
    const pb = quote.priceToBook;
    const divYield = quote.dividendYield; // Percentage (e.g. 5.96)
    const revenue = fd.totalRevenue as number | undefined;
    const mktcap = quote.marketCap;
    const revGrowth = fd.revenueGrowth as number | undefined;
    const evEbitda = dks.enterpriseToEbitda as number | undefined;

    // Calculate derived factors
    const bm = pb ? 1 / pb : null;
    const ep = pe ? 1 / pe : null;
    const dy = divYield != null ? divYield / 100 : null; // Convert % to decimal
    const sp = revenue && mktcap ? revenue / mktcap : null;
    const sg = revGrowth ?? null;

    return { ticker, bm, ep, dy, sp, sg, mktcap: mktcap ?? null, ev_ebitda: evEbitda ?? null };
  } catch (err: any) {
    console.warn(`  [${ticker}] Yahoo Finance error: ${err.message?.substring(0, 100)}`);
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const singleTicker = args.find(a => !a.startsWith('--'))?.toUpperCase();
  const doBackfill = args.includes('--backfill');

  console.log('='.repeat(70));
  console.log('FETCH YAHOO FINANCE FUNDAMENTALS');
  console.log('='.repeat(70));

  const yf = new YF({ suppressNotices: ['yahooSurvey'] });

  // Get tickers to process
  let tickers: string[];
  if (singleTicker) {
    tickers = [singleTicker];
  } else {
    const result = await pool.query(
      'SELECT DISTINCT ticker FROM factor_technical ORDER BY ticker'
    );
    tickers = result.rows
      .map((r: any) => r.ticker as string)
      .filter((t: string) => !SKIP_TICKERS.has(t));
  }

  console.log(`Processing ${tickers.length} tickers`);
  const today = new Date().toISOString().split('T')[0];

  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const ticker of tickers) {
    const yahooSymbol = TICKER_TO_YAHOO[ticker];
    if (!yahooSymbol) {
      console.log(`  [${ticker}] No Yahoo symbol mapping, skipping`);
      skipped++;
      continue;
    }

    const data = await fetchFundamentals(yf, ticker, yahooSymbol);
    if (!data) {
      failed++;
      continue;
    }

    // Upsert into factor_fundamentals for today's date
    await pool.query(
      `INSERT INTO factor_fundamentals (ticker, date, bm, ep, dy, sp, sg, mktcap, ev_ebitda, report_date, is_forward_filled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $2, false)
       ON CONFLICT (ticker, date) DO UPDATE SET
         bm = EXCLUDED.bm,
         ep = EXCLUDED.ep,
         dy = EXCLUDED.dy,
         sp = EXCLUDED.sp,
         sg = EXCLUDED.sg,
         mktcap = EXCLUDED.mktcap,
         ev_ebitda = EXCLUDED.ev_ebitda,
         report_date = EXCLUDED.report_date,
         is_forward_filled = false`,
      [ticker, today, data.bm, data.ep, data.dy, data.sp, data.sg, data.mktcap, data.ev_ebitda]
    );

    // If backfill mode, also fill all dates in factor_technical that don't have fundamentals
    if (doBackfill) {
      // First: update existing rows that have NULL fundamental values
      const updateResult = await pool.query(
        `UPDATE factor_fundamentals SET
           bm = COALESCE(bm, $3::numeric),
           ep = COALESCE(ep, $4::numeric),
           dy = COALESCE(dy, $5::numeric),
           sp = COALESCE(sp, $6::numeric),
           sg = COALESCE(sg, $7::numeric),
           mktcap = COALESCE(mktcap, $8::numeric),
           ev_ebitda = COALESCE(ev_ebitda, $9::numeric),
           report_date = COALESCE(report_date, $2::date),
           is_forward_filled = CASE WHEN bm IS NULL THEN true ELSE is_forward_filled END
         WHERE ticker = $1 AND bm IS NULL`,
        [ticker, today, data.bm, data.ep, data.dy, data.sp, data.sg, data.mktcap, data.ev_ebitda]
      );

      // Second: insert for dates in factor_technical that have no factor_fundamentals row at all
      const insertResult = await pool.query(
        `INSERT INTO factor_fundamentals (ticker, date, bm, ep, dy, sp, sg, mktcap, ev_ebitda, nokvol, report_date, is_forward_filled)
         SELECT $1::varchar, ft.date, $3::numeric, $4::numeric, $5::numeric, $6::numeric, $7::numeric, $8::numeric, $9::numeric, NULL, $2::date, true
         FROM factor_technical ft
         WHERE ft.ticker = $1::varchar
           AND NOT EXISTS (
             SELECT 1 FROM factor_fundamentals ff
             WHERE ff.ticker = ft.ticker AND ff.date = ft.date
           )
         ON CONFLICT (ticker, date) DO NOTHING`,
        [ticker, today, data.bm, data.ep, data.dy, data.sp, data.sg, data.mktcap, data.ev_ebitda]
      );
      const backfilled = (updateResult.rowCount || 0) + (insertResult.rowCount || 0);
      console.log(
        `  [${ticker}] OK: bm=${data.bm?.toFixed(3) ?? 'N/A'} ep=${data.ep?.toFixed(3) ?? 'N/A'} ` +
        `dy=${data.dy?.toFixed(3) ?? 'N/A'} sp=${data.sp?.toFixed(3) ?? 'N/A'} ` +
        `ev_ebitda=${data.ev_ebitda?.toFixed(1) ?? 'N/A'} ` +
        `sg=${data.sg != null ? (data.sg * 100).toFixed(1) + '%' : 'N/A'} ` +
        `mktcap=${data.mktcap ? (data.mktcap / 1e9).toFixed(0) + 'B' : 'N/A'} ` +
        `(backfilled ${backfilled} dates)`
      );
    } else {
      console.log(
        `  [${ticker}] OK: bm=${data.bm?.toFixed(3) ?? 'N/A'} ep=${data.ep?.toFixed(3) ?? 'N/A'} ` +
        `dy=${data.dy?.toFixed(3) ?? 'N/A'} sp=${data.sp?.toFixed(3) ?? 'N/A'} ` +
        `ev_ebitda=${data.ev_ebitda?.toFixed(1) ?? 'N/A'} ` +
        `sg=${data.sg != null ? (data.sg * 100).toFixed(1) + '%' : 'N/A'} ` +
        `mktcap=${data.mktcap ? (data.mktcap / 1e9).toFixed(0) + 'B' : 'N/A'}`
      );
    }

    success++;

    // Rate limit: ~1 request per second to avoid Yahoo throttling
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n' + '='.repeat(70));
  console.log(`COMPLETE: ${success} success, ${failed} failed, ${skipped} skipped`);
  console.log('='.repeat(70));

  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
