/**
 * VolatilityDashboard (was VolatilityHero)
 *
 * Professional hedge-fund-oriented volatility summary panel.
 * Dense, information-rich layout designed for research use:
 *
 *   ┌─ Regime status bar (1 line) ─────────────────────────┐
 *   │ VOL TERM STRUCTURE        │ RISK & EXPECTED MOVES     │
 *   │ 20d/60d/120d/EWMA/YZ     │ Beta, Systematic %, Corr  │
 *   │ with percentiles          │ Daily/Weekly/Extreme moves │
 *   │ + term structure signal   │ + vol ratio analysis       │
 *   ├─ Interpretation ─────────────────────────────────────┤
 *   └──────────────────────────────────────────────────────┘
 */

import {
  getRegimeColor,
  getRegimeBackgroundTint,
  type VolatilityRegime,
  type VolatilityTrend,
} from "@/lib/regimeClassification";

type VolatilityHeroProps = {
  regime: VolatilityRegime;
  annualizedVol: number;
  percentile: number;
  trend: VolatilityTrend;
  beta: number | null;
  rolling20: number | null;
  rolling60: number | null;
  rolling120: number | null;
  ewma94: number | null;
  yangZhang: number | null;
  interpretation: string;
  ticker: string;
  regimeDuration: number;
  percentiles: {
    rolling20: number | null;
    rolling60: number | null;
    ewma94: number | null;
    yangZhang: number | null;
  };
  expectedMoves: {
    currentPrice: number;
    daily1Sigma: number;
    weekly1Sigma: number;
    daily2Sigma: number;
  };
};

const fmtVol = (v: number | null) => v !== null ? `${(v * 100).toFixed(2)}%` : "—";
const fmtPctile = (p: number | null) => p !== null ? `${Math.round(p)}th` : "—";

function getTermStructureSignal(
  r20: number | null,
  r60: number | null,
  r120: number | null
): { label: string; description: string; color: string } {
  if (r20 === null || r60 === null) {
    return { label: "N/A", description: "Insufficient data", color: "var(--muted-foreground)" };
  }
  const ratio = r20 / r60;
  if (r120 !== null) {
    if (r20 > r60 && r60 > r120) {
      return {
        label: "INVERTED",
        description: "Short-term vol spike above all tenors — likely mean-reverting",
        color: "#F44336",
      };
    }
    if (r20 < r60 && r60 < r120) {
      return {
        label: "CONTANGO",
        description: "Vol declining across all tenors — calm regime building",
        color: "#4CAF50",
      };
    }
    if (r20 > r60 && r60 < r120) {
      return {
        label: "HUMPED",
        description: "Recent spike on declining base — monitor for persistence",
        color: "#FF9800",
      };
    }
  }
  if (ratio > 1.15) {
    return {
      label: "INVERTED",
      description: "Short-term vol elevated — recent event or regime shift",
      color: "#F44336",
    };
  }
  if (ratio < 0.85) {
    return {
      label: "CONTANGO",
      description: "Short-term calm, longer-term vol higher — normal structure",
      color: "#4CAF50",
    };
  }
  return {
    label: "FLAT",
    description: "Vol consistent across tenors — stable regime",
    color: "var(--muted-foreground)",
  };
}

export default function VolatilityHero({
  regime,
  annualizedVol,
  percentile,
  trend,
  beta,
  rolling20,
  rolling60,
  rolling120,
  ewma94,
  yangZhang,
  interpretation,
  ticker,
  regimeDuration,
  percentiles,
  expectedMoves,
}: VolatilityHeroProps) {
  const accentColor = getRegimeColor(regime);
  const bgTint = getRegimeBackgroundTint(regime);

  const trendArrow = trend === "Expanding" ? "↑" : trend === "Contracting" ? "↓" : "→";
  const trendColor = trend === "Expanding" ? "#F44336" : trend === "Contracting" ? "#4CAF50" : "var(--muted-foreground)";

  const volRatio = rolling20 !== null && rolling60 !== null && rolling60 > 0
    ? rolling20 / rolling60
    : null;

  const systematicPct = beta !== null ? Math.min(Math.round(beta * beta * 100), 100) : null;
  const idioVol = systematicPct !== null && annualizedVol > 0
    ? Math.sqrt(Math.max(0, annualizedVol * annualizedVol * (1 - beta! * beta!)))
    : null;

  const termSignal = getTermStructureSignal(rolling20, rolling60, rolling120);

  const currentPrice = expectedMoves.currentPrice;
  const dailyPct = currentPrice > 0 ? (expectedMoves.daily1Sigma / currentPrice) * 100 : 0;
  const weeklyPct = currentPrice > 0 ? (expectedMoves.weekly1Sigma / currentPrice) * 100 : 0;
  const extremePct = currentPrice > 0 ? (expectedMoves.daily2Sigma / currentPrice) * 100 : 0;

  return (
    <div
      style={{
        marginBottom: 24,
        borderRadius: 6,
        border: `1px solid ${accentColor}33`,
        borderLeft: `4px solid ${accentColor}`,
        overflow: "hidden",
        background: "var(--card-bg)",
      }}
    >
      {/* ── Regime Status Bar ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 20px",
          background: bgTint,
          borderBottom: `1px solid ${accentColor}22`,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: "monospace" }}>
          <span style={{ fontWeight: 700, color: accentColor, fontSize: 13 }}>{regime}</span>
          <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>
            {Math.round(percentile)}th percentile
          </span>
          <span style={{ color: trendColor, fontSize: 12, fontWeight: 600 }}>
            {trendArrow} {trend}
          </span>
          <span style={{ color: "var(--muted-foreground)", fontSize: 11 }}>
            {regimeDuration}d in regime
          </span>
        </div>
        <div style={{ fontFamily: "monospace", fontSize: 12, color: "var(--muted-foreground)" }}>
          {ticker} · {(annualizedVol * 100).toFixed(1)}% annualized
        </div>
      </div>

      {/* ── Main 2-Column Layout ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 0,
          minHeight: 0,
        }}
      >
        {/* LEFT: Vol Term Structure */}
        <div style={{ padding: "16px 20px", borderRight: "1px solid var(--border)" }}>
          <div style={{
            fontSize: 10, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.1em", color: "var(--muted-foreground)", fontFamily: "monospace",
            marginBottom: 10,
          }}>
            Vol Term Structure
          </div>

          <table style={{
            width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "monospace",
          }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th style={{ ...thStyle, textAlign: "left" }}>Window</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Vol</th>
                <th style={{ ...thStyle, textAlign: "right" }}>%ile</th>
              </tr>
            </thead>
            <tbody>
              <TermRow label="20-Day" vol={rolling20} pctile={percentiles.rolling20} isShort />
              <TermRow label="60-Day" vol={rolling60} pctile={percentiles.rolling60} />
              <TermRow label="120-Day" vol={rolling120} pctile={null} />
              <TermRow label="EWMA λ=.94" vol={ewma94} pctile={percentiles.ewma94} />
              <TermRow label="Yang-Zhang" vol={yangZhang} pctile={percentiles.yangZhang} isRef />
            </tbody>
          </table>

          {/* Term structure signal */}
          <div style={{
            marginTop: 10, padding: "6px 10px", borderRadius: 3,
            background: "var(--background)", border: "1px solid var(--border)",
            fontSize: 11, fontFamily: "monospace",
          }}>
            <span style={{ fontWeight: 700, color: termSignal.color, marginRight: 6 }}>
              {termSignal.label}
            </span>
            <span style={{ color: "var(--muted-foreground)" }}>
              {termSignal.description}
            </span>
          </div>

          {volRatio !== null && (
            <div style={{
              marginTop: 6, fontSize: 11, fontFamily: "monospace",
              color: "var(--muted-foreground)",
            }}>
              Vol ratio (20d/60d): <span style={{
                fontWeight: 600,
                color: volRatio > 1.2 ? "#F44336" : volRatio < 0.8 ? "#4CAF50" : "var(--foreground)",
              }}>{volRatio.toFixed(2)}×</span>
            </div>
          )}
        </div>

        {/* RIGHT: Risk Decomposition + Expected Moves */}
        <div style={{ padding: "16px 20px" }}>
          <div style={{
            fontSize: 10, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.1em", color: "var(--muted-foreground)", fontFamily: "monospace",
            marginBottom: 10,
          }}>
            Risk Decomposition
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 14px", fontSize: 12, fontFamily: "monospace", marginBottom: 14 }}>
            <span style={{ color: "var(--muted-foreground)" }}>Beta (OBX):</span>
            <span style={{ fontWeight: 600 }}>
              {beta !== null ? beta.toFixed(3) : "N/A"}
              {beta !== null && (
                <span style={{ fontWeight: 400, color: "var(--muted-foreground)", marginLeft: 6, fontSize: 11 }}>
                  {Math.abs(beta) < 0.3 ? "idiosyncratic" : Math.abs(beta) < 0.7 ? "mixed" : "market-driven"}
                </span>
              )}
            </span>

            {systematicPct !== null && (
              <>
                <span style={{ color: "var(--muted-foreground)" }}>Systematic:</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ flex: 1, maxWidth: 120, height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${systematicPct}%`, height: "100%", background: "#3b82f6", borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: 11 }}>
                    {systematicPct}% / {100 - systematicPct}% idio
                  </span>
                </div>
              </>
            )}

            {idioVol !== null && (
              <>
                <span style={{ color: "var(--muted-foreground)" }}>Idio. vol:</span>
                <span>{(idioVol * 100).toFixed(1)}%</span>
              </>
            )}

          </div>

          {/* Expected Moves */}
          <div style={{
            fontSize: 10, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.1em", color: "var(--muted-foreground)", fontFamily: "monospace",
            marginBottom: 8, paddingTop: 10, borderTop: "1px solid var(--border)",
          }}>
            Expected Moves
            {currentPrice > 0 && (
              <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, marginLeft: 8 }}>
                @ {currentPrice.toFixed(2)} NOK
              </span>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: "3px 12px", fontSize: 12, fontFamily: "monospace" }}>
            <span style={{ color: "var(--muted-foreground)", fontSize: 11 }}>Daily 1σ:</span>
            <span style={{ fontWeight: 600 }}>±{dailyPct.toFixed(2)}%</span>
            <span style={{ color: "var(--muted-foreground)", fontSize: 11 }}>±{expectedMoves.daily1Sigma.toFixed(2)} NOK</span>

            <span style={{ color: "var(--muted-foreground)", fontSize: 11 }}>Weekly 1σ:</span>
            <span style={{ fontWeight: 600 }}>±{weeklyPct.toFixed(2)}%</span>
            <span style={{ color: "var(--muted-foreground)", fontSize: 11 }}>±{expectedMoves.weekly1Sigma.toFixed(2)} NOK</span>

            <span style={{ color: "var(--muted-foreground)", fontSize: 11 }}>Extreme 2σ:</span>
            <span style={{ fontWeight: 600 }}>±{extremePct.toFixed(2)}%</span>
            <span style={{ color: "var(--muted-foreground)", fontSize: 11 }}>±{expectedMoves.daily2Sigma.toFixed(2)} NOK</span>
          </div>
        </div>
      </div>

      {/* ── Interpretation Bar ── */}
      <div
        style={{
          padding: "10px 20px",
          borderTop: `1px solid ${accentColor}22`,
          background: `${accentColor}08`,
          fontSize: 12,
          lineHeight: 1.5,
          color: "var(--muted-foreground)",
          fontFamily: "monospace",
        }}
      >
        {interpretation}
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "4px 0",
  fontSize: 10,
  fontWeight: 600,
  color: "var(--muted-foreground)",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
};

function TermRow({ label, vol, pctile, isShort, isRef }: {
  label: string;
  vol: number | null;
  pctile: number | null;
  isShort?: boolean;
  isRef?: boolean;
}) {
  return (
    <tr style={{ borderBottom: "1px solid var(--border)" }}>
      <td style={{ padding: "5px 0", color: "var(--muted-foreground)", fontSize: 12 }}>
        {label}
        {isRef && <span style={{ fontSize: 9, marginLeft: 4, color: "var(--muted-foreground)", opacity: 0.6 }}>ref</span>}
      </td>
      <td style={{ padding: "5px 0", textAlign: "right", fontWeight: isShort ? 700 : 500, color: "var(--foreground)" }}>
        {fmtVol(vol)}
      </td>
      <td style={{ padding: "5px 0", textAlign: "right", color: "var(--muted-foreground)", fontSize: 11 }}>
        {fmtPctile(pctile)}
      </td>
    </tr>
  );
}
