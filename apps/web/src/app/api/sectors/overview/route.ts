/**
 * Sector Intelligence Overview API
 * GET /api/sectors/overview
 *
 * Returns aggregated per-sector intelligence: commodity driver,
 * stock performance, betas, and sparklines.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { SECTOR_MAP, COMMODITY_META } from "@/lib/sectorMapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sectors = await Promise.all(
      Object.entries(SECTOR_MAP).map(async ([sectorName, def]) => {
        // 1. Get stock performance (latest + multi-period returns)
        const stockResult = await pool.query(`
          WITH latest_prices AS (
            SELECT DISTINCT ON (ticker)
              ticker, date, close::float AS close, adj_close::float AS adj_close
            FROM prices_daily
            WHERE ticker = ANY($1::text[])
            ORDER BY ticker, date DESC
          ),
          stock_returns AS (
            SELECT
              lp.ticker,
              lp.close,
              lp.date,
              s.name AS stock_name,
              -- Daily return
              (SELECT adj_close::float FROM prices_daily p2
               WHERE p2.ticker = lp.ticker AND p2.date < lp.date
               ORDER BY p2.date DESC LIMIT 1) AS prev_close,
              -- Week ago
              (SELECT adj_close::float FROM prices_daily p2
               WHERE p2.ticker = lp.ticker AND p2.date <= lp.date - INTERVAL '5 days'
               ORDER BY p2.date DESC LIMIT 1) AS week_close,
              -- Month ago
              (SELECT adj_close::float FROM prices_daily p2
               WHERE p2.ticker = lp.ticker AND p2.date <= lp.date - INTERVAL '21 days'
               ORDER BY p2.date DESC LIMIT 1) AS month_close,
              -- YTD start
              (SELECT adj_close::float FROM prices_daily p2
               WHERE p2.ticker = lp.ticker AND p2.date >= date_trunc('year', CURRENT_DATE)
               ORDER BY p2.date ASC LIMIT 1) AS ytd_start
            FROM latest_prices lp
            LEFT JOIN stocks s ON s.ticker = lp.ticker
          )
          SELECT
            ticker, stock_name, close, date,
            CASE WHEN prev_close > 0 THEN ((close - prev_close) / prev_close * 100) ELSE NULL END AS daily_pct,
            CASE WHEN week_close > 0 THEN ((close - week_close) / week_close * 100) ELSE NULL END AS weekly_pct,
            CASE WHEN month_close > 0 THEN ((close - month_close) / month_close * 100) ELSE NULL END AS monthly_pct,
            CASE WHEN ytd_start > 0 THEN ((close - ytd_start) / ytd_start * 100) ELSE NULL END AS ytd_pct
          FROM stock_returns
          ORDER BY ticker
        `, [def.tickers]);

        const stocks = stockResult.rows.map(r => ({
          ticker: r.ticker,
          name: r.stock_name,
          price: r.close,
          dailyPct: r.daily_pct ? parseFloat(r.daily_pct) : null,
          weeklyPct: r.weekly_pct ? parseFloat(r.weekly_pct) : null,
          monthlyPct: r.monthly_pct ? parseFloat(r.monthly_pct) : null,
          ytdPct: r.ytd_pct ? parseFloat(r.ytd_pct) : null,
        }));

        // Aggregate sector performance (equal-weight average)
        const validDaily = stocks.filter(s => s.dailyPct !== null);
        const validWeekly = stocks.filter(s => s.weeklyPct !== null);
        const validMonthly = stocks.filter(s => s.monthlyPct !== null);
        const validYtd = stocks.filter(s => s.ytdPct !== null);
        const avg = (arr: { [k: string]: number | null }[], key: string) =>
          arr.length > 0 ? arr.reduce((sum, s) => sum + ((s[key] as number) || 0), 0) / arr.length : null;

        const performance = {
          daily: avg(validDaily, "dailyPct"),
          weekly: avg(validWeekly, "weeklyPct"),
          monthly: avg(validMonthly, "monthlyPct"),
          ytd: avg(validYtd, "ytdPct"),
        };

        // Best/worst performer by daily return
        const sorted = [...stocks].filter(s => s.dailyPct !== null).sort((a, b) => (b.dailyPct || 0) - (a.dailyPct || 0));
        const bestPerformer = sorted[0] || null;
        const worstPerformer = sorted[sorted.length - 1] || null;

        // 2. Get primary commodity driver
        let commodityDriver = null;
        if (def.primaryCommodity) {
          const comResult = await pool.query(`
            WITH latest AS (
              SELECT close::float AS close, date
              FROM commodity_prices
              WHERE symbol = $1
              ORDER BY date DESC LIMIT 1
            ),
            prev AS (
              SELECT close::float AS close
              FROM commodity_prices
              WHERE symbol = $1
              ORDER BY date DESC OFFSET 1 LIMIT 1
            ),
            spark AS (
              SELECT array_agg(close::float ORDER BY date ASC) AS sparkline
              FROM commodity_prices
              WHERE symbol = $1 AND date >= NOW() - INTERVAL '30 days'
            )
            SELECT
              l.close, l.date,
              CASE WHEN p.close > 0 THEN ((l.close - p.close) / p.close * 100) ELSE NULL END AS day_pct,
              s.sparkline
            FROM latest l, prev p, spark s
          `, [def.primaryCommodity]);

          if (comResult.rows[0]) {
            const cr = comResult.rows[0];
            const meta = COMMODITY_META[def.primaryCommodity];
            commodityDriver = {
              symbol: def.primaryCommodity,
              name: meta?.name || def.primaryCommodity,
              price: cr.close,
              dailyPct: cr.day_pct ? parseFloat(cr.day_pct) : null,
              sparkline30d: cr.sparkline || [],
            };
          }
        } else if (def.rateIndices && def.rateIndices.includes("BDI")) {
          // Shipping: use BDI from shipping_market_rates
          try {
            const bdiResult = await pool.query(`
              WITH latest AS (
                SELECT value::float AS close, date
                FROM shipping_market_rates
                WHERE index_name = 'BDI'
                ORDER BY date DESC LIMIT 1
              ),
              prev AS (
                SELECT value::float AS close
                FROM shipping_market_rates
                WHERE index_name = 'BDI'
                ORDER BY date DESC OFFSET 1 LIMIT 1
              ),
              spark AS (
                SELECT array_agg(value::float ORDER BY date ASC) AS sparkline
                FROM shipping_market_rates
                WHERE index_name = 'BDI' AND date >= NOW() - INTERVAL '30 days'
              )
              SELECT
                l.close, l.date,
                CASE WHEN p.close > 0 THEN ((l.close - p.close) / p.close * 100) ELSE NULL END AS day_pct,
                s.sparkline
              FROM latest l, prev p, spark s
            `);
            if (bdiResult.rows[0]) {
              const cr = bdiResult.rows[0];
              commodityDriver = {
                symbol: "BDI",
                name: "Baltic Dry Index",
                price: cr.close,
                dailyPct: cr.day_pct ? parseFloat(cr.day_pct) : null,
                sparkline30d: cr.sparkline || [],
              };
            }
          } catch { /* BDI data may not exist */ }
        }

        // 3. Average commodity beta for sector
        let avgBeta = null;
        if (def.primaryCommodity) {
          const betaResult = await pool.query(`
            SELECT AVG(ABS(beta::float)) AS avg_beta
            FROM commodity_stock_sensitivity
            WHERE ticker = ANY($1::text[])
              AND commodity_symbol = $2
          `, [def.tickers, def.primaryCommodity]);
          avgBeta = betaResult.rows[0]?.avg_beta ? parseFloat(betaResult.rows[0].avg_beta) : null;
        }

        // 4. Sector 30-day sparkline (equal-weight index)
        const sparkResult = await pool.query(`
          WITH daily_returns AS (
            SELECT date, AVG(adj_close::float) AS avg_close
            FROM prices_daily
            WHERE ticker = ANY($1::text[])
              AND date >= NOW() - INTERVAL '30 days'
            GROUP BY date
            ORDER BY date ASC
          )
          SELECT array_agg(avg_close ORDER BY date ASC) AS sparkline FROM daily_returns
        `, [def.tickers]);
        const sectorSparkline30d = sparkResult.rows[0]?.sparkline || [];

        return {
          name: sectorName,
          color: def.color,
          tickers: def.tickers,
          stocks,
          performance,
          bestPerformer: bestPerformer ? {
            ticker: bestPerformer.ticker,
            name: bestPerformer.name,
            dailyPct: bestPerformer.dailyPct,
          } : null,
          worstPerformer: worstPerformer ? {
            ticker: worstPerformer.ticker,
            name: worstPerformer.name,
            dailyPct: worstPerformer.dailyPct,
          } : null,
          commodityDriver,
          avgBeta,
          sectorSparkline30d,
        };
      })
    );

    return NextResponse.json({ sectors });
  } catch (err) {
    console.error("[SECTORS OVERVIEW API]", err);
    return NextResponse.json(
      { error: "Failed to fetch sector overview" },
      { status: 500 }
    );
  }
}
