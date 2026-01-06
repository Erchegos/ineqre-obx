// apps/web/src/app/stocks/[ticker]/page.tsx
import Link from "next/link";
import { annualizedVolatility, maxDrawdown, var95, cvar95 } from "@/lib/metrics";
import PriceChart, { type PriceChartPoint } from "@/components/PriceChart";

type PriceRow = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
  source: string;
};

type ReturnRow = { date: string; log_return: number };
type VolRow = { date: string; volatility: number };

function pct(x: number) {
  return `${(x * 100).toFixed(2)}%`;
}

function fmt(x: number | null) {
  if (x == null) return "";
  return Number.isFinite(x) ? x.toFixed(2) : "";
}

function getBaseUrl() {
  // Prefer explicit public base URL
  const explicit = process.env.NEXT_PUBLIC_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  // Vercel provides this at runtime
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;

  // Final fallback: your production domain
  return "https://www.ineqre.no";
}

function buildChartData(rows: PriceRow[]): PriceChartPoint[] {
  let peak = -Infinity;
  return rows.map((r) => {
    peak = Math.max(peak, r.close);
    const drawdown = peak > 0 ? (r.close - peak) / peak : 0;
    return { date: r.date, close: r.close, drawdown };
  });
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
        padding: 16,
        marginBottom: 14,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 12 }}>
        {title}
      </div>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div
      style={{
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(0,0,0,0.25)",
        padding: 12,
        minWidth: 0,
      }}
    >
      <div style={{ opacity: 0.7, fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 650 }}>{value}</div>
    </div>
  );
}

function Interpretation({
  metricsEnabled,
  annVol,
  mdd,
  var95_1d,
}: {
  metricsEnabled: boolean;
  annVol: number | null;
  mdd: number | null;
  var95_1d: number | null;
}) {
  if (!metricsEnabled) {
    return (
      <div style={{ opacity: 0.85, fontSize: 13, lineHeight: 1.6 }}>
        Metrics are disabled because this ticker is currently served from mock
        data.
      </div>
    );
  }

  return (
    <div style={{ fontSize: 13, lineHeight: 1.7 }}>
      <div>
        <b>VaR 95% (1d):</b>{" "}
        {var95_1d == null
          ? "n/a"
          : `On 95% of days, loss did not exceed ${pct(var95_1d)}.`}
      </div>
      <div>
        <b>Max drawdown:</b>{" "}
        {mdd == null ? "n/a" : `Worst peak to trough decline was ${pct(mdd)}.`}
      </div>
      <div>
        <b>Annualized volatility:</b>{" "}
        {annVol == null
          ? "n/a"
          : `Typical annual swing is about ${pct(annVol)}.`}
      </div>
      <div style={{ opacity: 0.65, marginTop: 8 }}>
        Notes: VaR is based on historical daily log returns. It is not a
        guarantee and will understate risk during regime shifts.
      </div>
    </div>
  );
}

export default async function TickerPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker: raw } = await params;
  const ticker = decodeURIComponent(raw || "").trim();

  const baseUrl = getBaseUrl();
  const res = await fetch(
    `${baseUrl}/api/prices/${encodeURIComponent(ticker)}`,
    { cache: "no-store" }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to fetch prices (${res.status}): ${text}`);
  }

  const json = (await res.json()) as {
    ticker: string;
    rows: PriceRow[];
    returns: ReturnRow[];
    volatility: VolRow[];
  };

  const rows = json.rows ?? [];
  const returns = json.returns ?? [];
  const volatility = json.volatility ?? [];

  // Determine data source first
  const dataSource =
    rows.length && rows.every((r) => r.source === "mock") ? "mock" : "real";
  const metricsEnabled = dataSource === "real";

  const lastReturn =
    returns.length > 0 ? returns[returns.length - 1].log_return : null;
  const lastVol =
    volatility.length > 0 ? volatility[volatility.length - 1].volatility : null;

  const prices = rows.map((r) => r.close);
  const chartData = buildChartData(rows);

  const annVol =
    metricsEnabled && returns.length >= 60
      ? annualizedVolatility(returns.map((r) => r.log_return))
      : null;

  const mdd = metricsEnabled && prices.length >= 60 ? maxDrawdown(prices) : null;

  // IMPORTANT: this expects var95(logReturns) export to exist in metrics.ts
  const var95_1d =
    metricsEnabled && returns.length >= 60
      ? var95(returns.map((r) => r.log_return))
      : null;

  return (
    <main
      style={{
        padding: 24,
        fontFamily:
          "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <Link href="/stocks" style={{ opacity: 0.85 }}>
          Back to stocks
        </Link>
      </div>

      <h1 style={{ fontSize: 36, fontWeight: 800, margin: "8px 0 16px" }}>
        {ticker}
      </h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
          marginBottom: 14,
        }}
      >
        <Panel title="Performance">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
            }}
          >
            <Stat label="Data source" value={dataSource} />
            <Stat
              label="Last daily return"
              value={lastReturn == null ? "n/a" : pct(lastReturn)}
            />
            <Stat
              label="20d volatility (daily)"
              value={lastVol == null ? "n/a" : pct(lastVol)}
            />
            <Stat label="Daily rows" value={rows.length} />
          </div>
        </Panel>

        <Panel title="Risk">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
            }}
          >
            <Stat
              label="Annualized volatility"
              value={annVol == null ? "n/a" : pct(annVol)}
            />
            <Stat
              label="Max drawdown"
              value={mdd == null ? "n/a" : pct(mdd)}
            />
            <Stat
              label="VaR 95% (1d)"
              value={var95_1d == null ? "n/a" : `-${pct(var95_1d)}`}
            />
            <Stat label="CVaR 95% (1d)" value={"n/a"} />
          </div>
        </Panel>
      </div>

      <Panel title="Risk interpretation">
        <Interpretation
          metricsEnabled={metricsEnabled}
          annVol={annVol}
          mdd={mdd}
          var95_1d={var95_1d}
        />
      </Panel>

      <Panel title="Price and drawdown">
        <div
          style={{
            height: 360,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.08)",
            overflow: "hidden",
            background: "rgba(0,0,0,0.25)",
          }}
        >
          <PriceChart data={chartData} />
        </div>
      </Panel>

      <div
        style={{
          borderRadius: 16,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.04)" }}>
              <th style={th}>Date</th>
              <th style={th}>Open</th>
              <th style={th}>High</th>
              <th style={th}>Low</th>
              <th style={th}>Close</th>
              <th style={th}>Volume</th>
              <th style={th}>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.date}
                style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
              >
                <td style={tdMono}>{r.date}</td>
                <td style={td}>{fmt(r.open)}</td>
                <td style={td}>{fmt(r.high)}</td>
                <td style={td}>{fmt(r.low)}</td>
                <td style={td}>{fmt(r.close)}</td>
                <td style={td}>{r.volume ?? ""}</td>
                <td style={td}>{r.source}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td style={{ ...td, padding: 16 }} colSpan={7}>
                  No data
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "12px 14px",
  fontSize: 12,
  letterSpacing: 0.2,
  opacity: 0.8,
};

const td: React.CSSProperties = {
  padding: "10px 14px",
  fontSize: 13,
  opacity: 0.95,
};

const tdMono: React.CSSProperties = {
  ...td,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
};
