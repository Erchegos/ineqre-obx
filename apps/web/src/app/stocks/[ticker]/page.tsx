"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import PriceChart from "@/components/PriceChart";
import PriceDrawdownChart from "@/components/price-drawdown-chart";
import TimeframeSelector from "@/components/TimeframeSelector";

type AnalyticsData = {
  ticker: string;
  count: number;
  summary: {
    totalReturn: number;
    annualizedReturn: number;
    volatility: number;
    maxDrawdown: number;
    var95: number;
    cvar95: number;
    beta: number;
    sharpeRatio: number;
  };
  prices: Array<{ date: string; close: number }>;
  returns: Array<{ date: string; return: number }>;
  drawdown: Array<{ date: string; drawdown: number }>;
  dateRange: {
    start: string;
    end: string;
  };
};

function calculateReturnStats(returns: Array<{ date: string; return: number }>) {
  if (returns.length === 0) return null;

  const rets = returns.map(r => r.return);
  const positiveRets = rets.filter(r => r > 0);
  const negativeRets = rets.filter(r => r < 0);
  
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / rets.length;
  const stdDev = Math.sqrt(variance);
  
  const skewness = rets.reduce((a, b) => a + Math.pow((b - mean) / stdDev, 3), 0) / rets.length;
  const kurtosis = rets.reduce((a, b) => a + Math.pow((b - mean) / stdDev, 4), 0) / rets.length - 3;
  
  return {
    winRate: (positiveRets.length / rets.length) * 100,
    avgGain: positiveRets.length > 0 ? positiveRets.reduce((a, b) => a + b, 0) / positiveRets.length : 0,
    avgLoss: negativeRets.length > 0 ? negativeRets.reduce((a, b) => a + b, 0) / negativeRets.length : 0,
    bestDay: Math.max(...rets),
    worstDay: Math.min(...rets),
    skewness,
    kurtosis,
    totalDays: rets.length,
    positiveDays: positiveRets.length,
    negativeDays: negativeRets.length,
  };
}

function clampInt(v: string | null, def: number, min: number, max: number) {
  const n = v ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function fmtPct(x: number | null, digits = 2): string {
  if (x === null || !Number.isFinite(x)) return "NA";
  return (x * 100).toFixed(digits) + "%";
}

function fmtNum(x: number | null, digits = 2): string {
  if (x === null || !Number.isFinite(x)) return "NA";
  return x.toFixed(digits);
}

export default function StockTickerPage() {
  const params = useParams<{ ticker?: string }>();
  const searchParams = useSearchParams();

  const ticker = useMemo(() => {
    const t = params?.ticker;
    return typeof t === "string" && t.length ? decodeURIComponent(t).toUpperCase() : "";
  }, [params]);

  const initialLimit = useMemo(() => {
    return clampInt(searchParams.get("limit"), 1500, 20, 5000);
  }, [searchParams]);

  const [limit, setLimit] = useState<number>(initialLimit);
  const [loading, setLoading] = useState<boolean>(true);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [returnsStartDate, setReturnsStartDate] = useState<string>("");
  const [returnsEndDate, setReturnsEndDate] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!ticker) {
        setLoading(false);
        setData(null);
        setError("Missing ticker in route params.");
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const url = `/api/analytics/${encodeURIComponent(ticker)}?limit=${encodeURIComponent(
          String(limit)
        )}`;

        const res = await fetch(url, {
          method: "GET",
          headers: { accept: "application/json" },
          cache: "no-store",
        });

        if (!res.ok) {
          const text = await res.text();
          if (!cancelled) {
            setError(`Analytics API failed (${res.status} ${res.statusText}): ${text}`);
            setData(null);
          }
          return;
        }

        const json = (await res.json()) as AnalyticsData;

        if (!cancelled) {
          setData(json);
          setLoading(false);
          
          if (json.returns.length > 0) {
            const endDate = json.returns[json.returns.length - 1].date;
            const startDate = json.returns[Math.max(0, json.returns.length - 252)].date;
            setReturnsStartDate(startDate);
            setReturnsEndDate(endDate);
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? String(e));
          setData(null);
          setLoading(false);
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [ticker, limit]);

  const filteredReturns = useMemo(() => {
    if (!data?.returns) return [];
    
    return data.returns.filter(r => {
      const date = r.date;
      if (returnsStartDate && date < returnsStartDate) return false;
      if (returnsEndDate && date > returnsEndDate) return false;
      return true;
    });
  }, [data?.returns, returnsStartDate, returnsEndDate]);

  const returnStats = useMemo(() => {
    return calculateReturnStats(filteredReturns);
  }, [filteredReturns]);

  const handleDateRangePreset = (preset: string) => {
    if (!data?.returns || data.returns.length === 0) return;
    
    const endDate = data.returns[data.returns.length - 1].date;
    let startIdx = 0;
    
    switch (preset) {
      case "1M": startIdx = Math.max(0, data.returns.length - 21); break;
      case "3M": startIdx = Math.max(0, data.returns.length - 63); break;
      case "6M": startIdx = Math.max(0, data.returns.length - 126); break;
      case "1Y": startIdx = Math.max(0, data.returns.length - 252); break;
      case "3Y": startIdx = Math.max(0, data.returns.length - 756); break;
      case "All": startIdx = 0; break;
    }
    
    setReturnsStartDate(data.returns[startIdx].date);
    setReturnsEndDate(endDate);
  };

  return (
    <main style={{ padding: 24, maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 32, fontWeight: 600, margin: 0, letterSpacing: "-0.02em", color: "var(--foreground)" }}>
          {ticker || "?"}
        </h1>
        <Link
          href="/stocks"
          style={{ color: "var(--muted)", textDecoration: "none", fontSize: 14 }}
        >
          ← Back to stocks
        </Link>
        <div style={{ flex: 1 }} />
        
        <Link
          href={`/volatility/${ticker}`}
          style={{
            padding: "8px 16px",
            borderRadius: 4,
            background: "var(--card-bg)",
            border: "1px solid var(--card-border)",
            color: "var(--foreground)",
            fontSize: 13,
            fontWeight: 500,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            textDecoration: "none",
            letterSpacing: "0.01em",
            transition: "all 0.15s",
          }}
        >
          Volatility Analysis
        </Link>
      </div>

      <div style={{ marginBottom: 24, display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 13, color: "var(--muted)", letterSpacing: "0.02em", textTransform: "uppercase" }}>
          Timeframe
        </span>
        <TimeframeSelector selected={limit} onChange={setLimit} />
      </div>

      {loading && (
        <div style={{
          padding: 20,
          borderRadius: 4,
          border: "1px solid var(--border)",
          background: "var(--card-bg)",
          color: "var(--muted)",
          fontSize: 14,
        }}>
          Loading analytics...
        </div>
      )}

      {!loading && error && (
        <div style={{
          padding: 20,
          borderRadius: 4,
          border: "1px solid var(--danger)",
          background: "var(--card-bg)",
        }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6, color: "var(--danger)" }}>
            Error
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>{error}</div>
        </div>
      )}

      {!loading && data && !data.summary && (
        <div style={{
          padding: 20,
          borderRadius: 4,
          border: "1px solid var(--warning)",
          background: "var(--card-bg)",
        }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8, color: "var(--warning)" }}>
            Insufficient Data
          </div>
          <div style={{ color: "var(--muted)", lineHeight: 1.6, fontSize: 13 }}>
            This ticker has insufficient data for returns and volatility analytics.
          </div>
        </div>
      )}

      {!loading && data && data.summary && (
        <>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
            marginBottom: 28,
          }}>
            <MetricCard
              label="Total Return"
              value={fmtPct(data.summary.totalReturn)}
              colorType={data.summary.totalReturn >= 0 ? "success" : "danger"}
              tooltip="Complete percentage change from start to end of period"
            />
            <MetricCard
              label="Annualized Return"
              value={fmtPct(data.summary.annualizedReturn)}
              tooltip="Geometric average return per year, accounting for compounding"
            />
            <MetricCard 
              label="Volatility (Ann.)" 
              value={fmtPct(data.summary.volatility)} 
              tooltip="Annualized standard deviation of returns. Higher = more price fluctuation"
            />
            <MetricCard
              label="Max Drawdown"
              value={fmtPct(data.summary.maxDrawdown)}
              colorType="danger"
              tooltip="Largest peak-to-trough decline. Shows worst-case loss scenario"
            />
            <MetricCard 
              label="VaR (95%)" 
              value={fmtPct(data.summary.var95)} 
              tooltip="Maximum 1-day loss expected with 95% confidence under normal conditions"
            />
            <MetricCard 
              label="CVaR (95%)" 
              value={fmtPct(data.summary.cvar95)} 
              tooltip="Average loss on days exceeding VaR threshold. Measures tail risk severity"
            />
            <MetricCard 
              label="Beta (vs OBX)" 
              value={fmtNum(data.summary.beta, 3)} 
              tooltip="Sensitivity to OBX movements. >1: more volatile, <1: less volatile than market"
            />
            <MetricCard 
              label="Sharpe Ratio" 
              value={fmtNum(data.summary.sharpeRatio, 3)} 
              tooltip="Risk-adjusted return. >1: good, >2: very good, >3: excellent"
            />
          </div>

          <div style={{ marginBottom: 24, color: "var(--muted)", fontSize: 12, letterSpacing: "0.02em" }}>
            Sample: {data.dateRange.start} to {data.dateRange.end} ({data.count} observations)
          </div>

          <div style={{
            marginBottom: 24,
            padding: 20,
            borderRadius: 4,
            border: "1px solid var(--card-border)",
            background: "var(--card-bg)",
          }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, letterSpacing: "0.01em", color: "var(--foreground)" }}>
              Price Series
            </h2>
            <PriceChart data={data.prices} height={320} />
          </div>

          <div style={{
            marginBottom: 24,
            padding: 20,
            borderRadius: 4,
            border: "1px solid var(--card-border)",
            background: "var(--card-bg)",
          }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, letterSpacing: "0.01em", color: "var(--foreground)" }}>
              Drawdown Analysis
            </h2>
            <PriceDrawdownChart data={data.drawdown} height={280} />
          </div>

          <div style={{
            padding: 20,
            borderRadius: 4,
            border: "1px solid var(--card-border)",
            background: "var(--card-bg)",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, letterSpacing: "0.01em", color: "var(--foreground)" }}>
                Returns Analysis
              </h2>
            </div>

            <div style={{ marginBottom: 24, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                  Period:
                </span>
                {["1M", "3M", "6M", "1Y", "3Y", "All"].map(preset => (
                  <button
                    key={preset}
                    onClick={() => handleDateRangePreset(preset)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 3,
                      border: "1px solid var(--input-border)",
                      background: "var(--input-bg)",
                      color: "var(--foreground)",
                      fontSize: 12,
                      cursor: "pointer",
                      transition: "all 0.15s",
                      fontWeight: 500,
                    }}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              
              <div style={{ flex: 1 }} />
              
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="date"
                  value={returnsStartDate}
                  onChange={(e) => setReturnsStartDate(e.target.value)}
                  max={returnsEndDate}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 3,
                    border: "1px solid var(--input-border)",
                    background: "var(--input-bg)",
                    color: "var(--foreground)",
                    fontSize: 12,
                    fontFamily: "inherit",
                  }}
                />
                <span style={{ color: "var(--muted)" }}>→</span>
                <input
                  type="date"
                  value={returnsEndDate}
                  onChange={(e) => setReturnsEndDate(e.target.value)}
                  min={returnsStartDate}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 3,
                    border: "1px solid var(--input-border)",
                    background: "var(--input-bg)",
                    color: "var(--foreground)",
                    fontSize: 12,
                    fontFamily: "inherit",
                  }}
                />
              </div>
            </div>

            {returnStats && (
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: 12,
                marginBottom: 24,
                padding: 16,
                borderRadius: 3,
                border: "1px solid var(--border-subtle)",
                background: "var(--card-bg)",
              }}>
                <StatItem label="Win Rate" value={`${returnStats.winRate.toFixed(1)}%`} />
                <StatItem label="Avg Gain" value={fmtPct(returnStats.avgGain, 3)} colorType="success" />
                <StatItem label="Avg Loss" value={fmtPct(returnStats.avgLoss, 3)} colorType="danger" />
                <StatItem label="Best Day" value={fmtPct(returnStats.bestDay, 3)} colorType="success" />
                <StatItem label="Worst Day" value={fmtPct(returnStats.worstDay, 3)} colorType="danger" />
                <StatItem 
                  label="Skewness" 
                  value={returnStats.skewness.toFixed(3)} 
                  tooltip="Asymmetry of return distribution"
                />
                <StatItem 
                  label="Kurtosis" 
                  value={returnStats.kurtosis.toFixed(3)} 
                  tooltip="Tail heaviness"
                />
                <StatItem 
                  label="Trading Days" 
                  value={`${returnStats.positiveDays}↑ / ${returnStats.negativeDays}↓`} 
                />
              </div>
            )}

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left" }}>
                    <th style={{
                      padding: "10px 12px",
                      borderBottom: "1px solid var(--border)",
                      color: "var(--muted)",
                      fontWeight: 500,
                      fontSize: 12,
                      letterSpacing: "0.03em",
                      textTransform: "uppercase",
                    }}>
                      Date
                    </th>
                    <th style={{
                      padding: "10px 12px",
                      borderBottom: "1px solid var(--border)",
                      color: "var(--muted)",
                      fontWeight: 500,
                      fontSize: 12,
                      letterSpacing: "0.03em",
                      textTransform: "uppercase",
                      textAlign: "right",
                    }}>
                      Daily Return
                    </th>
                    <th style={{
                      padding: "10px 12px",
                      borderBottom: "1px solid var(--border)",
                      color: "var(--muted)",
                      fontWeight: 500,
                      fontSize: 12,
                      letterSpacing: "0.03em",
                      textTransform: "uppercase",
                      textAlign: "right",
                    }}>
                      Cumulative
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReturns
                    .slice(-50)
                    .reverse()
                    .map((r, idx, arr) => {
                      const cumulativeReturn = arr.slice(idx).reduce((cum, ret) => {
                        return cum * (1 + ret.return);
                      }, 1) - 1;
                      
                      return (
                        <tr key={r.date} style={{ borderTop: "1px solid var(--table-border)" }}>
                          <td style={{ padding: "10px 12px", color: "var(--foreground)" }}>
                            {r.date}
                          </td>
                          <td style={{
                            padding: "10px 12px",
                            fontFamily: "monospace",
                            textAlign: "right",
                            color: r.return > 0 ? "var(--success)" : r.return < 0 ? "var(--danger)" : "var(--foreground)",
                          }}>
                            {fmtPct(r.return, 4)}
                          </td>
                          <td style={{
                            padding: "10px 12px",
                            fontFamily: "monospace",
                            textAlign: "right",
                            color: cumulativeReturn > 0 ? "var(--success)" : cumulativeReturn < 0 ? "var(--danger)" : "var(--foreground)",
                          }}>
                            {fmtPct(cumulativeReturn, 2)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            
            <div style={{ marginTop: 12, fontSize: 11, color: "var(--muted-foreground)", textAlign: "right" }}>
              Showing last 50 days of {filteredReturns.length} total
            </div>
          </div>
        </>
      )}
    </main>
  );
}

function MetricCard({
  label,
  value,
  colorType,
  tooltip,
}: {
  label: string;
  value: string;
  colorType?: "success" | "danger" | "warning";
  tooltip?: string;
}) {
  const getColor = () => {
    if (colorType === "success") return "var(--success)";
    if (colorType === "danger") return "var(--danger)";
    if (colorType === "warning") return "var(--warning)";
    return "var(--foreground)";
  };

  return (
    <div style={{
      padding: 14,
      borderRadius: 3,
      border: "1px solid var(--card-border)",
      background: "var(--card-bg)",
      position: "relative",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.03em", textTransform: "uppercase" }}>
          {label}
        </div>
        {tooltip && (
          <div 
            style={{ 
              cursor: "help",
              color: "var(--muted-foreground)",
              transition: "color 0.2s"
            }}
            title={tooltip}
          >
            <svg 
              width="14" 
              height="14" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2"
              style={{ display: "block" }}
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
        )}
      </div>
      <div style={{
        fontSize: 22,
        fontWeight: 600,
        color: getColor(),
        fontFamily: "monospace",
      }}>
        {value}
      </div>
    </div>
  );
}

function StatItem({
  label,
  value,
  colorType,
  tooltip,
}: {
  label: string;
  value: string;
  colorType?: "success" | "danger";
  tooltip?: string;
}) {
  const getColor = () => {
    if (colorType === "success") return "var(--success)";
    if (colorType === "danger") return "var(--danger)";
    return "var(--foreground)";
  };

  return (
    <div>
      <div 
        style={{ 
          fontSize: 10, 
          color: "var(--muted-foreground)", 
          marginBottom: 4, 
          textTransform: "uppercase", 
          letterSpacing: "0.04em",
          cursor: tooltip ? "help" : "default",
        }}
        title={tooltip}
      >
        {label}
      </div>
      <div style={{
        fontSize: 15,
        fontWeight: 600,
        color: getColor(),
        fontFamily: "monospace",
      }}>
        {value}
      </div>
    </div>
  );
}