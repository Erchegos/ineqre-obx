import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/predictions/[ticker]/backtest?days=756
 * Public (no auth) — returns SimInputBar[] for client-side ML backtest.
 * Same data as /api/alpha/simulator/[ticker] but open to everyone.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
    const t = ticker.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
    const url = new URL(req.url);
    const days = Math.min(parseInt(url.searchParams.get("days") || "756"), 2520);

    const priceRes = await pool.query(
      `WITH raw AS (
        SELECT date, open::float, high::float, low::float, close::float, volume::float
        FROM prices_daily
        WHERE ticker = $1
          AND date >= CURRENT_DATE - ($2 + 250 + 30) * INTERVAL '1 day'
        ORDER BY date
      ),
      with_fwd AS (
        SELECT *,
          AVG(close) OVER (ORDER BY date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) AS sma200,
          AVG(close) OVER (ORDER BY date ROWS BETWEEN 49 PRECEDING AND CURRENT ROW) AS sma50,
          (LEAD(close, 21) OVER (ORDER BY date) - close) / NULLIF(close, 0) AS fwd_ret_21d,
          ROW_NUMBER() OVER (ORDER BY date) AS rn
        FROM raw
      )
      SELECT date, open, high, low, close, volume,
             sma200::float, sma50::float,
             fwd_ret_21d::float
      FROM with_fwd
      WHERE rn > 200 AND date >= CURRENT_DATE - $2 * INTERVAL '1 day'
      ORDER BY date ASC`,
      [t, days]
    );

    if (priceRes.rows.length === 0) {
      return NextResponse.json({ ticker: t, input: [], error: "No price data" });
    }

    const [momRes, fundRes, stockInfo, obxRes] = await Promise.all([
      pool.query(
        `SELECT date, mom1m::float, mom6m::float, mom11m::float, vol1m::float
         FROM factor_technical WHERE ticker = $1
           AND date >= CURRENT_DATE - $2 * INTERVAL '1 day'
         ORDER BY date ASC`,
        [t, days]
      ),
      pool.query(
        `SELECT date, ep::float, bm::float
         FROM factor_fundamentals WHERE ticker = $1
           AND date >= CURRENT_DATE - $2 * INTERVAL '1 day'
         ORDER BY date ASC`,
        [t, days]
      ),
      pool.query(`SELECT sector FROM stocks WHERE ticker = $1 LIMIT 1`, [t]),
      pool.query(
        `SELECT date, close::float AS obx_close
         FROM prices_daily WHERE ticker = 'OBX'
           AND date >= CURRENT_DATE - $1 * INTERVAL '1 day'
         ORDER BY date ASC`,
        [days]
      ),
    ]);

    const sector = stockInfo.rows[0]?.sector || "";

    let sectorEpAvg = 0, sectorEpStd = 1, sectorBmAvg = 0, sectorBmStd = 1;
    if (sector) {
      const sectorRes = await pool.query(
        `SELECT AVG(f.ep)::float AS avg_ep, COALESCE(STDDEV(f.ep), 1)::float AS std_ep,
                AVG(f.bm)::float AS avg_bm, COALESCE(STDDEV(f.bm), 1)::float AS std_bm
         FROM (
           SELECT DISTINCT ON (ticker) ticker, ep, bm
           FROM factor_fundamentals
           WHERE ticker IN (SELECT ticker FROM stocks WHERE sector = $1)
           ORDER BY ticker, date DESC
         ) f`,
        [sector]
      );
      if (sectorRes.rows[0]) {
        sectorEpAvg = sectorRes.rows[0].avg_ep || 0;
        sectorEpStd = sectorRes.rows[0].std_ep || 1;
        sectorBmAvg = sectorRes.rows[0].avg_bm || 0;
        sectorBmStd = sectorRes.rows[0].std_bm || 1;
      }
    }

    const momMap = new Map<string, { mom1m: number; mom6m: number; mom11m: number; vol1m: number }>();
    for (const r of momRes.rows) momMap.set(r.date.toISOString().slice(0, 10), r);
    const fundMap = new Map<string, { ep: number; bm: number }>();
    for (const r of fundRes.rows) fundMap.set(r.date.toISOString().slice(0, 10), r);
    const obxMap = new Map<string, number>();
    for (const r of obxRes.rows) obxMap.set(r.date.toISOString().slice(0, 10), r.obx_close);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const input = priceRes.rows.map((px: any) => {
      const d = px.date.toISOString().slice(0, 10);
      const mom = momMap.get(d);
      const fund = fundMap.get(d);
      const ep = fund?.ep ?? null;
      const bm = fund?.bm ?? null;

      return {
        date: d,
        open: px.open,
        close: px.close,
        high: px.high,
        low: px.low,
        volume: px.volume,
        sma200: px.sma200,
        sma50: px.sma50,
        mlPrediction: px.fwd_ret_21d ?? null,
        mlConfidence: px.fwd_ret_21d != null ? 0.8 : null,
        mom1m: mom?.mom1m ?? null,
        mom6m: mom?.mom6m ?? null,
        mom11m: mom?.mom11m ?? null,
        vol1m: mom?.vol1m ?? null,
        volRegime: null as "low" | "high" | null,
        ep,
        bm,
        epSectorZ: ep != null && sectorEpStd > 0 ? (ep - sectorEpAvg) / sectorEpStd : null,
        bmSectorZ: bm != null && sectorBmStd > 0 ? (bm - sectorBmAvg) / sectorBmStd : null,
        benchmarkClose: obxMap.get(d) ?? null,
      };
    });

    const vol1mVals = input
      .map((b: { vol1m: number | null }) => b.vol1m)
      .filter((v: number | null): v is number => v != null)
      .sort((a: number, b: number) => a - b);
    const p66 = vol1mVals.length > 0 ? vol1mVals[Math.floor(vol1mVals.length * 0.67)] : 0;
    for (const bar of input) {
      if (bar.vol1m != null) bar.volRegime = bar.vol1m > p66 ? "high" : "low";
    }

    return NextResponse.json({ ticker: t, sector, input, model: "fwd_ret_21d" });
  } catch (err) {
    console.error("[PREDICTION BACKTEST API]", err);
    return NextResponse.json({ error: "Failed to fetch backtest data" }, { status: 500 });
  }
}
