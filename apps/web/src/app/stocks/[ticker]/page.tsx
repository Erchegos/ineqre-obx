// apps/web/src/app/stocks/[ticker]/page.tsx
import Link from "next/link";
import PriceDrawdownChart, {
  type PriceChartPoint,
} from "@/components/price-drawdown-chart";
import {
  annualizedVolatility,
  maxDrawdown,
  varCvar95FromLogReturns,
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

function getBaseUrl() {
  const explicit = process.env.NEXT_PUBLIC_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl}`;

  return "https://www.ineqre.no";
}

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

function buildChartData(rows: PriceRow[]): PriceChartPoint[] {
  let peak = -Infinity;
  return rows.map((r) => {
    peak = Math.max(peak, r.close);
    const drawdown = peak > 0 ? (r.close - peak) / peak : 0;
    return { date: r.date, close: r.close, drawdown };
  });
}

export default async function TickerPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker: raw } = await params;
  const ticker = decodeURIComponent(raw || "").trim();

  const baseUrl = getBaseUrl();
  const res = await fetch(`${baseUrl}/api/prices/${encodeURIComponent(ticker)}`, {
    cache: "no-store",
  });

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

  const lastReturn = returns.length ? returns[returns.length - 1].log_return : null;
  const lastVol = volatility.length ? volatility[volatility.length - 1].volatility : null;

  const metricsEnabled = dataSource === "real" && returns.length >= 60;

  const annVol = metricsEnabled
    ? annualizedVolatility(returns.map((r) => r.log_return))
    : null;

  const mdd = metricsEnabled ? maxDrawdown(rows.map((r) => r.close)) : null;

  const risk = metricsEnabled ? varCvar95FromLogReturns(returns.map((r) => r.log_return)) : null;
  const var95 = risk ? risk.var95 : null;
  const cvar95 = risk ? risk.cvar95 : null;

  const chartData = buildChartData(rows);

  return (
    <main style={{ padding: 24 }}>
      <div style={{ marginBottom: 12 }}>
        <Link href="/stocks" style={{ opacity: 0.85 }}>
          Back to stocks
        </Link>
      </div>

      <h1 style={{ fontSize: 36, fontWeight: 800, margin: "8px 0 18px" }}>
        {ticker}
      </h1>

      <section style={panel}>
        <div style={grid2}>
          <div style={panelInner}>
            <div style={panelTitle}>Performance</div>
            <div style={kpiGrid}>
              <Kpi label="Data source" value={dataSource} />
              <Kpi
                label="Last daily return"
                value={lastReturn == null ? "n/a" : pct(lastReturn)}
              />
              <Kpi
                label="20d volatility (daily)"
                value={lastVol == null ? "n/a" : pct(lastVol)}
              />
              <Kpi label="Daily rows" value={rows.length.toString()} />
            </div>
          </div>

          <div style={panelInner}>
            <div style={panelTitle}>Risk</div>
            <div style={kpiGrid}>
              <Kpi
                label="Annualized volatility"
                value={annVol == null ? "n/a" : pct(annVol)}
              />
              <Kpi
                label="Max drawdown"
                value={mdd == null ? "n/a" : pct(mdd)}
              />
              <Kpi
                label="VaR 95% (1d)"
                value={var95 == null ? "n/a" : lossPct(var95)}
              />
              <Kpi
                label="CVaR 95% (1d)"
                value={cvar95 == null ? "n/a" : lossPct(cvar95)}
              />
            </div>
          </div>
        </div>
      </section>

      <section style={{ ...panel, marginTop: 16 }}>
        <div style={panelTitle}>Risk interpretation</div>
        <div style={{ marginTop: 10, lineHeight: 1.6, opacity: 0.92 }}>
          {!metricsEnabled && (
            <div style={{ opacity: 0.8 }}>
              Risk metrics are disabled for mock data or short history.
            </div>
          )}

          {metricsEnabled && (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>
                VaR 95% (1d): On 95% of days, loss did not exceed{" "}
                <strong>{lossPct(var95 ?? 0)}</strong>.
              </li>
              <li>
                CVaR 95% (1d): On the worst 5% days, average loss was about{" "}
                <strong>{lossPct(cvar95 ?? 0)}</strong>.
              </li>
              <li>
                Max drawdown: Worst peak-to-trough decline was{" "}
                <strong>{pct(mdd ?? 0)}</strong>.
              </li>
              <li>
                Annualized volatility: Typical annual swing is about{" "}
                <strong>{pct(annVol ?? 0)}</strong>.
              </li>
            </ul>
          )}
        </div>
      </section>

      <section style={{ ...panel, marginTop: 16 }}>
        <div style={panelTitle}>Price and drawdown</div>
        <div style={{ marginTop: 12 }}>
          <PriceDrawdownChart data={chartData} />
        </div>
      </section>

      <section style={{ ...panel, marginTop: 16 }}>
        <div style={panelTitle}>Daily prices</div>

        <div
          style={{
            marginTop: 12,
            borderRadius: 12,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.08)",
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
      </section>
    </main>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div style={kpi}>
      <div style={{ opacity: 0.7, fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

const panel: React.CSSProperties = {
  padding: 16,
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
};

const panelInner: React.CSSProperties = {
  padding: 16,
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(0,0,0,0.20)",
};

const panelTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 800,
  marginBottom: 12,
};

const grid2: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 16,
};

const kpiGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 12,
};

const kpi: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
  padding: 12,
  minWidth: 0,
};

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
