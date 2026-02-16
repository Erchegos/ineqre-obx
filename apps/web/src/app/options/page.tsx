"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";

interface OptionsStock {
  ticker: string;
  underlying_price: number;
  currency: string;
  expirations: string[];
  strikes: number[];
  fetched_at: string;
  total_call_oi: number;
  total_put_oi: number;
  total_oi: number;
  total_call_vol: number;
  total_put_vol: number;
  total_vol: number;
  total_contracts: number;
  pc_ratio_oi: number;
  atm_iv: number | null;
  max_pain: number | null;
  nearest_expiry: string | null;
  farthest_expiry: string | null;
  days_to_expiry: number | null;
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

function fmtExp(exp: string): string {
  if (!exp || exp.length !== 8) return exp;
  return `${exp.slice(0, 4)}-${exp.slice(4, 6)}-${exp.slice(6, 8)}`;
}

function pcColor(ratio: number): string {
  if (ratio > 1.2) return "#ef4444"; // bearish (high put OI)
  if (ratio > 0.8) return "#eab308"; // neutral
  return "#22c55e"; // bullish (low put OI)
}

function pcLabel(ratio: number): string {
  if (ratio > 1.2) return "BEARISH";
  if (ratio > 0.8) return "NEUTRAL";
  return "BULLISH";
}

export default function OptionsOverviewPage() {
  const [stocks, setStocks] = useState<OptionsStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"ticker" | "oi" | "vol" | "iv">("oi");

  useEffect(() => {
    async function fetchStocks() {
      try {
        const res = await fetch("/api/options");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setStocks(data.stocks || []);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }
    fetchStocks();
  }, []);

  const sorted = useMemo(() => {
    const s = [...stocks];
    if (sortBy === "oi") s.sort((a, b) => b.total_oi - a.total_oi);
    else if (sortBy === "vol") s.sort((a, b) => b.total_vol - a.total_vol);
    else if (sortBy === "iv") s.sort((a, b) => (b.atm_iv || 0) - (a.atm_iv || 0));
    else s.sort((a, b) => a.ticker.localeCompare(b.ticker));
    return s;
  }, [stocks, sortBy]);

  // Aggregate stats
  const totalOI = stocks.reduce((s, st) => s + st.total_oi, 0);
  const totalVol = stocks.reduce((s, st) => s + st.total_vol, 0);

  const lbl: React.CSSProperties = { fontSize: 9, color: "#555", fontFamily: "monospace", letterSpacing: "0.08em", marginBottom: 2 };
  const val: React.CSSProperties = { fontSize: 13, fontWeight: 700, fontFamily: "monospace" };
  const smVal: React.CSSProperties = { fontSize: 11, fontWeight: 600, fontFamily: "monospace" };

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", color: "#e5e5e5", fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <header style={{ borderBottom: "1px solid #1e1e2e", padding: "10px 24px", background: "#0d0d14" }}>
        <div style={{ maxWidth: 1800, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Link href="/stocks" style={{ color: "#555", textDecoration: "none", fontSize: 16, lineHeight: 1, padding: "6px 10px", border: "1px solid #1e1e2e", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center" }} title="Back to Assets">
              &larr;
            </Link>
            <div>
              <Link href="/stocks" style={{ color: "#555", fontSize: 10, textDecoration: "none", fontFamily: "monospace", letterSpacing: "0.05em" }}>
                ASSET LIST
              </Link>
              <h1 style={{ fontSize: 16, fontWeight: 800, marginTop: 2, fontFamily: "monospace", letterSpacing: "0.02em" }}>OPTIONS ANALYSIS</h1>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 10, color: "#444", fontFamily: "monospace" }}>
            {stocks.length > 0 && (
              <>
                <span>OI: {fmtK(totalOI)}</span>
                <span>VOL: {fmtK(totalVol)}</span>
                <span>{stocks.length} INSTRUMENT{stocks.length !== 1 ? "S" : ""}</span>
              </>
            )}
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1800, margin: "0 auto", padding: "16px 24px" }}>
        {loading && (
          <div style={{ ...panel, textAlign: "center", padding: 48 }}>
            <div style={{ width: 200, height: 2, background: "#1e1e2e", margin: "0 auto", overflow: "hidden" }}>
              <div style={{ width: "40%", height: "100%", background: "#3b82f6", animation: "load 1.2s ease-in-out infinite" }} />
            </div>
            <div style={{ fontSize: 11, color: "#666", marginTop: 10, fontFamily: "monospace" }}>LOADING OPTIONS DATA...</div>
            <style>{`@keyframes load { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }`}</style>
          </div>
        )}

        {error && !loading && (
          <div style={{ ...panel, borderColor: "#7f1d1d" }}>
            <div style={{ color: "#ef4444", fontWeight: 700, fontSize: 12, marginBottom: 6, fontFamily: "monospace" }}>ERROR</div>
            <div style={{ color: "#fca5a5", fontSize: 12 }}>{error}</div>
          </div>
        )}

        {!loading && !error && stocks.length === 0 && (
          <div style={{ ...panel, textAlign: "center", padding: 40, color: "#444", fontFamily: "monospace", fontSize: 12 }}>
            No options data available. Run fetch-options-daily.ts to load data.
          </div>
        )}

        {!loading && !error && stocks.length > 0 && (
          <>
            {/* Sort controls */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
              <span style={{ fontSize: 10, color: "#555", fontFamily: "monospace", marginRight: 4 }}>SORT:</span>
              {(["oi", "vol", "iv", "ticker"] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setSortBy(s)}
                  style={{
                    padding: "3px 8px", fontSize: 10, fontFamily: "monospace", cursor: "pointer", borderRadius: 1,
                    border: sortBy === s ? "1px solid #6366f1" : "1px solid #1e1e2e",
                    background: sortBy === s ? "rgba(99,102,241,0.15)" : "transparent",
                    color: sortBy === s ? "#818cf8" : "#555",
                    fontWeight: sortBy === s ? 700 : 500,
                  }}
                >
                  {s === "oi" ? "OPEN INT" : s === "vol" ? "VOLUME" : s === "iv" ? "ATM IV" : "TICKER"}
                </button>
              ))}
            </div>

            {/* Cards */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {sorted.map((stock) => {
                const hoursAgo = Math.floor((Date.now() - new Date(stock.fetched_at).getTime()) / (1000 * 60 * 60));
                const maxPainDist = stock.max_pain && stock.underlying_price > 0
                  ? ((stock.max_pain - stock.underlying_price) / stock.underlying_price * 100)
                  : null;

                return (
                  <Link
                    key={stock.ticker}
                    href={`/options/${stock.ticker}`}
                    style={{
                      display: "block",
                      padding: "16px 20px",
                      background: "#0d0d14",
                      border: "1px solid #1e1e2e",
                      textDecoration: "none",
                      color: "inherit",
                      transition: "all 0.1s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#3b82f6"; e.currentTarget.style.background = "#0e0e1a"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1e1e2e"; e.currentTarget.style.background = "#0d0d14"; }}
                  >
                    {/* Row 1: Ticker, price, P/C sentiment */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                        <span style={{ fontSize: 20, fontWeight: 800, color: "#60a5fa", fontFamily: "monospace" }}>
                          {stock.ticker}
                        </span>
                        <span style={{ fontSize: 16, fontWeight: 700, fontFamily: "monospace" }}>
                          {stock.underlying_price.toFixed(2)}
                          <span style={{ fontSize: 10, color: "#555", marginLeft: 4 }}>{stock.currency}</span>
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        {stock.atm_iv !== null && (
                          <div style={{ textAlign: "right" }}>
                            <div style={lbl}>ATM IV</div>
                            <div style={{ ...val, color: stock.atm_iv > 0.5 ? "#ef4444" : stock.atm_iv > 0.3 ? "#eab308" : "#22c55e" }}>
                              {(stock.atm_iv * 100).toFixed(1)}%
                            </div>
                          </div>
                        )}
                        <div style={{ textAlign: "right" }}>
                          <div style={lbl}>P/C RATIO</div>
                          <div style={{ ...val, color: pcColor(stock.pc_ratio_oi) }}>
                            {stock.pc_ratio_oi.toFixed(2)} <span style={{ fontSize: 9 }}>{pcLabel(stock.pc_ratio_oi)}</span>
                          </div>
                        </div>
                        <div style={{ color: hoursAgo < 24 ? "#22c55e" : hoursAgo < 48 ? "#eab308" : "#ef4444", fontSize: 9, fontFamily: "monospace", opacity: 0.7 }}>
                          {hoursAgo}H AGO
                        </div>
                      </div>
                    </div>

                    {/* Row 2: Stats grid */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 12 }}>
                      <div>
                        <div style={lbl}>TOTAL OI</div>
                        <div style={smVal}>{fmtK(stock.total_oi)}</div>
                      </div>
                      <div>
                        <div style={lbl}>CALL OI</div>
                        <div style={{ ...smVal, color: "#22c55e" }}>{fmtK(stock.total_call_oi)}</div>
                      </div>
                      <div>
                        <div style={lbl}>PUT OI</div>
                        <div style={{ ...smVal, color: "#ef4444" }}>{fmtK(stock.total_put_oi)}</div>
                      </div>
                      <div>
                        <div style={lbl}>VOLUME</div>
                        <div style={smVal}>{fmtK(stock.total_vol)}</div>
                      </div>
                      <div>
                        <div style={lbl}>MAX PAIN</div>
                        <div style={smVal}>
                          {stock.max_pain ? (
                            <>
                              ${stock.max_pain.toFixed(0)}
                              {maxPainDist !== null && (
                                <span style={{ fontSize: 9, color: maxPainDist > 0 ? "#22c55e" : "#ef4444", marginLeft: 3 }}>
                                  {maxPainDist > 0 ? "+" : ""}{maxPainDist.toFixed(1)}%
                                </span>
                              )}
                            </>
                          ) : "—"}
                        </div>
                      </div>
                      <div>
                        <div style={lbl}>NEXT EXPIRY</div>
                        <div style={smVal}>
                          {stock.nearest_expiry ? (
                            <>
                              {fmtExp(stock.nearest_expiry)}
                              {stock.days_to_expiry !== null && (
                                <span style={{ fontSize: 9, color: stock.days_to_expiry <= 7 ? "#ef4444" : "#555", marginLeft: 3 }}>
                                  {stock.days_to_expiry}d
                                </span>
                              )}
                            </>
                          ) : "—"}
                        </div>
                      </div>
                      <div>
                        <div style={lbl}>CHAIN</div>
                        <div style={smVal}>
                          {stock.expirations.length} exp · {stock.strikes.length} strikes
                        </div>
                      </div>
                    </div>

                    {/* Row 3: OI distribution bar */}
                    <div style={{ marginTop: 10 }}>
                      <div style={{ display: "flex", height: 4, borderRadius: 2, overflow: "hidden", background: "#1e1e2e" }}>
                        {stock.total_oi > 0 && (
                          <>
                            <div style={{ width: `${(stock.total_call_oi / stock.total_oi) * 100}%`, background: "#22c55e", transition: "width 0.3s" }} />
                            <div style={{ width: `${(stock.total_put_oi / stock.total_oi) * 100}%`, background: "#ef4444", transition: "width 0.3s" }} />
                          </>
                        )}
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: 8, fontFamily: "monospace", color: "#444" }}>
                        <span>CALLS {stock.total_oi > 0 ? ((stock.total_call_oi / stock.total_oi) * 100).toFixed(0) : 0}%</span>
                        <span>PUTS {stock.total_oi > 0 ? ((stock.total_put_oi / stock.total_oi) * 100).toFixed(0) : 0}%</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

const panel: React.CSSProperties = {
  background: "#0d0d14",
  border: "1px solid #1e1e2e",
  padding: "12px 16px",
};
