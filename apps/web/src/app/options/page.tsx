"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface OptionsStock {
  ticker: string;
  underlying_price: number;
  currency: string;
  expirations: string[];
  strikes: number[];
  fetched_at: string;
}

export default function OptionsOverviewPage() {
  const [stocks, setStocks] = useState<OptionsStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          <div style={{ fontSize: 10, color: "#444", fontFamily: "monospace" }}>
            {stocks.length > 0 && `${stocks.length} INSTRUMENT${stocks.length !== 1 ? "S" : ""}`}
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

        {!loading && !error && (
          <div style={panel}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", color: "#888", fontFamily: "monospace", marginBottom: 16 }}>
              AVAILABLE INSTRUMENTS ({stocks.length})
            </div>

            {stocks.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "#444", fontFamily: "monospace", fontSize: 12 }}>
                No options data available. Run fetch-options-daily.ts to load data.
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
                {stocks.map((stock) => {
                  const lastUpdated = new Date(stock.fetched_at);
                  const hoursAgo = Math.floor((Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60));

                  return (
                    <Link
                      key={stock.ticker}
                      href={`/options/${stock.ticker}`}
                      style={{
                        display: "block",
                        padding: "14px 16px",
                        background: "#0a0a0f",
                        border: "1px solid #1e1e2e",
                        textDecoration: "none",
                        color: "inherit",
                        transition: "all 0.1s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = "#3b82f6";
                        e.currentTarget.style.background = "#0d0d18";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = "#1e1e2e";
                        e.currentTarget.style.background = "#0a0a0f";
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                        <span style={{ fontSize: 16, fontWeight: 800, color: "#60a5fa", fontFamily: "monospace", letterSpacing: "0.02em" }}>
                          {stock.ticker}
                        </span>
                        <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace" }}>
                          {stock.underlying_price.toFixed(2)}
                          <span style={{ fontSize: 10, color: "#555", marginLeft: 4 }}>{stock.currency}</span>
                        </span>
                      </div>
                      <div style={{ fontSize: 10, color: "#555", fontFamily: "monospace", lineHeight: 1.8 }}>
                        <div>EXP: {stock.expirations.length} | STRIKES: {stock.strikes.length}</div>
                        <div style={{ color: hoursAgo < 24 ? "#22c55e" : hoursAgo < 48 ? "#eab308" : "#ef4444" }}>
                          UPD {hoursAgo}H AGO
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
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
