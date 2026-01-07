// apps/web/src/app/stocks/[ticker]/page.tsx
import Link from "next/link";
import { annualizedVolatility, maxDrawdown, var95 } from "@/lib/metrics";
import PriceChart, { type PriceChartPoint } from "@/components/PriceChart";

type PriceRow = {
  date: string;
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  volume: unknown;
  vwap?: unknown;
  numberOfShares?: unknown;
  numberOfTrades?: unknown;
  turnover?: unknown;
  source: string;
};


type FeatureRow = {
  ticker: string;
  date: string;
  ret1d: number | null;
  vol20d: number | null;
};

type ReturnRow = { date: string; log_return: number };
type VolRow = { date: string; volatility: number };

function pct(x: number) {
  return `${(x * 100).toFixed(2)}%`;
}

function fmt(x: unknown) {
  if (x == null) return "";
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n.toFixed(2) : "";
}


function getBaseUrl() {
  const explicit = process.env.NEXT_PUBLIC_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  if (process.env.NODE_ENV === "development") return "http://localhost:3000";

  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;

  return "https://www.ineqre.no";
}

function buildChartData(rows: PriceRow[]): PriceChartPoint[] {
  let peak = -Infinity;
  return rows.map((r) => {
    const close = typeof r.close === "number" ? r.close : Number(r.close);
    peak = Math.max(peak, close);
    const drawdown = peak > 0 ? (close - peak) / peak : 0;
    return { date: r.date, close, drawdown };
  });
}


function computeLogReturns(rowsAsc: EquityRow[]): ReturnRow[] {
  const out: ReturnRow[] = [];
  for (let i = 1; i < rowsAsc.length; i++) {
    const prev = rowsAsc[i - 1].close;
    const cur = rowsAsc[i].close;
    if (prev > 0 && cur > 0) {
      out.push({
        date: rowsAsc[i].date,
        log_return: Math.log(cur / prev),
      });
    }
  }
  return out;
}

function rollingVol(returns: ReturnRow[], window = 20): VolRow[] {
  const out: VolRow[] = [];
  for (let i = 0; i < returns.length; i++) {
    if (i + 1 < window) continue;
    const slice = returns.slice(i + 1 - window, i + 1).map((r) => r.log_return);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const varp =
      slice.reduce((a, b) => a + (b - mean) * (b - mean), 0) /
      (slice.length - 1);
    out.push({ date: returns[i].date, volatility: Math.sqrt(varp) });
  }
  return out;
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
  annVol,
  mdd,
  var95_1d,
}: {
  annVol: number | null;
  mdd: number | null;
  var95_1d: number | null;
}) {
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
  const ticker = decodeURIComponent(raw || "").trim().toUpperCase();

  const baseUrl = getBaseUrl();

  const pricesRes = await fetch(
    `${baseUrl}/api/equities/${encodeURIComponent(ticker)}?limit=1000`,
    { cache: "no-store" }
  );

  if (!pricesRes.ok) {
    const text = await pricesRes.text().catch(() => "");
    throw new Error(`Failed to fetch equities (${pricesRes.status}): ${text}`);
  }

  const pricesJson = (await pricesRes.json()) as {
    ticker: string;
    count: number;
    rows: EquityRow[];
  };

  // API likely returns newest-first; normalize to ascending for returns math
  const rowsDesc = pricesJson.rows ?? [];
  const rowsAsc = [...rowsDesc].sort((a, b) => a.date.localeCompare(b.date));

  const returns = computeLogReturns(rowsAsc);
  const volatility = rollingVol(returns, 20);

  const featuresRes = await fetch(
    `${baseUrl}/api/features/${encodeURIComponent(ticker)}?limit=1`,
    { cache: "no-store" }
  );

  const featuresJson = featuresRes.ok
    ? ((await featuresRes.json()) as { ticker: string; rows: FeatureRow[] })
    : null;

  const latestFeature = featuresJson?.rows?.[0] ?? null;

  const lastReturn =
    returns.length > 0 ? returns[returns.length - 1].log_return : null;
  const lastVol =
    volatility.length > 0 ? volatility[volatility.length - 1].volatility : null;

  const prices = rowsAsc.map((r) => r.close);
  const chartData = buildChartData(rowsAsc);

  const annVol = returns.length >= 60 ? annualizedVolatility(returns.map((r) => r.log_return)) : null;
  const mdd = prices.length >= 60 ? maxDrawdown(prices) : null;
  const var95_1d =
    returns.length >= 60 ? var95(returns.map((r) => r.log_return)) : null;

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
            <Stat label="Data source" value={"db"} />
            <Stat
              label="Last daily return"
              value={lastReturn == null ? "n/a" : pct(lastReturn)}
            />
            <Stat
              label="20d volatility (daily)"
              value={lastVol == null ? "n/a" : pct(lastVol)}
            />
            <Stat label="Daily rows" value={rowsAsc.length} />
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
            <Stat label="Max drawdown" value={mdd == null ? "n/a" : pct(mdd)} />
            <Stat
              label="VaR 95% (1d)"
              value={var95_1d == null ? "n/a" : `-${pct(var95_1d)}`}
            />
            <Stat label="CVaR 95% (1d)" value={"n/a"} />
          </div>
        </Panel>
      </div>

      <Panel title="Risk interpretation">
        <Interpretation annVol={annVol} mdd={mdd} var95_1d={var95_1d} />
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

      <Panel title="Latest features">
        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
          <div>
            <b>ret1d:</b>{" "}
            {latestFeature?.ret1d == null ? "n/a" : pct(latestFeature.ret1d)}
          </div>
          <div>
            <b>vol20d:</b>{" "}
            {latestFeature?.vol20d == null ? "n/a" : pct(latestFeature.vol20d)}
          </div>
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
              <th style={th}>Shares</th>
              <th style={th}>Trades</th>
              <th style={th}>Turnover</th>
              <th style={th}>VWAP</th>
            </tr>
          </thead>
          <tbody>
            {rowsAsc.map((r) => (
              <tr
                key={r.date}
                style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
              >
                <td style={tdMono}>{r.date}</td>
                <td style={td}>{fmt(r.open)}</td>
                <td style={td}>{fmt(r.high)}</td>
                <td style={td}>{fmt(r.low)}</td>
                <td style={td}>{fmt(r.close)}</td>
                <td style={td}>{r.numberOfShares ?? ""}</td>
                <td style={td}>{r.numberOfTrades ?? ""}</td>
                <td style={td}>{r.turnover ?? ""}</td>
                <td style={td}>{fmt(r.vwap)}</td>
              </tr>
            ))}
            {!rowsAsc.length && (
              <tr>
                <td style={{ ...td, padding: 16 }} colSpan={9}>
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
