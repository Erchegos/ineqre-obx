/**
 * Financials & Insurance Overview API
 * GET /api/financials/overview
 *
 * Returns dashboard data: company cards with price/returns/fundamentals/ML/shorts,
 * rate snapshot, sector aggregate performance, and recent news.
 */

import { NextRequest, NextResponse } from "next/server";
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

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const period = sp.get("period") || "1D";

    // 1. Validate which tickers exist in DB
    const validResult = await pool.query(
      `SELECT ticker FROM stocks WHERE ticker = ANY($1) AND asset_type = 'equity'`,
      [TICKERS]
    );
    const validTickers = validResult.rows.map((r: any) => r.ticker);
    if (validTickers.length === 0) {
      return NextResponse.json({ companies: [], rateSnapshot: null, news: [] });
    }

    // 2. Stock prices with multi-horizon returns + 90d sparkline
    const pricesResult = await pool.query(
      `WITH latest AS (
        SELECT DISTINCT ON (pd.ticker)
          pd.ticker, pd.close::float AS last_close, pd.adj_close::float AS adj_close, pd.date
        FROM prices_daily pd
        WHERE pd.ticker = ANY($1) AND pd.close > 0
        ORDER BY pd.ticker, pd.date DESC
      ),
      prev AS (
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
      sparklines AS (
        SELECT pd.ticker,
          json_agg(pd.adj_close::float ORDER BY pd.date) AS prices_90d
        FROM prices_daily pd
        WHERE pd.ticker = ANY($1)
          AND pd.date >= CURRENT_DATE - INTERVAL '90 days'
          AND pd.close > 0
        GROUP BY pd.ticker
      )
      SELECT
        l.ticker, s.name,
        l.last_close, l.adj_close, l.date AS price_date,
        p.prev_close,
        wa.close_wa, ma.close_ma, ys.close_ytd,
        sp.prices_90d
      FROM latest l
      JOIN stocks s ON s.ticker = l.ticker
      LEFT JOIN prev p ON p.ticker = l.ticker
      LEFT JOIN week_ago wa ON wa.ticker = l.ticker
      LEFT JOIN month_ago ma ON ma.ticker = l.ticker
      LEFT JOIN ytd_start ys ON ys.ticker = l.ticker
      LEFT JOIN sparklines sp ON sp.ticker = l.ticker`,
      [validTickers]
    );

    // 3. Fundamentals (latest per ticker)
    const fundResult = await pool.query(
      `SELECT DISTINCT ON (ff.ticker)
        ff.ticker, ff.ep::float, ff.bm::float, ff.dy::float,
        ff.mktcap::float, ff.ev_ebitda::float
      FROM factor_fundamentals ff
      WHERE ff.ticker = ANY($1)
      ORDER BY ff.ticker, ff.date DESC`,
      [validTickers]
    );
    const fundMap: Record<string, any> = {};
    for (const r of fundResult.rows) fundMap[r.ticker] = r;

    // 4. ML predictions (latest per ticker)
    const mlResult = await pool.query(
      `SELECT DISTINCT ON (mp.ticker)
        mp.ticker, mp.ensemble_prediction::float, mp.confidence_score::float
      FROM ml_predictions mp
      WHERE mp.ticker = ANY($1)
      ORDER BY mp.ticker, mp.prediction_date DESC`,
      [validTickers]
    );
    const mlMap: Record<string, any> = {};
    for (const r of mlResult.rows) mlMap[r.ticker] = r;

    // 5. Short positions (latest per ticker)
    const shortResult = await pool.query(
      `SELECT DISTINCT ON (sp.ticker)
        sp.ticker, sp.short_pct::float, sp.change_pct::float
      FROM short_positions sp
      WHERE sp.ticker = ANY($1)
      ORDER BY sp.ticker, sp.date DESC`,
      [validTickers]
    );
    const shortMap: Record<string, any> = {};
    for (const r of shortResult.rows) shortMap[r.ticker] = r;

    // 6. Rate snapshot (NOK policy + NIBOR 3M)
    const rateResult = await pool.query(
      `SELECT DISTINCT ON (tenor, rate_type)
        tenor, rate_type, rate::float AS rate, date::text
      FROM interest_rates
      WHERE currency = 'NOK'
        AND ((tenor = 'OVERNIGHT' AND rate_type = 'POLICY_RATE')
          OR (tenor = '3M' AND rate_type = 'IBOR'))
      ORDER BY tenor, rate_type, date DESC`
    );
    let policyRate: number | null = null;
    let nibor3m: number | null = null;
    let rateDate: string | null = null;
    for (const r of rateResult.rows) {
      if (r.rate_type === "POLICY_RATE") { policyRate = r.rate * 100; rateDate = r.date; }
      if (r.rate_type === "IBOR" && r.tenor === "3M") { nibor3m = r.rate * 100; }
    }

    // 7. Recent news (last 14 days)
    const newsResult = await pool.query(
      `SELECT nf.ticker, nf.published_at, nf.headline, nf.category,
        nf.severity, nf.sentiment::float
      FROM newsweb_filings nf
      WHERE nf.ticker = ANY($1)
        AND nf.published_at >= NOW() - INTERVAL '14 days'
      ORDER BY nf.published_at DESC
      LIMIT 20`,
      [validTickers]
    );

    // Build company objects
    const companies = pricesResult.rows.map((r: any) => {
      const f = fundMap[r.ticker];
      const ml = mlMap[r.ticker];
      const sh = shortMap[r.ticker];
      const dailyPct = r.prev_close ? ((r.adj_close / r.prev_close) - 1) * 100 : null;
      const weeklyPct = r.close_wa ? ((r.adj_close / r.close_wa) - 1) * 100 : null;
      const monthlyPct = r.close_ma ? ((r.adj_close / r.close_ma) - 1) * 100 : null;
      const ytdPct = r.close_ytd ? ((r.adj_close / r.close_ytd) - 1) * 100 : null;

      return {
        ticker: r.ticker,
        name: r.name,
        lastClose: r.last_close,
        priceDate: r.price_date,
        dailyPct,
        weeklyPct,
        monthlyPct,
        ytdPct,
        sparkline90d: r.prices_90d || [],
        fundamentals: f ? {
          ep: f.ep, bm: f.bm, dy: f.dy, mktcap: f.mktcap, evEbitda: f.ev_ebitda,
        } : null,
        mlSignal: ml ? {
          prediction: ml.ensemble_prediction,
          confidence: ml.confidence_score,
        } : null,
        shortPct: sh?.short_pct ?? null,
        shortChange: sh?.change_pct ?? null,
      };
    });

    // Sector aggregate performance
    const withDaily = companies.filter((c: any) => c.dailyPct != null);
    const withYtd = companies.filter((c: any) => c.ytdPct != null);
    const sectorPerformance = {
      daily: withDaily.length > 0 ? withDaily.reduce((s: number, c: any) => s + c.dailyPct, 0) / withDaily.length : null,
      weekly: companies.filter((c: any) => c.weeklyPct != null).length > 0
        ? companies.filter((c: any) => c.weeklyPct != null).reduce((s: number, c: any) => s + c.weeklyPct, 0) / companies.filter((c: any) => c.weeklyPct != null).length
        : null,
      monthly: companies.filter((c: any) => c.monthlyPct != null).length > 0
        ? companies.filter((c: any) => c.monthlyPct != null).reduce((s: number, c: any) => s + c.monthlyPct, 0) / companies.filter((c: any) => c.monthlyPct != null).length
        : null,
      ytd: withYtd.length > 0 ? withYtd.reduce((s: number, c: any) => s + c.ytdPct, 0) / withYtd.length : null,
    };

    return NextResponse.json({
      companies,
      rateSnapshot: { policyRate, nibor3m, asOfDate: rateDate },
      sectorPerformance,
      news: newsResult.rows.map((r: any) => ({
        ticker: r.ticker,
        headline: r.headline,
        publishedAt: r.published_at,
        category: r.category,
        severity: r.severity,
        sentiment: r.sentiment,
      })),
    });
  } catch (err) {
    console.error("[financials/overview]", err);
    return NextResponse.json({ error: "Failed to fetch financials overview" }, { status: 500 });
  }
}
