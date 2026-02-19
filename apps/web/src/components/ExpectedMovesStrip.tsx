/**
 * ExpectedMovesStrip Component
 *
 * Compact horizontal strip showing expected price moves.
 * Percentage first (more useful for traders), NOK in parentheses.
 */

type ExpectedMovesStripProps = {
  currentPrice: number;
  daily1Sigma: number;
  weekly1Sigma: number;
  daily2Sigma: number;
};

export default function ExpectedMovesStrip({
  currentPrice,
  daily1Sigma,
  weekly1Sigma,
  daily2Sigma,
}: ExpectedMovesStripProps) {
  if (currentPrice <= 0) return null;

  const dailyPct = (daily1Sigma / currentPrice) * 100;
  const weeklyPct = (weekly1Sigma / currentPrice) * 100;
  const extremePct = (daily2Sigma / currentPrice) * 100;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 16px",
        borderRadius: 4,
        background: "var(--card-bg)",
        border: "1px solid var(--border)",
        marginBottom: 24,
        flexWrap: "wrap",
        fontSize: 13,
        fontFamily: "monospace",
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--muted-foreground)",
          marginRight: 4,
        }}
      >
        Expected Moves:
      </span>

      <MoveItem
        label="Daily 1σ"
        pct={dailyPct}
        nok={daily1Sigma}
        prob="68%"
      />

      <Divider />

      <MoveItem
        label="Weekly 1σ"
        pct={weeklyPct}
        nok={weekly1Sigma}
        prob="68%"
      />

      <Divider />

      <MoveItem
        label="Extreme 2σ"
        pct={extremePct}
        nok={daily2Sigma}
        prob="95%"
      />
    </div>
  );
}

function MoveItem({ label, pct, nok, prob }: {
  label: string;
  pct: number;
  nok: number;
  prob: string;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4 }}>
      <span style={{ color: "var(--muted-foreground)", fontSize: 11 }}>{label}:</span>
      <span style={{ fontWeight: 700, color: "var(--foreground)" }}>
        ±{pct.toFixed(2)}%
      </span>
      <span style={{ color: "var(--muted-foreground)", fontSize: 11 }}>
        (±{nok.toFixed(2)} NOK)
      </span>
    </span>
  );
}

function Divider() {
  return (
    <span style={{ color: "var(--border)", fontSize: 16, margin: "0 2px" }}>·</span>
  );
}
