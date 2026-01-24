/**
 * API Route: Get company fundamentals
 * GET /api/fundamentals/[ticker]
 *
 * Returns fundamental data for a specific ticker from database
 */

import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

// Disable SSL cert validation for development
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;

    if (!ticker) {
      return NextResponse.json(
        { error: "Ticker is required" },
        { status: 400 }
      );
    }

    // Fetch company fundamentals with officers
    const result = await pool.query(
      `
      SELECT
        cf.ticker,
        cf.company_name as "companyName",
        cf.exchange,
        cf.exchange_country as "exchangeCountry",
        cf.industry,
        cf.sector,
        cf.status,
        cf.employees,
        cf.shares_outstanding as "sharesOutstanding",
        cf.total_float as "totalFloat",
        cf.reporting_currency as "reportingCurrency",
        cf.business_summary as "businessSummary",
        cf.financial_summary as "financialSummary",
        cf.website,
        cf.email,
        cf.phone_main as "phoneMain",
        cf.address_street as "addressStreet",
        cf.address_city as "addressCity",
        cf.address_country as "addressCountry",
        cf.ir_contact_name as "irContactName",
        cf.ir_contact_title as "irContactTitle",
        cf.ir_contact_phone as "irContactPhone",
        cf.latest_annual_date as "latestAnnualDate",
        cf.latest_interim_date as "latestInterimDate",
        cf.last_modified as "lastModified",
        json_agg(
          jsonb_build_object(
            'rank', co.rank,
            'name', co.first_name || ' ' || co.last_name,
            'age', co.age,
            'title', co.title,
            'since', co.since
          ) ORDER BY co.rank
        ) FILTER (WHERE co.ticker IS NOT NULL) as officers
      FROM company_fundamentals cf
      LEFT JOIN company_officers co ON cf.ticker = co.ticker
      WHERE UPPER(cf.ticker) = UPPER($1)
      GROUP BY cf.id
      `,
      [ticker]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Company not found" },
        { status: 404 }
      );
    }

    const company = result.rows[0];

    // Format the response
    const response = {
      ticker: company.ticker,
      companyName: company.companyName,
      exchange: company.exchange,
      exchangeCountry: company.exchangeCountry,
      industry: company.industry,
      sector: company.sector,
      status: company.status,
      employees: company.employees,
      sharesOutstanding: company.sharesOutstanding,
      totalFloat: company.totalFloat,
      reportingCurrency: company.reportingCurrency,
      businessSummary: company.businessSummary,
      financialSummary: company.financialSummary,
      website: company.website,
      email: company.email,
      phone: company.phoneMain ? { main: company.phoneMain } : undefined,
      address: company.addressStreet
        ? {
            street: company.addressStreet.split(", "),
            city: company.addressCity,
            country: company.addressCountry,
          }
        : undefined,
      investorRelationsContact: company.irContactName
        ? {
            name: company.irContactName,
            title: company.irContactTitle,
            phone: company.irContactPhone,
          }
        : undefined,
      officers: company.officers || [],
      latestAnnualDate: company.latestAnnualDate,
      latestInterimDate: company.latestInterimDate,
      lastModified: company.lastModified,
    };

    return NextResponse.json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    console.error("[Fundamentals API Error]", error);

    return NextResponse.json(
      {
        error: "Failed to fetch fundamentals",
        details: error.message,
      },
      { status: 500 }
    );
  }
}
