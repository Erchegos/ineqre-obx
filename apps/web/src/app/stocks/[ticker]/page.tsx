// apps/web/src/app/stocks/[ticker]/page.tsx
import Link from "next/link";
import { PriceChart } from "@/components/PriceChart";
import {
  annualizedVolatility,
  maxDrawdown,
  var95,
  cvar95,
} from "@/lib/metrics";

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

function lossPct(x: number) {
  return `${Math.abs(x * 100).toFixed(2)}%`;
}

function fmt(x: number | null) {
  if (x == null) return "";
  return Number.isFinite(x) ? x.toFixed(2) : "";
}

function metricValue(v: string) {
  return <div style={{ fontSize: 16, fontWeight: 650 }}>{v}</div>;
}

function metricLabel(v: string) {
  return <div style={{ opacity: 0.7, fontSize: 12 }}>{v}</div>;
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
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(255,255,255,0.04)",
        padding: 16,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
        {title}
      </div>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gap: 14,
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
      }}
    >
      {children}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
        padding: "12px 12px",
        minWidth: 0,
      }}
    >
      {metricLabel(label)}
      {metricValue(value)}
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

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
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

  const dataSource =
    rows.length && rows.every((r) => r.source === "mock") ? "mock" : "real";

  const metricsEnabled = dataSource === "real";

  const prices = rows.map((r) => r.close);

  let peak = -Infinity;
  const chartData = rows.map((r) => {
    peak = Math.max(peak, r.close);
    const drawdown = peak > 0 ? (r.close - peak) / peak : 0;
    return { date: r.date, close: r.close, drawdown };
  });

  const daily = returns.map((r) => r.log_return);

  const annVol =
    metricsEnabled && daily.length >= 60 ? annualizedVolatility(daily) : null;

  const mdd =
    metricsEnabled && prices.length >= 60 ? maxDrawdown(prices) : null;

  const VaR = metricsEnabled && daily.length >= 100 ? var95(daily) : null;
  const CVaR = metricsEnabled && daily.length >= 100 ? cvar95(daily) : null;

  const lastReturn =
    returns.length > 0 ? returns[returns.length - 1].log_return : null;

  const lastVol =
    volatility.length > 0
      ? volatility[volatility.length - 1].volatility
      : null;

  const riskSummary = metricsEnabled
    ? [
        VaR == null
          ? "VaR 95% (1d): n/a"
          : `VaR 95% (1d): On 95% of days, loss did not exceed ${lossPct(VaR)}.`,
        CVaR == null
          ? "CVaR 95% (1d): n/a"
          : `CVaR 95% (1d): On the worst 5% days, average loss was about ${lossPct(
              CVaR
            )}.`,
        mdd == null
          ? "Max drawdown: n/a"
          : `Max drawdown: Worst peak-to-trough decline was ${lossPct(mdd)}.`,
        annVol == null
          ? "Annualized volatility: n/a"
          : `Annualized volatility: Typical annual swing is about ${pct(annVol)}.`,
      ]
    : [
        "Risk metrics disabled for mock data.",
        "Use a real ticker with sufficient history to enable risk analytics.",
      ];

  return (
    <main style={{ padding: 24 }}>
      <div style={{ marginBottom: 12 }}>
        <Link href="/stocks" style={{ opacity: 0.85 }}>
          Back to stocks
        </Link>
      </div>

      <h1 style={{ fontSize: 32, fontWeight: 750, margin: "8px 0 14px" }}>
        {ticker}
      </h1>

      {/* PANELS: Performance vs Risk */}
      <div
        style={{
          display: "grid",
          gap: 14,
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          marginBottom: 16,
        }}
      >
        <Panel title="Performance">
          <Grid>
            <Tile label="Data source" value={dataSource} />
            <Tile
              label="Last daily return"
              value={lastReturn == null ? "n/a" : pct(lastReturn)}
            />
            <Tile
              label="20d volatility (daily)"
              value={lastVol == null ? "n/a" : pct(lastVol)}
            />
            <Tile label="Daily rows" value={`${rows.length}`} />
          </Grid>
        </Panel>

        <Panel title="Risk">
          <Grid>
            <Tile
              label="Annualized volatility"
              value={annVol == null ? "n/a" : pct(annVol)}
            />
            <Tile
              label="Max drawdown"
              value={mdd == null ? "n/a" : `-${lossPct(mdd)}`}
            />
            <Tile
              label="VaR 95% (1d)"
              value={VaR == null ? "n/a" : `-${lossPct(VaR)}`}
            />
            <Tile
              label="CVaR 95% (1d)"
              value={CVaR == null ? "n/a" : `-${lossPct(CVaR)}`}
            />
          </Grid>
        </Panel>
      </div>

      {/* Professional explanation block */}
      <section
        style={{
          marginBottom: 16,
          padding: 16,
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.10)",
          background: "rgba(255,255,255,0.04)",
          lineHeight: 1.6,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 750, marginBottom: 8 }}>
          Risk interpretation
        </div>

        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, opacity: 0.92 }}>
          {riskSummary.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>

      {/* Chart */}
      <section
        style={{
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.10)",
          background: "rgba(255,255,255,0.04)",
          padding: 12,
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
          Price and drawdown
        </div>
        <PriceChart data={chartData} />
      </section>

      {/* Table */}
      <div
        style={{
          borderRadius: 14,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.10)",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.05)" }}>
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
              <tr key={r.date} style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
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
