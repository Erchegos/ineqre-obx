/**
 * Company Biomass Share API
 * GET /api/seafood/company-biomass
 *
 * Estimates per-company biomass share by allocating production-area biomass
 * proportionally to each company's active site count in that area.
 *
 * Returns: per-company totals + per-company per-area breakdown + trend (last 6 months)
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SALMON_TICKERS = ["MOWI", "SALM", "LSG", "GSF", "BAKKA", "AUSS"];

export async function GET(req: NextRequest) {
  try {
    // 1) Get active site counts per company per production area
    const sitesResult = await pool.query(`
      SELECT
        COALESCE(ticker, 'OTHER') AS ticker,
        production_area_number AS area_number,
        COUNT(*) AS site_count
      FROM seafood_localities
      WHERE is_active = true AND production_area_number IS NOT NULL
      GROUP BY ticker, production_area_number
      ORDER BY ticker, production_area_number
    `);

    // Build site count map: { area_number: { ticker: count, _total: count } }
    const areaSites: Record<number, Record<string, number>> = {};
    for (const row of sitesResult.rows) {
      const a = row.area_number;
      if (!areaSites[a]) areaSites[a] = { _total: 0 };
      areaSites[a][row.ticker] = Number(row.site_count);
      areaSites[a]._total += Number(row.site_count);
    }

    // 2) Get latest month biomass per area
    const bioResult = await pool.query(`
      SELECT DISTINCT ON (area_number)
        area_number,
        month,
        biomass_tonnes::float,
        harvest_tonnes::float,
        stock_count::float
      FROM seafood_biomass_monthly
      WHERE species = 'salmon'
      ORDER BY area_number, month DESC
    `);

    // 3) Get last 6 months national biomass for trend
    const trendResult = await pool.query(`
      SELECT month,
             SUM(biomass_tonnes)::float AS total_biomass
      FROM seafood_biomass_monthly
      WHERE species = 'salmon'
        AND month >= (CURRENT_DATE - INTERVAL '6 months')::date
      GROUP BY month
      ORDER BY month
    `);

    // 4) Get last 6 months per-area biomass for company trend
    const areaTrendResult = await pool.query(`
      SELECT area_number, month, biomass_tonnes::float
      FROM seafood_biomass_monthly
      WHERE species = 'salmon'
        AND month >= (CURRENT_DATE - INTERVAL '6 months')::date
      ORDER BY month, area_number
    `);

    // 5) Allocate biomass to companies
    const nationalTotal = bioResult.rows.reduce((sum, r) => sum + (r.biomass_tonnes || 0), 0);

    // Per-company totals
    const companyTotals: Record<string, {
      ticker: string;
      estimatedBiomass: number;
      estimatedHarvest: number;
      estimatedStock: number;
      siteCount: number;
      areaCount: number;
      nationalSharePct: number;
      areas: Array<{ areaNumber: number; biomass: number; harvest: number; share: number; sitesInArea: number; areaTotalSites: number }>;
    }> = {};

    for (const tk of SALMON_TICKERS) {
      companyTotals[tk] = {
        ticker: tk,
        estimatedBiomass: 0,
        estimatedHarvest: 0,
        estimatedStock: 0,
        siteCount: 0,
        areaCount: 0,
        nationalSharePct: 0,
        areas: [],
      };
    }

    for (const row of bioResult.rows) {
      const a = row.area_number;
      const areaInfo = areaSites[a];
      if (!areaInfo) continue;

      for (const tk of SALMON_TICKERS) {
        const tkSites = areaInfo[tk] || 0;
        if (tkSites === 0) continue;
        const share = tkSites / areaInfo._total;
        const bio = (row.biomass_tonnes || 0) * share;
        const harv = (row.harvest_tonnes || 0) * share;
        const stock = (row.stock_count || 0) * share;

        companyTotals[tk].estimatedBiomass += bio;
        companyTotals[tk].estimatedHarvest += harv;
        companyTotals[tk].estimatedStock += stock;
        companyTotals[tk].areas.push({
          areaNumber: a,
          biomass: bio,
          harvest: harv,
          share: share * 100,
          sitesInArea: tkSites,
          areaTotalSites: areaInfo._total,
        });
      }
    }

    // Compute totals
    for (const tk of SALMON_TICKERS) {
      const c = companyTotals[tk];
      c.siteCount = Object.values(areaSites).reduce((sum, a) => sum + (a[tk] || 0), 0);
      c.areaCount = c.areas.length;
      c.nationalSharePct = nationalTotal > 0 ? (c.estimatedBiomass / nationalTotal) * 100 : 0;
    }

    // 6) Compute monthly trend per company (last 6 months)
    const companyTrend: Record<string, Array<{ month: string; biomass: number }>> = {};
    for (const tk of SALMON_TICKERS) companyTrend[tk] = [];

    // Group area trend by month
    const byMonth: Record<string, Array<{ area_number: number; biomass_tonnes: number }>> = {};
    for (const row of areaTrendResult.rows) {
      if (!byMonth[row.month]) byMonth[row.month] = [];
      byMonth[row.month].push(row);
    }

    for (const month of Object.keys(byMonth)) {
      const areaRows = byMonth[month];
      for (const tk of SALMON_TICKERS) {
        let tkBio = 0;
        for (const ar of areaRows) {
          const areaInfo = areaSites[ar.area_number];
          if (!areaInfo) continue;
          const tkSites = areaInfo[tk] || 0;
          if (tkSites === 0) continue;
          tkBio += (ar.biomass_tonnes || 0) * (tkSites / areaInfo._total);
        }
        companyTrend[tk].push({ month, biomass: tkBio });
      }
    }

    // Sort trends by month
    for (const tk of SALMON_TICKERS) {
      companyTrend[tk].sort((a, b) => a.month.localeCompare(b.month));
    }

    // "Other" = national total minus tracked companies
    const trackedTotal = SALMON_TICKERS.reduce((s, tk) => s + companyTotals[tk].estimatedBiomass, 0);
    const otherBiomass = Math.max(0, nationalTotal - trackedTotal);
    const otherSharePct = nationalTotal > 0 ? (otherBiomass / nationalTotal) * 100 : 0;

    return NextResponse.json({
      companies: SALMON_TICKERS.map(tk => companyTotals[tk]),
      other: { ticker: "OTHER", estimatedBiomass: otherBiomass, nationalSharePct: otherSharePct },
      nationalTotal,
      latestMonth: bioResult.rows[0]?.month || null,
      trend: companyTrend,
      nationalTrend: trendResult.rows,
    });
  } catch (err) {
    console.error("[COMPANY BIOMASS]", err);
    return NextResponse.json({ error: "Failed to compute company biomass" }, { status: 500 });
  }
}
