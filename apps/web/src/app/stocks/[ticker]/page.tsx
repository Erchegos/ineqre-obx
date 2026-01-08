import Link from "next/link"
import { notFound } from "next/navigation"
import PriceDrawdownChart from "@/components/price-drawdown-chart"

type PriceRow = {
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
  numberOfShares: number | null
  numberOfTrades: number | null
  turnover: number | null
  vwap: number | null
}

type ReturnRow = { date: string; log_return: number }

type PriceChartPoint = {
  date: string
  close: number | null
  drawdown: number | null
}

function getBaseUrl() {
  const explicit = process.env.NEXT_PUBLIC_BASE_URL
  if (explicit) return explicit.replace(/\/$/, "")

  if (process.env.NODE_ENV === "development") return "http://localhost:3000"

  const vercel = process.env.VERCEL_URL
  if (vercel) return `https://${vercel}`

  return "https://www.ineqre.no"
}

function fmtNum(x: number | null | undefined, digits = 2) {
  if (typeof x !== "number" || !Number.isFinite(x)) return ""
  return x.toFixed(digits)
}

function fmtInt(x: number | null | undefined) {
  if (typeof x !== "number" || !Number.isFinite(x)) return ""
  return Math.round(x).toString()
}

function buildChartData(rows: PriceRow[]): PriceChartPoint[] {
  let peak: number | null = null

  return rows.map((r) => {
    const close = typeof r.close === "number" ? r.close : null
    if (close == null) return { date: r.date, close: null, drawdown: null }

    peak = peak == null ? close : Math.max(peak, close)
    const drawdown = peak > 0 ? (close - peak) / peak : null

    return { date: r.date, close, drawdown }
  })
}

function computeLogReturns(rowsAsc: PriceRow[]): ReturnRow[] {
  const out: ReturnRow[] = []

  for (let i = 1; i < rowsAsc.length; i++) {
    const prev = rowsAsc[i - 1]?.close
    const cur = rowsAsc[i]?.close
    if (typeof prev !== "number" || typeof cur !== "number") continue
    if (prev <= 0 || cur <= 0) continue

    out.push({
      date: rowsAsc[i]!.date,
      log_return: Math.log(cur / prev),
    })
  }

  return out
}

function rollingStd(values: number[], window: number) {
  const out: Array<number | null> = []
  if (window <= 1) return values.map(() => null)

  for (let i = 0; i < values.length; i++) {
    if (i + 1 < window) {
      out.push(null)
      continue
    }
    const slice = values.slice(i + 1 - window, i + 1)
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length
    const varSum = slice.reduce((a, b) => a + (b - mean) * (b - mean), 0)
    const variance = varSum / (slice.length - 1)
    out.push(Math.sqrt(variance))
  }
  return out
}

function maxDrawdown(prices: number[]) {
  let peak = -Infinity
  let mdd = 0
  for (const p of prices) {
    peak = Math.max(peak, p)
    if (peak > 0) {
      const dd = (p - peak) / peak
      mdd = Math.min(mdd, dd)
    }
  }
  return mdd
}

export default async function StockPage(props: { params: Promise<{ ticker: string }> }) {
  const { ticker: rawTicker } = await props.params
  const ticker = decodeURIComponent(rawTicker || "").trim()
  if (!ticker) notFound()

  const baseUrl = getBaseUrl()

  const eqUrl = `${baseUrl}/api/equities/${encodeURIComponent(ticker)}?limit=1000`
  const featUrl = `${baseUrl}/api/features/${encodeURIComponent(ticker)}?limit=1`

  const [eqRes, featRes] = await Promise.all([
    fetch(eqUrl, { cache: "no-store" }),
    fetch(featUrl, { cache: "no-store" }).catch(() => null),
  ])

  if (!eqRes.ok) {
    const text = await eqRes.text().catch(() => "")
    throw new Error(`Failed to load equities ${eqRes.status}: ${text}`)
  }

  const eqJson = (await eqRes.json()) as { ticker: string; rows: PriceRow[] }
  const rowsDesc = Array.isArray(eqJson.rows) ? eqJson.rows : []
  if (rowsDesc.length === 0) notFound()

  const rowsAsc = [...rowsDesc].reverse()
  const chartData = buildChartData(rowsAsc)

  const returns = computeLogReturns(rowsAsc)
  const r = returns.map((x) => x.log_return)
  const vol20 = rollingStd(r, 20)
  const ret1d = r.length ? Math.expm1(r[r.length - 1]!) : null
  const vol20d = vol20.length ? vol20[vol20.length - 1] : null

  const pricesNum = rowsAsc
    .map((x) => x.close)
    .filter((x): x is number => typeof x === "number")

  const mdd = pricesNum.length >= 60 ? maxDrawdown(pricesNum) : null

  let featuresBlock: any = null
  if (featRes && featRes.ok) {
    featuresBlock = await featRes.json().catch(() => null)
  }

  const th: React.CSSProperties = {
    textAlign: "left",
    padding: "12px 14px",
    fontSize: 12,
    letterSpacing: 0.2,
    opacity: 0.8,
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  }

  const td: React.CSSProperties = {
    padding: "10px 14px",
    fontSize: 13,
    opacity: 0.95,
    borderTop: "1px solid rgba(255,255,255,0.06)",
    whiteSpace: "nowrap",
  }

  const tdMono: React.CSSProperties = {
    ...td,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  }

  return (
    <main style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h1 style={{ fontSize: 34, margin: 0 }}>Intelligence Equity Research</h1>
        <div style={{ opacity: 0.7 }}>
          <Link href="/stocks" style={{ textDecoration: "none" }}>
            Back to universe
          </Link>
        </div>
      </div>

      <div style={{ marginTop: 10, opacity: 0.8 }}>Ticker: {ticker}</div>

      <div style={{ marginTop: 18 }}>
        <div
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 14, opacity: 0.85, marginBottom: 10 }}>Price and drawdown</div>
          <PriceDrawdownChart data={chartData} height={360} />
        </div>
      </div>

      <div
        style={{
          marginTop: 14,
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 12,
        }}
      >
        <div
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 14, opacity: 0.85, marginBottom: 8 }}>Latest features</div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
            <div>ret1d: {typeof ret1d === "number" ? `${(ret1d * 100).toFixed(2)}%` : "n/a"}</div>
            <div>vol20d: {typeof vol20d === "number" ? `${(vol20d * 100).toFixed(2)}%` : "n/a"}</div>
            <div>mdd: {typeof mdd === "number" ? `${(mdd * 100).toFixed(2)}%` : "n/a"}</div>
          </div>

          {featuresBlock ? (
            <div style={{ marginTop: 10, opacity: 0.55, fontSize: 12 }}>
              Features source: /api/features (latest row)
            </div>
          ) : null}
        </div>

        <div
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16,
            overflow: "hidden",
          }}
        >
          <div style={{ padding: 16, fontSize: 14, opacity: 0.85 }}>Daily bars</div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
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
                {rowsDesc.map((r) => (
                  <tr key={`${r.date}`}>
                    <td style={tdMono}>{r.date}</td>
                    <td style={tdMono}>{fmtNum(r.open, 2)}</td>
                    <td style={tdMono}>{fmtNum(r.high, 2)}</td>
                    <td style={tdMono}>{fmtNum(r.low, 2)}</td>
                    <td style={tdMono}>{fmtNum(r.close, 2)}</td>
                    <td style={tdMono}>{fmtInt(r.numberOfShares)}</td>
                    <td style={tdMono}>{fmtInt(r.numberOfTrades)}</td>
                    <td style={tdMono}>{fmtInt(r.turnover)}</td>
                    <td style={tdMono}>{fmtNum(r.vwap, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ padding: 16, opacity: 0.55, fontSize: 12 }}>Data source: Postgres (obx_equities)</div>
        </div>
      </div>
    </main>
  )
}
