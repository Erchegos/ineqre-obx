/**
 * FX Hedge Calculator API
 * POST /api/fx/hedge-calculator
 * Body: { ticker, notional, hedgeRatio, tenor, fxView? }
 *
 * Forward rate, hedged vs unhedged P&L under scenarios, cost, break-even.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { calculateHedgeCostAndBreakeven, hedgeCrossesQuarterEnd, quarterEndLabel, quarterEndBasisWidening } from "@/lib/fxTerminal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TENOR_DAYS: Record<string, number> = {
  "1M": 30,
  "3M": 91,
  "6M": 182,
  "12M": 365,
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      ticker,
      notional = 100_000_000,
      hedgeRatio = 0.5,
      tenor = "3M",
      currency = "USD",
    } = body as {
      ticker?: string;
      notional?: number;
      hedgeRatio?: number;
      tenor?: string;
      currency?: string;
    };

    const days = TENOR_DAYS[tenor] || 91;
    const ccy = currency.toUpperCase();
    const pair = `NOK${ccy}`;

    // Fetch latest spot — prefer 'norgesbank' source
    const spotResult = await pool.query<{ spot_rate: string }>(
      `SELECT spot_rate FROM fx_spot_rates
       WHERE currency_pair = $1 AND spot_rate > 0
       ORDER BY date DESC,
         CASE WHEN source = 'norgesbank' THEN 0 ELSE 1 END
       LIMIT 1`,
      [pair]
    );

    if (spotResult.rows.length === 0) {
      return NextResponse.json({ error: `No spot data for ${pair}` }, { status: 404 });
    }
    const spot = parseFloat(spotResult.rows[0].spot_rate);

    // Fetch interest rates
    const ratesResult = await pool.query<{ currency: string; rate: string }>(
      `SELECT DISTINCT ON (currency) currency, rate
       FROM interest_rates
       WHERE currency IN ('NOK', $1) AND tenor = $2
       ORDER BY currency, date DESC`,
      [ccy, tenor]
    );

    let nokRate = 0.045;
    let foreignRate = 0.04;
    for (const row of ratesResult.rows) {
      if (row.currency === "NOK") nokRate = parseFloat(row.rate);
      if (row.currency === ccy) foreignRate = parseFloat(row.rate);
    }

    // Calculate hedge metrics
    const hedgeMetrics = calculateHedgeCostAndBreakeven(spot, nokRate, foreignRate, hedgeRatio, days);

    // Fetch fundamental exposure for the ticker
    let netExposure = 0;
    if (ticker) {
      const expResult = await pool.query<{ net_usd_pct: string; net_eur_pct: string; net_gbp_pct: string; net_sek_pct: string }>(
        `SELECT net_usd_pct, net_eur_pct, net_gbp_pct, net_sek_pct
         FROM fx_fundamental_exposure
         WHERE ticker = $1
         ORDER BY fiscal_year DESC LIMIT 1`,
        [ticker.toUpperCase()]
      );
      if (expResult.rows.length > 0) {
        const key = `net_${ccy.toLowerCase()}_pct` as keyof typeof expResult.rows[0];
        netExposure = parseFloat(expResult.rows[0][key] || "0");
      }
    }

    // P&L scenarios
    const fxMoves = [-15, -12.5, -10, -7.5, -5, -2.5, 0, 2.5, 5, 7.5, 10, 12.5, 15];
    const scenarios = fxMoves.map((movePct) => {
      const newSpot = spot * (1 + movePct / 100);
      const unhedgedPnl = (netExposure * notional * movePct) / 100;
      const hedgedNotional = notional * hedgeRatio;
      const unhedgedNotional = notional * (1 - hedgeRatio);
      const hedgePnl = hedgedNotional * netExposure * ((hedgeMetrics.forwardRate - spot) / spot);
      const spotPnl = unhedgedNotional * netExposure * movePct / 100;
      const hedgeCost = hedgedNotional * hedgeMetrics.costBps / 10000 * (days / 365);

      return {
        fxMovePct: movePct,
        newSpot,
        unhedgedPnl,
        hedgedPnl: spotPnl + hedgePnl - hedgeCost,
        savings: (spotPnl + hedgePnl - hedgeCost) - unhedgedPnl,
      };
    });

    // Vol reduction estimate
    const volReduction = hedgeRatio * Math.abs(netExposure) * 100;

    // Execution details — what exactly to buy/sell
    const hedgedNotionalNOK = notional * hedgeRatio * Math.abs(netExposure);
    // Convert NOK exposure to foreign currency at spot (spot = NOK per 1 FCY)
    const hedgedAmountFCY = hedgedNotionalNOK / spot;
    const hedgedAmountNOK = hedgedNotionalNOK;
    // Settlement: deliver FCY, receive NOK at forward rate
    const settlementNOK = hedgedAmountFCY * hedgeMetrics.forwardRate;
    const hedgeCostNOK = hedgedNotionalNOK * hedgeMetrics.costBps / 10000 * (days / 365);

    // Product recommendation
    const isSmallExposure = hedgedNotionalNOK < 500_000;
    const isLargeExposure = hedgedNotionalNOK >= 10_000_000;
    const isHighVol = hedgeMetrics.costBps > 200;

    let recommendedProduct: string;
    let productExplanation: string;
    let alternativeProduct: string;
    let alternativeExplanation: string;

    if (isSmallExposure) {
      recommendedProduct = "FX Forward (bank)";
      productExplanation = "Standard forward contract through your bank. Locks in the exchange rate with no upfront cost — you simply agree to exchange at the forward rate on the settlement date.";
      alternativeProduct = "Do nothing";
      alternativeExplanation = "For small exposures, the admin cost of hedging may exceed the risk reduction benefit.";
    } else if (isHighVol && !isLargeExposure) {
      recommendedProduct = "FX Option (put on NOK)";
      productExplanation = "Buy a put option on NOK (call on foreign currency) to protect against NOK strengthening, while keeping upside if NOK weakens. You pay an option premium upfront but have no obligation.";
      alternativeProduct = "FX Forward (bank)";
      alternativeExplanation = "Cheaper than options but locks you in — you lose upside if NOK weakens in your favor.";
    } else {
      recommendedProduct = "FX Forward (bank)";
      productExplanation = "Standard forward contract through your bank. No upfront cost — you agree today to exchange currencies at the forward rate on the settlement date. Most common corporate hedge.";
      alternativeProduct = "FX Option (collar)";
      alternativeExplanation = "Zero-cost collar: buy a put (floor) and sell a call (cap) at offsetting premiums. Protects downside but caps upside within a range.";
    }

    // Quarter-end crossing check
    // Rime, Schrimpf & Syrstad (RFS 2022) — Table 7: basis widens 40–71 bps at QE
    const qeCheck = hedgeCrossesQuarterEnd(new Date(), days);
    const bpsWidening = quarterEndBasisWidening();
    const quarterEndWarning = {
      crosses: qeCheck.crosses,
      quarterEndDate: qeCheck.quarterEndDate ? qeCheck.quarterEndDate.toISOString().slice(0, 10) : null,
      quarterEndLabel: qeCheck.quarterEndDate ? quarterEndLabel(qeCheck.quarterEndDate) : null,
      daysUntilQE: qeCheck.daysUntilQE,
      estimatedBasisWideningBps: qeCheck.crosses ? bpsWidening : null,
      recommendation: qeCheck.crosses
        ? `Consider: (1) shorten tenor to mature before ${qeCheck.quarterEndDate ? quarterEndLabel(qeCheck.quarterEndDate) : "quarter-end"}, (2) price in ~${bpsWidening.median} bps basis widening, (3) re-hedge after quarter-turn when spreads normalize.`
        : null,
    };

    return NextResponse.json({
      ticker: ticker?.toUpperCase() || null,
      currency: ccy,
      pair,
      notional,
      hedgeRatio,
      tenor,
      days,
      spot,
      forward: hedgeMetrics.forwardRate,
      forwardPoints: hedgeMetrics.forwardPoints,
      costBpsAnnualized: hedgeMetrics.costBps,
      breakEvenPct: hedgeMetrics.breakEvenPct,
      nokRate: nokRate * 100,
      foreignRate: foreignRate * 100,
      netExposure,
      volReductionPct: volReduction,
      scenarios,
      quarterEndWarning,
      // Execution details
      execution: {
        action: netExposure > 0 ? "SELL" : "BUY",
        actionVerb: netExposure > 0 ? "Sell" : "Buy",
        amountFCY: hedgedAmountFCY,
        amountNOK: hedgedAmountNOK,
        settlementNOK,
        hedgeCostNOK,
        forwardRate: hedgeMetrics.forwardRate,
        settlementDate: new Date(Date.now() + days * 86400000).toISOString().slice(0, 10),
        recommendedProduct,
        productExplanation,
        alternativeProduct,
        alternativeExplanation,
      },
    });
  } catch (error: any) {
    console.error("[FX Hedge Calculator API] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to compute hedge" },
      { status: 500 }
    );
  }
}
