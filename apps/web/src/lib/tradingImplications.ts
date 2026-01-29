/**
 * Trading Implications Utility
 *
 * Generates context-aware trading strategy recommendations based on
 * volatility regime and market correlation.
 */

import type { VolatilityRegime } from "./regimeClassification";

export interface TradingImplication {
  favorable: string[];
  unfavorable: string[];
  catalysts: string[];
}

/**
 * Get trading implications based on volatility regime and beta
 *
 * @param regime Current volatility regime
 * @param beta Market beta coefficient (optional)
 * @returns TradingImplication object with strategies
 */
export function getTradingImplications(
  regime: VolatilityRegime,
  beta: number | null = null
): TradingImplication {
  const baseImplications = getBaseImplications(regime);

  // Adjust implications based on beta if available
  if (beta !== null) {
    adjustForBeta(baseImplications, beta, regime);
  }

  return baseImplications;
}

/**
 * Get base trading implications for each regime
 */
function getBaseImplications(regime: VolatilityRegime): TradingImplication {
  const implicationsMap: Record<VolatilityRegime, TradingImplication> = {
    "Extreme High": {
      favorable: [
        "Short volatility strategies (sell straddles/strangles)",
        "Mean reversion plays on extremes",
        "Defensive hedging positions",
        "Volatility arbitrage opportunities",
      ],
      unfavorable: [
        "Long gamma positions (expensive premium)",
        "Directional breakout trades",
        "Momentum strategies in thin markets",
        "Leveraged long positions",
      ],
      catalysts: [
        "Market stabilization signals",
        "Central bank interventions",
        "Resolution of major uncertainties",
        "VIX normalization",
      ],
    },

    Elevated: {
      favorable: [
        "Covered call writing (enhanced premium)",
        "Cash-secured put selling",
        "Volatility selling strategies",
        "Range-bound trading strategies",
      ],
      unfavorable: [
        "Naked long options (high implied vol)",
        "Aggressive trend following",
        "Short straddles without hedges",
        "Unhedged short positions",
      ],
      catalysts: [
        "Earnings announcements",
        "Economic data releases",
        "News flow normalization",
        "Technical support/resistance levels",
      ],
    },

    Normal: {
      favorable: [
        "Balanced option strategies (spreads)",
        "Trend following with stops",
        "Standard momentum plays",
        "Swing trading in established ranges",
      ],
      unfavorable: [
        "Pure volatility speculation",
        "Extreme leverage",
        "Relying solely on volatility mean reversion",
        "Ignoring position sizing discipline",
      ],
      catalysts: [
        "Quarterly earnings reports",
        "Industry-specific news",
        "Management guidance changes",
        "Sector rotation events",
      ],
    },

    "Low & Contracting": {
      favorable: [
        "Long gamma/straddles (cheap options)",
        "Breakout setups with defined risk",
        "Preparing for volatility expansion",
        "Calendar spreads (sell near, buy far)",
      ],
      unfavorable: [
        "Short volatility strategies",
        "Mean reversion trades",
        "Selling low premium options",
        "Complacency-based positioning",
      ],
      catalysts: [
        "Upcoming earnings events",
        "Major product launches or announcements",
        "Regulatory decisions",
        "Volatility regime shift signals",
      ],
    },

    "Low & Stable": {
      favorable: [
        "Carry trades and theta strategies",
        "Range trading within ±1σ bands",
        "Systematic covered call programs",
        "Short-term mean reversion",
      ],
      unfavorable: [
        "Expensive volatility insurance",
        "Aggressive breakout trading",
        "Long-dated long options",
        "Volatility expansion speculation",
      ],
      catalysts: [
        "Complacency indicators (volume, spreads)",
        "Macro economic surprises",
        "Geopolitical shocks",
        "Unexpected company-specific events",
      ],
    },
  };

  return implicationsMap[regime];
}

/**
 * Adjust trading implications based on market beta
 *
 * @param implications Base implications to adjust
 * @param beta Market beta coefficient
 * @param regime Current regime
 */
function adjustForBeta(
  implications: TradingImplication,
  beta: number,
  regime: VolatilityRegime
): void {
  const absBeta = Math.abs(beta);

  // High beta adjustments (>0.6)
  if (absBeta > 0.6) {
    // Market-driven volatility
    if (regime === "Extreme High" || regime === "Elevated") {
      implications.favorable.push(
        "Index hedge overlay (correlated to market)"
      );
    }

    // Add market-specific catalysts
    if (!implications.catalysts.includes("Broader market volatility shifts")) {
      implications.catalysts.push("Broader market volatility shifts");
    }
  }

  // Low beta adjustments (<0.2)
  if (absBeta < 0.2) {
    // Idiosyncratic volatility
    implications.catalysts = implications.catalysts.filter(
      (c) =>
        !c.toLowerCase().includes("market") &&
        !c.toLowerCase().includes("vix") &&
        !c.toLowerCase().includes("index")
    );

    // Add company-specific catalysts
    if (!implications.catalysts.includes("Company-specific events")) {
      implications.catalysts.unshift("Company-specific events");
    }

    // Note: Index hedges less effective
    if (regime === "Extreme High" || regime === "Elevated") {
      implications.unfavorable.push(
        "Using index derivatives as hedge (low correlation)"
      );
    }
  }
}

/**
 * Get portfolio implications based on regime and beta
 *
 * @param regime Current volatility regime
 * @param beta Market beta coefficient
 * @returns Array of portfolio implication strings
 */
export function getPortfolioImplications(
  regime: VolatilityRegime,
  beta: number | null
): string[] {
  const implications: string[] = [];

  // Beta-based implications
  if (beta !== null) {
    const absBeta = Math.abs(beta);

    if (absBeta < 0.2) {
      implications.push(
        "Diversification benefit: Low correlation with market provides portfolio variance reduction"
      );
      implications.push(
        "Risk consideration: Company-specific events will have outsized impact relative to market moves"
      );
      implications.push(
        "Hedging: Index derivatives provide minimal protection for this security"
      );
    } else if (absBeta > 0.6) {
      implications.push(
        "Diversification: Limited benefit as volatility closely tracks market"
      );
      implications.push(
        "Risk consideration: Systematic risk is primary driver; company-specific alpha harder to isolate"
      );
      implications.push(
        "Hedging: Index derivatives can effectively hedge volatility exposure"
      );
    } else {
      implications.push(
        "Diversification: Moderate correlation offers some portfolio variance benefits"
      );
      implications.push(
        "Risk consideration: Both systematic and idiosyncratic factors matter"
      );
      implications.push(
        "Hedging: Partial index hedge may be appropriate for volatility exposure"
      );
    }
  }

  // Regime-based implications
  if (regime === "Extreme High") {
    implications.push(
      "Position sizing: Reduce position size or use wider stops due to elevated risk"
    );
  } else if (regime === "Low & Stable" || regime === "Low & Contracting") {
    implications.push(
      "Position sizing: Can afford slightly larger positions given lower volatility"
    );
  }

  return implications;
}
