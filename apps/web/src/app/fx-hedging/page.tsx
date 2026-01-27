"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  BarChart,
  Bar,
} from "recharts";

// ============================================================================
// TYPES
// ============================================================================

interface FXPairData {
  pair: string;
  latest: {
    spot: number;
    date: string;
  };
  timeSeries: {
    spot: Array<{ date: string; value: number }>;
  };
}

interface StockExposure {
  ticker: string;
  name: string;
  exposure: {
    USD: number;
    EUR: number;
    GBP: number;
    NOK: number;
    OTHER: number;
  };
}

interface PortfolioStock {
  ticker: string;
  name: string;
  weight: number; // 0-100
  exposure: {
    USD: number;
    EUR: number;
    GBP: number;
    NOK: number;
    OTHER: number;
  };
}

interface WeightedExposure {
  USD: number;
  EUR: number;
  GBP: number;
  NOK: number;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function FXHedgingPage() {
  const [nokRate, setNokRate] = useState(0.0425);
  const [usdRate, setUsdRate] = useState(0.045);
  const [eurRate, setEurRate] = useState(0.035);
  const [gbpRate, setGbpRate] = useState(0.0475);

  const [fxDataUSD, setFxDataUSD] = useState<FXPairData | null>(null);
  const [fxDataEUR, setFxDataEUR] = useState<FXPairData | null>(null);
  const [fxDataGBP, setFxDataGBP] = useState<FXPairData | null>(null);

  const [availableStocks, setAvailableStocks] = useState<StockExposure[]>([]);
  const [selectedStocks, setSelectedStocks] = useState<PortfolioStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [ibkrStatus, setIbkrStatus] = useState<string>("Checking...");

  const [portfolioValue, setPortfolioValue] = useState(500_000_000);
  const [searchTerm, setSearchTerm] = useState("");

  // Fetch data
  useEffect(() => {
    async function fetchData() {
      try {
        const [resUSD, resEUR, resGBP, resExposures] = await Promise.all([
          fetch("/api/fx-pairs?pair=NOKUSD&days=252"),
          fetch("/api/fx-pairs?pair=NOKEUR&days=252"),
          fetch("/api/fx-pairs?pair=NOKGBP&days=252"),
          fetch("/api/fx-hedging/exposures"),
        ]);

        if (resUSD.ok) setFxDataUSD(await resUSD.json());
        if (resEUR.ok) setFxDataEUR(await resEUR.json());
        if (resGBP.ok) setFxDataGBP(await resGBP.json());

        if (resExposures.ok) {
          const exposureData = await resExposures.json();
          setAvailableStocks(exposureData.data || []);
        }
      } catch (e) {
        console.error("Failed to fetch data:", e);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  // Test IBKR connection
  useEffect(() => {
    async function testIBKR() {
      try {
        const res = await fetch("/api/ibkr/test", { method: "POST" });
        if (res.ok) {
          const data = await res.json();
          setIbkrStatus(data.success ? "Connected ✓" : "Disconnected");
        } else {
          setIbkrStatus("Not available");
        }
      } catch (e) {
        setIbkrStatus("Connection failed");
      }
    }

    testIBKR();
  }, []);

  // Calculate weighted exposures
  const weightedExposure: WeightedExposure = selectedStocks.reduce(
    (acc, stock) => {
      const weightFraction = stock.weight / 100;
      return {
        USD: acc.USD + stock.exposure.USD * weightFraction,
        EUR: acc.EUR + stock.exposure.EUR * weightFraction,
        GBP: acc.GBP + stock.exposure.GBP * weightFraction,
        NOK: acc.NOK + stock.exposure.NOK * weightFraction,
      };
    },
    { USD: 0, EUR: 0, GBP: 0, NOK: 0 }
  );

  // Calculate expected foreign currency cash flows
  const usdAmount = (portfolioValue * weightedExposure.USD) / 100 / 10;
  const eurAmount = (portfolioValue * weightedExposure.EUR) / 100 / 10;
  const gbpAmount = (portfolioValue * weightedExposure.GBP) / 100 / 10;

  // Use live spot rates
  const spotUSD = fxDataUSD?.latest?.spot || 10.85;
  const spotEUR = fxDataEUR?.latest?.spot || 11.65;
  const spotGBP = fxDataGBP?.latest?.spot || 12.85;

  // Calculate forward rates using CIRP
  const forwardUSD = spotUSD * ((1 + nokRate) / (1 + usdRate));
  const forwardEUR = spotEUR * ((1 + nokRate) / (1 + eurRate));
  const forwardGBP = spotGBP * ((1 + nokRate) / (1 + gbpRate));

  // Calculate proceeds
  const unhedgedUSD = usdAmount * spotUSD;
  const unhedgedEUR = eurAmount * spotEUR;
  const unhedgedGBP = gbpAmount * spotGBP;
  const unhedgedTotal = unhedgedUSD + unhedgedEUR + unhedgedGBP;

  const hedgedUSD = usdAmount * forwardUSD;
  const hedgedEUR = eurAmount * forwardEUR;
  const hedgedGBP = gbpAmount * forwardGBP;
  const hedgedTotal = hedgedUSD + hedgedEUR + hedgedGBP;

  const mmUSD = (usdAmount / (1 + usdRate)) * spotUSD * (1 + nokRate);
  const mmEUR = (eurAmount / (1 + eurRate)) * spotEUR * (1 + nokRate);
  const mmGBP = (gbpAmount / (1 + gbpRate)) * spotGBP * (1 + nokRate);
  const mmTotal = mmUSD + mmEUR + mmGBP;

  // Prepare chart data
  const chartData = fxDataUSD?.timeSeries?.spot
    ?.slice(-90)
    .map((item, idx) => ({
      date: new Date(item.date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      NOKUSD: item.value,
      NOKEUR: fxDataEUR?.timeSeries?.spot?.[idx]?.value || null,
      NOKGBP: fxDataGBP?.timeSeries?.spot?.[idx]?.value || null,
    })) || [];

  // Exposure distribution chart
  const exposureChartData = [
    { currency: "USD", exposure: weightedExposure.USD, fill: "var(--accent)" },
    { currency: "EUR", exposure: weightedExposure.EUR, fill: "var(--success)" },
    { currency: "GBP", exposure: weightedExposure.GBP, fill: "var(--warning)" },
    { currency: "NOK", exposure: weightedExposure.NOK, fill: "var(--muted)" },
  ];

  // Add stock to portfolio
  const addStock = (stock: StockExposure) => {
    if (selectedStocks.find((s) => s.ticker === stock.ticker)) return;

    const equalWeight = selectedStocks.length === 0 ? 100 : 0;
    setSelectedStocks([
      ...selectedStocks,
      {
        ticker: stock.ticker,
        name: stock.name,
        weight: equalWeight,
        exposure: stock.exposure,
      },
    ]);
  };

  // Remove stock from portfolio
  const removeStock = (ticker: string) => {
    setSelectedStocks(selectedStocks.filter((s) => s.ticker !== ticker));
  };

  // Update stock weight
  const updateWeight = (ticker: string, weight: number) => {
    setSelectedStocks(
      selectedStocks.map((s) =>
        s.ticker === ticker ? { ...s, weight: Math.max(0, Math.min(100, weight)) } : s
      )
    );
  };

  // Equal weight all stocks
  const equalizeWeights = () => {
    if (selectedStocks.length === 0) return;
    const equalWeight = 100 / selectedStocks.length;
    setSelectedStocks(
      selectedStocks.map((s) => ({ ...s, weight: equalWeight }))
    );
  };

  // Normalize weights to 100%
  const normalizeWeights = () => {
    const totalWeight = selectedStocks.reduce((sum, s) => sum + s.weight, 0);
    if (totalWeight === 0) return;
    setSelectedStocks(
      selectedStocks.map((s) => ({ ...s, weight: (s.weight / totalWeight) * 100 }))
    );
  };

  // Filtered stocks for search
  const filteredStocks = availableStocks.filter(
    (stock) =>
      (stock.ticker.toLowerCase().includes(searchTerm.toLowerCase()) ||
        stock.name.toLowerCase().includes(searchTerm.toLowerCase())) &&
      !selectedStocks.find((s) => s.ticker === stock.ticker)
  );

  const totalWeight = selectedStocks.reduce((sum, s) => sum + s.weight, 0);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--background)",
        color: "var(--foreground)",
        padding: 32,
      }}
    >
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <Link
              href="/"
              style={{
                display: "inline-block",
                padding: "8px 16px",
                border: "1px solid var(--border)",
                borderRadius: 6,
                textDecoration: "none",
                color: "var(--foreground)",
                fontSize: 13,
                transition: "all 0.15s",
              }}
            >
              ← Back
            </Link>

            <div
              style={{
                fontSize: 12,
                padding: "6px 12px",
                background: ibkrStatus.includes("✓") ? "var(--success)" : "var(--muted)",
                color: "white",
                borderRadius: 4,
                fontWeight: 600,
              }}
            >
              IBKR Gateway: {ibkrStatus}
            </div>
          </div>

          <h1
            style={{
              fontSize: 32,
              fontWeight: 700,
              marginBottom: 8,
              letterSpacing: "-0.02em",
            }}
          >
            FX Hedging Calculator
          </h1>
          <p
            style={{
              fontSize: 15,
              color: "var(--muted-foreground)",
              lineHeight: 1.6,
            }}
          >
            Build custom portfolio and analyze currency exposure with weighted simulations
          </p>
        </div>

        {/* Portfolio Builder */}
        <div style={{ marginBottom: 48 }}>
          <h2
            style={{
              fontSize: 12,
              fontWeight: 700,
              marginBottom: 16,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--muted-foreground)",
            }}
          >
            Portfolio Builder
          </h2>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 16 }}>
            {/* Stock Search */}
            <div
              style={{
                background: "var(--card-bg)",
                border: "1px solid var(--card-border)",
                borderRadius: 8,
                padding: 16,
              }}
            >
              <input
                type="text"
                placeholder="Search stocks..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid var(--input-border)",
                  borderRadius: 6,
                  background: "var(--input-bg)",
                  color: "var(--foreground)",
                  fontSize: 14,
                  marginBottom: 12,
                }}
              />

              <div
                style={{
                  maxHeight: 400,
                  overflowY: "auto",
                  display: "grid",
                  gap: 6,
                }}
              >
                {filteredStocks.slice(0, 15).map((stock) => (
                  <button
                    key={stock.ticker}
                    onClick={() => addStock(stock)}
                    style={{
                      padding: "8px 12px",
                      background: "transparent",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      textAlign: "left",
                      cursor: "pointer",
                      transition: "all 0.15s",
                      fontSize: 13,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--hover-bg)";
                      e.currentTarget.style.borderColor = "var(--accent)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.borderColor = "var(--border)";
                    }}
                  >
                    <div style={{ fontWeight: 600, fontFamily: "monospace" }}>
                      {stock.ticker}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                      {stock.name}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Selected Portfolio */}
            <div
              style={{
                background: "var(--card-bg)",
                border: "1px solid var(--card-border)",
                borderRadius: 8,
                padding: 16,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  Selected Portfolio ({selectedStocks.length} stocks)
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={equalizeWeights}
                    disabled={selectedStocks.length === 0}
                    style={{
                      padding: "6px 12px",
                      background: "var(--accent)",
                      color: "white",
                      border: "none",
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: selectedStocks.length === 0 ? "not-allowed" : "pointer",
                      opacity: selectedStocks.length === 0 ? 0.5 : 1,
                    }}
                  >
                    Equal Weight
                  </button>
                  <button
                    onClick={normalizeWeights}
                    disabled={selectedStocks.length === 0}
                    style={{
                      padding: "6px 12px",
                      background: "var(--success)",
                      color: "white",
                      border: "none",
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: selectedStocks.length === 0 ? "not-allowed" : "pointer",
                      opacity: selectedStocks.length === 0 ? 0.5 : 1,
                    }}
                  >
                    Normalize
                  </button>
                </div>
              </div>

              <div
                style={{
                  fontSize: 13,
                  marginBottom: 12,
                  padding: "8px 12px",
                  background: totalWeight === 100 ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
                  border: `1px solid ${totalWeight === 100 ? "var(--success)" : "var(--danger)"}`,
                  borderRadius: 6,
                  color: totalWeight === 100 ? "var(--success)" : "var(--danger)",
                  fontWeight: 600,
                }}
              >
                Total Weight: {totalWeight.toFixed(2)}%
              </div>

              <div style={{ maxHeight: 350, overflowY: "auto", display: "grid", gap: 8 }}>
                {selectedStocks.map((stock) => (
                  <div
                    key={stock.ticker}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "100px 1fr 80px 40px",
                      gap: 12,
                      alignItems: "center",
                      padding: "8px 12px",
                      background: "var(--input-bg)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ fontWeight: 600, fontFamily: "monospace", fontSize: 13 }}>
                      {stock.ticker}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                      USD {stock.exposure.USD}% · EUR {stock.exposure.EUR}% · GBP {stock.exposure.GBP}%
                    </div>
                    <input
                      type="number"
                      value={stock.weight}
                      onChange={(e) => updateWeight(stock.ticker, Number(e.target.value))}
                      step={0.1}
                      style={{
                        padding: "6px 8px",
                        border: "1px solid var(--input-border)",
                        borderRadius: 4,
                        background: "var(--background)",
                        color: "var(--foreground)",
                        fontSize: 12,
                        fontFamily: "monospace",
                        textAlign: "right",
                      }}
                    />
                    <button
                      onClick={() => removeStock(stock.ticker)}
                      style={{
                        padding: "6px",
                        background: "var(--danger)",
                        color: "white",
                        border: "none",
                        borderRadius: 4,
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Portfolio Exposure Summary */}
        {selectedStocks.length > 0 && (
          <div style={{ marginBottom: 48 }}>
            <h2
              style={{
                fontSize: 12,
                fontWeight: 700,
                marginBottom: 16,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--muted-foreground)",
              }}
            >
              Weighted Portfolio Exposure
            </h2>

            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
              <div
                style={{
                  background: "var(--card-bg)",
                  border: "1px solid var(--card-border)",
                  borderRadius: 8,
                  padding: 24,
                }}
              >
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={exposureChartData}>
                    <CartesianGrid
                      stroke="var(--border-subtle)"
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="currency"
                      stroke="var(--muted)"
                      fontSize={12}
                      tickLine={false}
                    />
                    <YAxis
                      stroke="var(--muted)"
                      fontSize={12}
                      tickLine={false}
                      label={{ value: "%", angle: -90, position: "insideLeft", style: { fontSize: 12 } }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "var(--card-bg)",
                        border: "1px solid var(--card-border)",
                        borderRadius: 6,
                        fontSize: 13,
                      }}
                      formatter={(value: number | undefined) => value ? `${value.toFixed(2)}%` : "0%"}
                    />
                    <Bar dataKey="exposure" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div style={{ display: "grid", gap: 16 }}>
                <MetricCard label="Portfolio Value" value={`NOK ${(portfolioValue / 1_000_000).toFixed(0)}M`} />
                <MetricCard label="USD Exposure" value={`${weightedExposure.USD.toFixed(2)}%`} />
                <MetricCard label="EUR Exposure" value={`${weightedExposure.EUR.toFixed(2)}%`} />
                <MetricCard label="GBP Exposure" value={`${weightedExposure.GBP.toFixed(2)}%`} />
              </div>
            </div>
          </div>
        )}

        {/* FX Rate Charts */}
        {!loading && chartData.length > 0 && (
          <div style={{ marginBottom: 48 }}>
            <h2
              style={{
                fontSize: 12,
                fontWeight: 700,
                marginBottom: 16,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--muted-foreground)",
              }}
            >
              Spot Rates (90 Days)
            </h2>
            <div
              style={{
                background: "var(--card-bg)",
                border: "1px solid var(--card-border)",
                borderRadius: 8,
                padding: 24,
              }}
            >
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                  <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" stroke="var(--muted)" fontSize={12} tickLine={false} />
                  <YAxis stroke="var(--muted)" fontSize={12} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--card-bg)",
                      border: "1px solid var(--card-border)",
                      borderRadius: 6,
                      fontSize: 13,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 13, paddingTop: 16 }} />
                  <Line type="monotone" dataKey="NOKUSD" stroke="var(--accent)" strokeWidth={2} dot={false} name="NOK/USD" />
                  <Line type="monotone" dataKey="NOKEUR" stroke="var(--success)" strokeWidth={2} dot={false} name="NOK/EUR" />
                  <Line type="monotone" dataKey="NOKGBP" stroke="var(--warning)" strokeWidth={2} dot={false} name="NOK/GBP" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Calculator Settings */}
        <div style={{ marginBottom: 48 }}>
          <h2
            style={{
              fontSize: 12,
              fontWeight: 700,
              marginBottom: 16,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--muted-foreground)",
            }}
          >
            Settings
          </h2>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
            <InputCard label="Portfolio Value" value={portfolioValue} onChange={setPortfolioValue} prefix="NOK" step={1000000} />
            <InputCard label="NOK Rate" value={nokRate * 100} onChange={(v) => setNokRate(v / 100)} suffix="%" step={0.01} />
            <InputCard label="USD Rate" value={usdRate * 100} onChange={(v) => setUsdRate(v / 100)} suffix="%" step={0.01} />
            <InputCard label="EUR Rate" value={eurRate * 100} onChange={(v) => setEurRate(v / 100)} suffix="%" step={0.01} />
            <InputCard label="GBP Rate" value={gbpRate * 100} onChange={(v) => setGbpRate(v / 100)} suffix="%" step={0.01} />
          </div>
        </div>

        {/* Expected Cash Flows */}
        {selectedStocks.length > 0 && (
          <div style={{ marginBottom: 48 }}>
            <h2
              style={{
                fontSize: 12,
                fontWeight: 700,
                marginBottom: 16,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--muted-foreground)",
              }}
            >
              Expected Foreign Currency Dividends (12M)
            </h2>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
              <MetricCard label="USD Dividends" value={`$${(usdAmount / 1_000_000).toFixed(2)}M`} />
              <MetricCard label="EUR Dividends" value={`€${(eurAmount / 1_000_000).toFixed(2)}M`} />
              <MetricCard label="GBP Dividends" value={`£${(gbpAmount / 1_000_000).toFixed(2)}M`} />
            </div>
          </div>
        )}

        {/* Market Data */}
        <div style={{ marginBottom: 48 }}>
          <h2
            style={{
              fontSize: 12,
              fontWeight: 700,
              marginBottom: 16,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--muted-foreground)",
            }}
          >
            Current Rates
          </h2>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
            <MetricCard label="NOK/USD Spot" value={spotUSD.toFixed(4)} />
            <MetricCard label="NOK/EUR Spot" value={spotEUR.toFixed(4)} />
            <MetricCard label="NOK/GBP Spot" value={spotGBP.toFixed(4)} />
            <MetricCard label="NOK/USD Forward" value={forwardUSD.toFixed(4)} />
            <MetricCard label="NOK/EUR Forward" value={forwardEUR.toFixed(4)} />
            <MetricCard label="NOK/GBP Forward" value={forwardGBP.toFixed(4)} />
          </div>
        </div>

        {/* Results Comparison */}
        {selectedStocks.length > 0 && totalWeight === 100 && (
          <div style={{ marginBottom: 48 }}>
            <h2
              style={{
                fontSize: 12,
                fontWeight: 700,
                marginBottom: 16,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--muted-foreground)",
              }}
            >
              Hedging Strategies
            </h2>

            <div
              style={{
                background: "var(--card-bg)",
                border: "1px solid var(--card-border)",
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ background: "var(--muted)", borderBottom: "1px solid var(--table-border)" }}>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>Strategy</th>
                    <th style={{ padding: "12px 16px", textAlign: "right", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>USD NOK</th>
                    <th style={{ padding: "12px 16px", textAlign: "right", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>EUR NOK</th>
                    <th style={{ padding: "12px 16px", textAlign: "right", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>GBP NOK</th>
                    <th style={{ padding: "12px 16px", textAlign: "right", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>Total NOK</th>
                    <th style={{ padding: "12px 16px", textAlign: "right", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>vs. Unhedged</th>
                  </tr>
                </thead>
                <tbody>
                  <TableRow label="Unhedged (Spot)" usd={unhedgedUSD} eur={unhedgedEUR} gbp={unhedgedGBP} total={unhedgedTotal} baseline={unhedgedTotal} />
                  <TableRow label="Forward Hedge" usd={hedgedUSD} eur={hedgedEUR} gbp={hedgedGBP} total={hedgedTotal} baseline={unhedgedTotal} />
                  <TableRow label="Money Market Hedge" usd={mmUSD} eur={mmEUR} gbp={mmGBP} total={mmTotal} baseline={unhedgedTotal} />
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

function TableRow({ label, usd, eur, gbp, total, baseline }: { label: string; usd: number; eur: number; gbp: number; total: number; baseline: number }) {
  const diff = total - baseline;
  const pct = (diff / baseline) * 100;

  return (
    <tr style={{ borderBottom: "1px solid var(--table-border)", transition: "background 0.15s" }}>
      <td style={{ padding: "12px 16px", fontWeight: 600 }}>{label}</td>
      <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: "monospace", fontSize: 13 }}>{formatNOK(usd)}</td>
      <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: "monospace", fontSize: 13 }}>{formatNOK(eur)}</td>
      <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: "monospace", fontSize: 13 }}>{formatNOK(gbp)}</td>
      <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>{formatNOK(total)}</td>
      <td style={{ padding: "12px 16px", textAlign: "right", color: diff === 0 ? "var(--muted-foreground)" : diff > 0 ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>
        {diff === 0 ? "—" : formatPct(pct / 100)}
      </td>
    </tr>
  );
}

function InputCard({ label, value, onChange, prefix, suffix, step = 1 }: { label: string; value: number; onChange: (v: number) => void; prefix?: string; suffix?: string; step?: number }) {
  return (
    <div style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)", borderRadius: 8, padding: 16 }}>
      <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted-foreground)" }}>{label}</label>
      <div style={{ position: "relative" }}>
        {prefix && <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted-foreground)", fontSize: 14 }}>{prefix}</span>}
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          step={step}
          style={{ width: "100%", padding: "10px 12px", paddingLeft: prefix ? 42 : 12, paddingRight: suffix ? 32 : 12, border: "1px solid var(--input-border)", borderRadius: 6, background: "var(--input-bg)", color: "var(--foreground)", fontSize: 14, fontFamily: "monospace" }}
        />
        {suffix && <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted-foreground)", fontSize: 13 }}>{suffix}</span>}
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)", borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "monospace" }}>{value}</div>
    </div>
  );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function formatNOK(value: number): string {
  return new Intl.NumberFormat("no-NO", { style: "decimal", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
}

function formatPct(value: number): string {
  return (value >= 0 ? "+" : "") + (value * 100).toFixed(2) + "%";
}
