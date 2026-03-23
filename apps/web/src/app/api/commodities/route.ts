/**
 * Commodity Prices Overview API
 * GET /api/commodities
 *
 * Returns the latest price + history for all tracked commodities,
 * plus multi-period returns, sparkline data, and stock sensitivity.
 *
 * Query params:
 *   ?days=90    — history depth (default 90)
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
const COMMODITY_META: Record<string, { category: string; importance: number; unit: string }> = {
  "BZ=F":  { category: "Energy",  importance: 100, unit: "USD/bbl" },
  "CL=F":  { category: "Energy",  importance: 80,  unit: "USD/bbl" },
  "NG=F":  { category: "Energy",  importance: 60,  unit: "USD/MMBtu" },
  "ALI=F": { category: "Metals",  importance: 70,  unit: "USD/t" },
  "HG=F":  { category: "Metals",  importance: 55,  unit: "USD/lb" },
  "GC=F":  { category: "Metals",  importance: 65,  unit: "USD/oz" },
  "SI=F":  { category: "Metals",  importance: 40,  unit: "USD/oz" },
  "SALMON":{ category: "Seafood", importance: 90,  unit: "NOK/kg" },
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMODITY_NAMES: Record<string, string> = {
  "BZ=F": "Brent",
  "CL=F": "Crude Oil",
  "NG=F": "Natural Gas",
  "RB=F": "Gasoline",
  "HO=F": "Heating Oil",
  "TTF=F": "TTF Gas",
  "MTF=F": "Coal",
  "ALI=F": "Aluminium",
  "HG=F": "Copper",
  "GC=F": "Gold",
  "SI=F": "Silver",
  "ZS=F": "Soybeans",
  "ZW=F": "Wheat",
  "LBS=F": "Lumber",
  "TIO=F": "Iron Ore",
  "STEEL": "Steel",
  "SALMON": "Salmon",
};

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const days = parseInt(sp.get("days") || "90");

    const TRACKED_SYMBOLS = Object.keys(COMMODITY_NAMES);

    // Latest price per commodity
    const latestResult = await pool.query(`
      SELECT DISTINCT ON (cp.symbol)
        cp.symbol,
        cp.date,
        cp.open::float,
        cp.high::float,
        cp.low::float,
        cp.close::float,
        cp.volume::bigint AS volume,
        cp.currency
      FROM commodity_prices cp
      WHERE cp.symbol = ANY($1::text[])
      ORDER BY cp.symbol, cp.date DESC
    `, [TRACKED_SYMBOLS]);

    // Fetch live EUR/NOK rate from Norges Bank for salmon conversion
    let nokPerEur: number | null = null;
    try {
      const nbRes = await fetch(
        "https://data.norges-bank.no/api/data/EXR/B.EUR.NOK.SP?format=sdmx-json&lastNObservations=1",
        { next: { revalidate: 3600 } }
      );
      if (nbRes.ok) {
        const nbData = await nbRes.json();
        const obs = nbData?.data?.dataSets?.[0]?.series?.["0:0:0:0"]?.observations;
        const val = obs ? Object.values(obs)[0] : null;
        nokPerEur = (val as number[])?.[0] ?? null;
      }
    } catch { /* non-critical */ }
    if (!nokPerEur) {
      try {
        const fxRes = await pool.query(
          `SELECT spot_rate::float FROM fx_spot_rates
           WHERE currency_pair = 'NOKEUR'
           ORDER BY date DESC LIMIT 1`
        );
        nokPerEur = fxRes.rows[0]?.spot_rate ?? null;
      } catch { /* non-critical */ }
    }

    // Build response with history + multi-period returns + sensitivity
    const commodities = await Promise.all(
      latestResult.rows.map(async (latest) => {
        // Price history for the requested period
        const histResult = await pool.query(
          `SELECT date, open::float, high::float, low::float, close::float, volume::bigint AS volume
           FROM commodity_prices
           WHERE symbol = $1 AND date >= NOW() - INTERVAL '${days} days'
           ORDER BY date ASC`,
          [latest.symbol]
        );

        // Multi-period return closes using a single query with offsets
        const returnsResult = await pool.query(`
          WITH ordered AS (
            SELECT close::float AS close, date,
              ROW_NUMBER() OVER (ORDER BY date DESC) AS rn
            FROM commodity_prices
            WHERE symbol = $1
          ),
          ytd_first AS (
            SELECT close FROM commodity_prices
            WHERE symbol = $1
              AND date >= date_trunc('year', CURRENT_DATE)
            ORDER BY date ASC LIMIT 1
          )
          SELECT
            (SELECT close FROM ordered WHERE rn = 1) AS latest_close,
            (SELECT close FROM ordered WHERE rn = 2) AS prev_close,
            (SELECT close FROM ordered WHERE rn <= 6 ORDER BY rn DESC LIMIT 1) AS week_ago_close,
            (SELECT close FROM ordered WHERE rn <= 22 ORDER BY rn DESC LIMIT 1) AS month_ago_close,
            (SELECT close FROM ordered WHERE rn <= 253 ORDER BY rn DESC LIMIT 1) AS year_ago_close,
            (SELECT close FROM ytd_first) AS ytd_start_close
        `, [latest.symbol]);

        const r = returnsResult.rows[0] || {};
        const lc = r.latest_close;
        const calcPct = (ref: number | null) =>
          ref && ref > 0 && lc ? ((lc - ref) / ref) * 100 : null;

        const dayReturnPct = calcPct(r.prev_close);
        const weeklyPct = calcPct(r.week_ago_close);
        const monthlyPct = calcPct(r.month_ago_close);
        const yoyPct = calcPct(r.year_ago_close);
        const ytdPct = calcPct(r.ytd_start_close);

        // 30-day sparkline (just closes)
        const sparklineResult = await pool.query(
          `SELECT close::float AS close FROM commodity_prices
           WHERE symbol = $1 AND date >= NOW() - INTERVAL '30 days'
           ORDER BY date ASC`,
          [latest.symbol]
        );
        const sparkline30d = sparklineResult.rows.map((r: { close: number }) => r.close);

        // 5-day daily returns for heat pulse
        const last5Result = await pool.query(
          `WITH recent AS (
            SELECT date, close::float AS close,
              LAG(close::float) OVER (ORDER BY date) AS prev_close
            FROM commodity_prices
            WHERE symbol = $1
            ORDER BY date DESC
            LIMIT 6
          )
          SELECT date, close,
            CASE WHEN prev_close > 0 THEN ((close - prev_close) / prev_close) * 100 ELSE NULL END AS day_pct
          FROM recent
          WHERE prev_close IS NOT NULL
          ORDER BY date ASC`,
          [latest.symbol]
        );
        const last5Days = last5Result.rows.map((r: { date: string; close: number; day_pct: number | null }) => ({
          date: r.date,
          close: r.close,
          dayPct: r.day_pct,
        }));

        // 52-week high/low
        const rangeResult = await pool.query(
          `SELECT MAX(high::float) AS high_52w, MIN(low::float) AS low_52w
           FROM commodity_prices
           WHERE symbol = $1 AND date >= NOW() - INTERVAL '52 weeks'`,
          [latest.symbol]
        );
        const high52w = rangeResult.rows[0]?.high_52w ?? null;
        const low52w = rangeResult.rows[0]?.low_52w ?? null;

        // Stock sensitivities
        const sensResult = await pool.query(
          `SELECT
            css.ticker,
            css.beta::float,
            css.correlation_60d::float AS corr_60d,
            css.correlation_252d::float AS corr_252d,
            css.r_squared::float AS r_squared,
            s.name AS stock_name,
            s.sector
          FROM commodity_stock_sensitivity css
          LEFT JOIN stocks s ON upper(s.ticker) = upper(css.ticker)
          WHERE css.commodity_symbol = $1
          ORDER BY ABS(css.beta::float) DESC`,
          [latest.symbol]
        );

        // Salmon EUR conversion
        const isSalmon = latest.symbol === "SALMON";
        const eurClose = isSalmon && nokPerEur && nokPerEur > 0
          ? latest.close / nokPerEur
          : null;

        // Metadata from sectorMapping
        const meta = COMMODITY_META[latest.symbol];

        return {
          symbol: latest.symbol,
          name: COMMODITY_NAMES[latest.symbol] || latest.symbol,
          currency: latest.currency,
          category: meta?.category || "Other",
          importance: meta?.importance || 50,
          unit: meta?.unit || "",
          latest: {
            date: latest.date,
            open: latest.open,
            high: latest.high,
            low: latest.low,
            close: latest.close,
            volume: latest.volume ? Number(latest.volume) : null,
          },
          dayReturnPct,
          weeklyPct,
          monthlyPct,
          ytdPct,
          yoyPct,
          high52w,
          low52w,
          sparkline30d,
          last5Days,
          ...(isSalmon && eurClose != null ? { eurClose, nokPerEur } : {}),
          history: histResult.rows.map((r) => ({
            date: r.date,
            open: r.open,
            high: r.high,
            low: r.low,
            close: r.close,
            volume: r.volume ? Number(r.volume) : null,
          })),
          sensitivities: sensResult.rows.map((r) => ({
            ticker: r.ticker,
            stockName: r.stock_name,
            sector: r.sector,
            beta: r.beta,
            correlation60d: r.corr_60d,
            correlation252d: r.corr_252d,
            rSquared: r.r_squared,
          })),
        };
      })
    );

    return NextResponse.json({ commodities, count: commodities.length });
  } catch (err) {
    console.error("[COMMODITIES API]", err);
    return NextResponse.json(
      { error: "Failed to fetch commodity data" },
      { status: 500 }
    );
  }
}
