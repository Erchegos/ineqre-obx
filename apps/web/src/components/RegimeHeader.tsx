/**
 * RegimeHeader Component
 *
 * Prominent regime classification display with metrics grid and interpretation
 */

import {
  getRegimeColor,
  getRegimeBackgroundColor,
  getPrimaryDriver,
  getBetaInterpretation,
  type VolatilityRegime,
  type VolatilityTrend,
} from "@/lib/regimeClassification";

type RegimeHeaderProps = {
  regime: VolatilityRegime;
  currentLevel: number;
  percentile: number;
  trend: VolatilityTrend;
  trendValue?: number; // 20d vs 60d ratio for display
  beta: number | null;
  interpretation: string;
  ticker: string;
};

export default function RegimeHeader({
  regime,
  currentLevel,
  percentile,
  trend,
  trendValue,
  beta,
  interpretation,
  ticker,
}: RegimeHeaderProps) {
  const regimeColor = getRegimeColor(regime);
  const backgroundColor = getRegimeBackgroundColor(regime, 0.05);
  const primaryDriver = getPrimaryDriver(beta);
  const betaInterpretation = getBetaInterpretation(beta);

  // Trend comparison text
  let trendComparison = "Short-term vs medium-term volatility";
  if (trend === "Expanding") {
    trendComparison = "20d > 60d (short-term above medium-term)";
  } else if (trend === "Contracting") {
    trendComparison = "20d < 60d (short-term below medium-term)";
  } else {
    trendComparison = "20d ≈ 60d (short-term near medium-term)";
  }

  return (
    <div
      style={{
        marginBottom: 40,
        padding: 24,
        borderRadius: 6,
        background: backgroundColor,
        border: `1px solid ${regimeColor}`,
      }}
    >
      {/* Regime Badge */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Volatility Regime:
        </div>
        <div
          style={{
            display: "inline-block",
            padding: "6px 16px",
            borderRadius: 4,
            background: getRegimeBackgroundColor(regime, 0.15),
            border: `1px solid ${regimeColor}`,
            color: regimeColor,
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: "0.02em",
          }}
        >
          {regime}
        </div>
      </div>

      {/* Metrics Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        {/* Current Level */}
        <div
          style={{
            padding: 16,
            borderRadius: 4,
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--muted)",
              marginBottom: 8,
            }}
          >
            Current Level
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              fontFamily: "monospace",
              color: "var(--foreground)",
              marginBottom: 4,
            }}
          >
            {(currentLevel * 100).toFixed(1)}%
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--muted-foreground)",
            }}
          >
            {Math.round(percentile)}th percentile (period)
          </div>
        </div>

        {/* Trend */}
        <div
          style={{
            padding: 16,
            borderRadius: 4,
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--muted)",
              marginBottom: 8,
            }}
          >
            Trend
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              color:
                trend === "Expanding"
                  ? "#ef4444"
                  : trend === "Contracting"
                  ? "#22c55e"
                  : "var(--foreground)",
              marginBottom: 4,
            }}
          >
            {trend}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--muted-foreground)",
            }}
          >
            {trendComparison}
          </div>
        </div>

        {/* Market Correlation */}
        <div
          style={{
            padding: 16,
            borderRadius: 4,
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--muted)",
              marginBottom: 8,
            }}
          >
            Market Correlation
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              fontFamily: "monospace",
              color: "var(--foreground)",
              marginBottom: 4,
            }}
          >
            {beta !== null ? `${beta.toFixed(2)} β` : "N/A"}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--muted-foreground)",
            }}
          >
            {beta !== null
              ? `${Math.abs(beta) < 0.2 ? "Near zero" : Math.abs(beta) < 0.6 ? "Moderate" : "High"} vs OBX`
              : "Insufficient data"}
          </div>
        </div>

        {/* Primary Driver */}
        <div
          style={{
            padding: 16,
            borderRadius: 4,
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--muted)",
              marginBottom: 8,
            }}
          >
            Primary Driver
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: "var(--foreground)",
              marginBottom: 4,
            }}
          >
            {primaryDriver}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--muted-foreground)",
            }}
          >
            {primaryDriver === "Idiosyncratic"
              ? "Company-specific factors"
              : primaryDriver === "Market-Wide"
              ? "Systematic risk dominant"
              : "Mixed influences"}
          </div>
        </div>
      </div>

      {/* Interpretation */}
      <div
        style={{
          padding: 16,
          borderRadius: 4,
          background: "rgba(0, 0, 0, 0.02)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--foreground)",
            marginBottom: 8,
          }}
        >
          Interpretation:
        </div>
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.6,
            color: "var(--foreground)",
          }}
        >
          {interpretation}
        </div>
      </div>
    </div>
  );
}
