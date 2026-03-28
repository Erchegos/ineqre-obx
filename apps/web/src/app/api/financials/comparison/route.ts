/**
 * Financials Comparison API
 * GET /api/financials/comparison
 *
 * Returns all sector stocks with full fundamentals + technicals + price returns
 * for the scorecard comparison table.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TICKERS = [
  // Major banks
  "DNB", "MING", "NONG", "MORG", "SPOL", "SB1NO",
  // Regional banks
  "HELG", "PARB", "RING", "SOAG", "SPOG", "AURG", "JAREN", "GRONG",
  "SNOR", "MELG", "SKUE", "VVL", "BIEN", "HGSB", "ROGS", "TRSB",
  "SBNOR", "TINDE", "SB68", "KRAB", "INSTA",
  // Insurance
  "GJF", "STB", "PROT",
  // Financial services
  "ABG", "ACR", "B2I", "BNOR",
  // Investment companies
  "AKER", "BONHR", "AFK", "MGN", "SAGA", "ENDUR",
];

export async function GET() {
  try {
    const validResult = await pool.query(
      `SELECT ticker FROM stocks WHERE ticker = ANY($1) AND asset_type = 'equity'`,
      [TICKERS]
    );
    const validTickers = validResult.rows.map((r: any) => r.ticker);
    if (validTickers.length === 0) {
      return NextResponse.json({ companies: [] });
    }

    const result = await pool.query(
      `WITH latest_prices AS (
        SELECT DISTINCT ON (pd.ticker)
          pd.ticker, pd.close::float AS price, pd.adj_close::float, pd.date
        FROM prices_daily pd
        WHERE pd.ticker = ANY($1) AND pd.close > 0
        ORDER BY pd.ticker, pd.date DESC
      ),
      prev_prices AS (
        SELECT DISTINCT ON (pd.ticker)
          pd.ticker, pd.adj_close::float AS prev_close
        FROM prices_daily pd
        WHERE pd.ticker = ANY($1) AND pd.close > 0
          AND pd.date < (SELECT MAX(date) FROM prices_daily WHERE ticker = pd.ticker AND close > 0)
        ORDER BY pd.ticker, pd.date DESC
      ),
      week_ago AS (
        SELECT DISTINCT ON (pd.ticker)
          pd.ticker, pd.adj_close::float AS close_wa
        FROM prices_daily pd
        WHERE pd.ticker = ANY($1) AND pd.close > 0
          AND pd.date <= CURRENT_DATE - INTERVAL '7 days'
        ORDER BY pd.ticker, pd.date DESC
      ),
      month_ago AS (
        SELECT DISTINCT ON (pd.ticker)
          pd.ticker, pd.adj_close::float AS close_ma
        FROM prices_daily pd
        WHERE pd.ticker = ANY($1) AND pd.close > 0
          AND pd.date <= CURRENT_DATE - INTERVAL '30 days'
        ORDER BY pd.ticker, pd.date DESC
      ),
      ytd_start AS (
        SELECT DISTINCT ON (pd.ticker)
          pd.ticker, pd.adj_close::float AS close_ytd
        FROM prices_daily pd
        WHERE pd.ticker = ANY($1) AND pd.close > 0
          AND pd.date >= date_trunc('year', CURRENT_DATE)
        ORDER BY pd.ticker, pd.date ASC
      ),
      latest_fund AS (
        SELECT DISTINCT ON (ff.ticker)
          ff.ticker, ff.ep::float, ff.bm::float, ff.dy::float,
          ff.sp::float, ff.sg::float, ff.mktcap::float, ff.ev_ebitda::float
        FROM factor_fundamentals ff
        WHERE ff.ticker = ANY($1)
        ORDER BY ff.ticker, ff.date DESC
      ),
      latest_tech AS (
        SELECT DISTINCT ON (ft.ticker)
          ft.ticker,
          ft.mom1m::float, ft.mom6m::float, ft.mom11m::float,
          ft.vol1m::float, ft.vol3m::float, ft.vol12m::float,
          ft.beta::float, ft.ivol::float
        FROM factor_technical ft
        WHERE ft.ticker = ANY($1)
        ORDER BY ft.ticker, ft.date DESC
      ),
      latest_short AS (
        SELECT DISTINCT ON (sp.ticker)
          sp.ticker, sp.short_pct::float
        FROM short_positions sp
        WHERE sp.ticker = ANY($1)
        ORDER BY sp.ticker, sp.date DESC
      ),
      latest_ml AS (
        SELECT DISTINCT ON (mp.ticker)
          mp.ticker, mp.ensemble_prediction::float AS ml_pred, mp.confidence_score::float AS ml_conf
        FROM ml_predictions mp
        WHERE mp.ticker = ANY($1)
        ORDER BY mp.ticker, mp.prediction_date DESC
      )
      SELECT
        lp.ticker, s.name, lp.price, lp.adj_close, lp.date AS price_date,
        pp.prev_close, wa.close_wa, ma.close_ma, ys.close_ytd,
        f.ep, f.bm, f.dy, f.sp, f.sg, f.mktcap, f.ev_ebitda,
        t.mom1m, t.mom6m, t.mom11m, t.vol1m, t.vol3m, t.vol12m, t.beta, t.ivol,
        sh.short_pct,
        ml.ml_pred, ml.ml_conf
      FROM latest_prices lp
      JOIN stocks s ON s.ticker = lp.ticker
      LEFT JOIN prev_prices pp ON pp.ticker = lp.ticker
      LEFT JOIN week_ago wa ON wa.ticker = lp.ticker
      LEFT JOIN month_ago ma ON ma.ticker = lp.ticker
      LEFT JOIN ytd_start ys ON ys.ticker = lp.ticker
      LEFT JOIN latest_fund f ON f.ticker = lp.ticker
      LEFT JOIN latest_tech t ON t.ticker = lp.ticker
      LEFT JOIN latest_short sh ON sh.ticker = lp.ticker
      LEFT JOIN latest_ml ml ON ml.ticker = lp.ticker`,
      [validTickers]
    );

    const companies = result.rows.map((r: any) => ({
      ticker: r.ticker,
      name: r.name,
      price: r.price,
      dailyPct: r.prev_close ? ((r.adj_close / r.prev_close) - 1) * 100 : null,
      weeklyPct: r.close_wa ? ((r.adj_close / r.close_wa) - 1) * 100 : null,
      monthlyPct: r.close_ma ? ((r.adj_close / r.close_ma) - 1) * 100 : null,
      ytdPct: r.close_ytd ? ((r.adj_close / r.close_ytd) - 1) * 100 : null,
      ep: r.ep, bm: r.bm, dy: r.dy, sp: r.sp, sg: r.sg, mktcap: r.mktcap, evEbitda: r.ev_ebitda,
      mom1m: r.mom1m, mom6m: r.mom6m, mom11m: r.mom11m,
      vol1m: r.vol1m, vol3m: r.vol3m, vol12m: r.vol12m,
      beta: r.beta, ivol: r.ivol,
      shortPct: r.short_pct ?? null,
      mlPred: r.ml_pred ?? null,
      mlConf: r.ml_conf ?? null,
    }));

    return NextResponse.json({ companies });
  } catch (err) {
    console.error("[financials/comparison]", err);
    return NextResponse.json({ error: "Failed to fetch financials comparison" }, { status: 500 });
  }
}
