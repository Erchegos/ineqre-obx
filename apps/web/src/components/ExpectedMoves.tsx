/**
 * ExpectedMoves Component
 *
 * Displays expected price moves in NOK and percentages for different timeframes
 */

type ExpectedMovesProps = {
  currentPrice: number;
  daily1Sigma: number;
  weekly1Sigma: number;
  daily2Sigma: number;
};

export default function ExpectedMoves({
  currentPrice,
  daily1Sigma,
  weekly1Sigma,
  daily2Sigma,
}: ExpectedMovesProps) {
  // Calculate percentage moves
  const dailyPct = (daily1Sigma / currentPrice) * 100;
  const weeklyPct = (weekly1Sigma / currentPrice) * 100;
  const extremePct = (daily2Sigma / currentPrice) * 100;

  return (
    <div style={{ marginBottom: 40 }}>
      <h2
        style={{
          fontSize: 20,
          fontWeight: 600,
          marginBottom: 16,
          color: "var(--foreground)",
        }}
      >
        Expected Price Moves
      </h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 16,
        }}
      >
        {/* Daily Move (1σ) */}
        <div
          style={{
            padding: 20,
            borderRadius: 6,
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--muted)",
            }}
          >
            Expected Daily Move (1σ)
          </div>
          <div
            style={{
              fontSize: 32,
              fontWeight: 700,
              fontFamily: "monospace",
              color: "var(--foreground)",
            }}
          >
            ±{daily1Sigma.toFixed(2)} NOK
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--muted)",
            }}
          >
            (±{dailyPct.toFixed(2)}%)
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--muted-foreground)",
              marginTop: 4,
            }}
          >
            68% probability range
          </div>
        </div>

        {/* Weekly Move (1σ) */}
        <div
          style={{
            padding: 20,
            borderRadius: 6,
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--muted)",
            }}
          >
            Expected Weekly Move (1σ)
          </div>
          <div
            style={{
              fontSize: 32,
              fontWeight: 700,
              fontFamily: "monospace",
              color: "var(--foreground)",
            }}
          >
            ±{weekly1Sigma.toFixed(2)} NOK
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--muted)",
            }}
          >
            (±{weeklyPct.toFixed(2)}%)
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--muted-foreground)",
              marginTop: 4,
            }}
          >
            5-day, 68% probability
          </div>
        </div>

        {/* Extreme Daily Move (2σ) */}
        <div
          style={{
            padding: 20,
            borderRadius: 6,
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--muted)",
            }}
          >
            Extreme Daily Move (2σ)
          </div>
          <div
            style={{
              fontSize: 32,
              fontWeight: 700,
              fontFamily: "monospace",
              color: "var(--foreground)",
            }}
          >
            ±{daily2Sigma.toFixed(2)} NOK
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--muted)",
            }}
          >
            (±{extremePct.toFixed(2)}%)
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--muted-foreground)",
              marginTop: 4,
            }}
          >
            95% probability range
          </div>
        </div>
      </div>
    </div>
  );
}
