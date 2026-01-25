/**
 * API Route: Get company fundamentals
 * GET /api/fundamentals/[ticker]
 *
 * Returns fundamental data for a specific ticker from database.
 *
 * Security measures:
 * - Rate limiting (public endpoint)
 * - Ticker validation
 * - Parameterized queries
 * - Uses shared pool with proper SSL config
 */

import { NextRequest } from "next/server";
import { pool } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { tickerSchema } from "@/lib/validation";
import { secureJsonResponse, safeErrorResponse } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  // Rate limiting
  const rateLimitResult = rateLimit(req, 'public');
  if (rateLimitResult) return rateLimitResult;

  try {
    const { ticker: rawTicker } = await params;

    // Validate ticker parameter
    const tickerResult = tickerSchema.safeParse(rawTicker);
    if (!tickerResult.success) {
      return secureJsonResponse(
        { error: "Invalid ticker format" },
        { status: 400 }
      );
    }
    const ticker = tickerResult.data;

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
      return secureJsonResponse(
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

    return secureJsonResponse({
      success: true,
      data: response,
    });
  } catch (error: unknown) {
    // Don't expose error details to client
    return safeErrorResponse(error, "Failed to fetch fundamentals");
  }
}
