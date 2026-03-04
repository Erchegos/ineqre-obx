/**
 * Shipping Company Detail API
 * GET /api/shipping/companies/[ticker]
 *
 * Returns detailed company data: info, vessels, contracts, quarterly rates, stock price.
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
    const upperTicker = ticker.toUpperCase();

    // Company info
    const companyResult = await pool.query(`
      SELECT
        ticker, company_name, sector, fleet_size, avg_vessel_age::float,
        headquarters, color_hex, website
      FROM shipping_companies
      WHERE ticker = $1
    `, [upperTicker]);

    if (companyResult.rows.length === 0) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const company = companyResult.rows[0];

    // All vessels for this company
    const vesselsResult = await pool.query(`
      SELECT
        imo, vessel_name, vessel_type, dwt, teu, cbm,
        built_year, flag, status, vessel_class
      FROM shipping_vessels
      WHERE company_ticker = $1
      ORDER BY vessel_name ASC
    `, [upperTicker]);

    // Current contracts for this company's vessels
    const contractsResult = await pool.query(`
      SELECT
        vc.imo, vc.contract_type, vc.rate_usd_per_day::float, vc.rate_worldscale::float,
        vc.charterer, vc.contract_start, vc.contract_end,
        v.vessel_name, v.vessel_type
      FROM shipping_vessel_contracts vc
      JOIN shipping_vessels v ON v.imo = vc.imo
      WHERE v.company_ticker = $1 AND vc.is_current = true
      ORDER BY vc.contract_end ASC
    `, [upperTicker]);

    // Quarterly TCE rates
    const ratesResult = await pool.query(`
      SELECT
        quarter, vessel_class, rate_usd_per_day::float, vessels_in_class::int,
        contract_coverage_pct::float, spot_exposure_pct::float
      FROM shipping_company_rates
      WHERE ticker = $1
      ORDER BY quarter DESC
      LIMIT 32
    `, [upperTicker]);

    // Latest stock price
    const priceResult = await pool.query(`
      SELECT close::float, date, volume::bigint
      FROM prices_daily
      WHERE ticker = $1
      ORDER BY date DESC
      LIMIT 2
    `, [upperTicker]);

    const latestPrice = priceResult.rows[0];
    const prevPrice = priceResult.rows[1];

    return NextResponse.json({
      company: {
        ticker: company.ticker,
        companyName: company.company_name,
        sector: company.sector,
        fleetSize: company.fleet_size,
        avgVesselAge: company.avg_vessel_age,
        headquarters: company.headquarters,
        colorHex: company.color_hex,
        website: company.website,
      },
      vessels: vesselsResult.rows.map(v => ({
        imo: v.imo,
        vesselName: v.vessel_name,
        vesselType: v.vessel_type,
        dwt: v.dwt,
        teu: v.teu,
        cbm: v.cbm,
        builtYear: v.built_year,
        flag: v.flag,
        status: v.status,
        vesselClass: v.vessel_class,
      })),
      contracts: contractsResult.rows.map(c => ({
        imo: c.imo,
        vesselName: c.vessel_name,
        vesselType: c.vessel_type,
        contractType: c.contract_type,
        rateUsdPerDay: c.rate_usd_per_day,
        rateWorldscale: c.rate_worldscale,
        charterer: c.charterer,
        contractStart: c.contract_start,
        contractEnd: c.contract_end,
      })),
      quarterlyRates: ratesResult.rows.map(r => ({
        quarter: r.quarter,
        vesselClass: r.vessel_class,
        avgTceUsd: r.rate_usd_per_day,
        vesselsInClass: r.vessels_in_class,
        contractCoveragePct: r.contract_coverage_pct,
        spotExposurePct: r.spot_exposure_pct,
      })),
      stockPrice: latestPrice ? {
        close: latestPrice.close,
        date: latestPrice.date,
        volume: latestPrice.volume,
        changePct: prevPrice && prevPrice.close > 0
          ? Math.round(((latestPrice.close - prevPrice.close) / prevPrice.close) * 10000) / 100
          : null,
      } : null,
    });
  } catch (err) {
    console.error("[shipping/companies/ticker]", err);
    return NextResponse.json({ error: "Failed to fetch company details" }, { status: 500 });
  }
}
