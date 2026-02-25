/**
 * Commodity Prices Overview API
 * GET /api/commodities
 *
 * Returns the latest price + 30d history for all tracked commodities,
 * plus stock sensitivity data.
 *
 * Query params:
 *   ?days=90    — history depth (default 90)
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMODITY_NAMES: Record<string, string> = {
  "BZ=F": "Brent Crude Oil",
  "CL=F": "WTI Crude Oil",
  "ALI=F": "Aluminium",
  "GC=F": "Gold",
  "SI=F": "Silver",
  "SALMON": "Salmon",
};

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const days = parseInt(sp.get("days") || "90");

    // Only return commodities we actively track
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

    // Fetch latest EUR/NOK rate for salmon conversion
    let nokPerEur: number | null = null;
    try {
      const fxRes = await pool.query(
        `SELECT spot_rate::float FROM fx_spot_rates
         WHERE currency_pair = 'NOKEUR'
         ORDER BY date DESC LIMIT 1`
      );
      nokPerEur = fxRes.rows[0]?.spot_rate ?? null;
    } catch { /* non-critical */ }

    // Build response with history + sensitivity per commodity
    const commodities = await Promise.all(
      latestResult.rows.map(async (latest) => {
        // Price history
        const histResult = await pool.query(
          `SELECT date, close::float AS close, volume::bigint AS volume
           FROM commodity_prices
           WHERE symbol = $1 AND date >= NOW() - INTERVAL '${days} days'
           ORDER BY date ASC`,
          [latest.symbol]
        );

        // Day-over-day return
        const prevResult = await pool.query(
          `SELECT close::float AS close FROM commodity_prices
           WHERE symbol = $1 AND date < $2
           ORDER BY date DESC LIMIT 1`,
          [latest.symbol, latest.date]
        );
        const prevClose = prevResult.rows[0]?.close;
        const dayReturn =
          prevClose && prevClose > 0
            ? ((latest.close - prevClose) / prevClose) * 100
            : null;

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

        // For salmon (NOK): also compute EUR equivalent
        const isSalmon = latest.symbol === "SALMON";
        const eurClose = isSalmon && nokPerEur && nokPerEur > 0
          ? latest.close / nokPerEur
          : null;

        return {
          symbol: latest.symbol,
          name: COMMODITY_NAMES[latest.symbol] || latest.symbol,
          currency: latest.currency,
          latest: {
            date: latest.date,
            open: latest.open,
            high: latest.high,
            low: latest.low,
            close: latest.close,
            volume: latest.volume ? Number(latest.volume) : null,
          },
          dayReturnPct: dayReturn,
          ...(isSalmon && eurClose != null ? { eurClose, nokPerEur } : {}),
          history: histResult.rows.map((r) => ({
            date: r.date,
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
