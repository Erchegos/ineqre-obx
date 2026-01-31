"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import CorrelationHeatmap from "@/components/CorrelationHeatmap";
import RollingCorrelationChart from "@/components/RollingCorrelationChart";

// Helper function to calculate significance stars for correlation
function getSignificanceStars(correlation: number, n: number = 252): string {
  // T-statistic for correlation: t = r * sqrt((n-2) / (1-r^2))
  const r = correlation;
  const tStat = Math.abs(r) * Math.sqrt((n - 2) / (1 - r * r));

  // Approximate p-values based on t-statistic
  // For large samples (n>120), use normal approximation
  if (tStat > 3.29) return '***'; // p < 0.001
  if (tStat > 2.58) return '**';  // p < 0.01
  if (tStat > 1.96) return '*';   // p < 0.05
  return '';                       // Not significant
}

const PRESET_GROUPS = {
  "Norwegian Equities": ["AKER", "DNB", "EQNR", "MOWI", "OBX"],
  "Energy Giants": ["EQNR", "AKRBP", "VAR", "OBX"],
  "Seafood": ["MOWI", "SALM", "LSG", "OBX"],
  "Finance": ["DNB", "SB1NO", "MING", "STB"],
  "100B+ Club": ["DNB", "EQNR", "MOWI", "TEL", "YAR", "NHY", "AKRBP"],
};

const TIMEFRAMES = [
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "3Y", days: 1095 },
  { label: "5Y", days: 1825 },
];

const ROLLING_WINDOWS = [
  { label: "20D", days: 20 },
  { label: "60D", days: 60 },
  { label: "120D", days: 120 },
  { label: "252D", days: 252 },
];

type Stock = {
  ticker: string;
  name: string;
  sector: string | null;
};

export default function CorrelationPage() {
  const [selectedTickers, setSelectedTickers] = useState<string[]>([
    "AKER",
    "DNB",
    "EQNR",
    "OBX",
  ]);
  const [availableTickers, setAvailableTickers] = useState<string[]>([]);
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [selectedSectors, setSelectedSectors] = useState<Set<string>>(new Set());
  const [tickerInput, setTickerInput] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [showTickerPanel, setShowTickerPanel] = useState(false);
  const [sortBy, setSortBy] = useState<"alpha" | "selected">("alpha");

  const [correlationData, setCorrelationData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCorrelationInfo, setShowCorrelationInfo] = useState(false);

  // Settings
  const [timeframe, setTimeframe] = useState(365);
  const [rollingWindow, setRollingWindow] = useState(60);
  const [dataMode, setDataMode] = useState<"price" | "total_return">("total_return");
  const [matrixMode, setMatrixMode] = useState<"correlation" | "covariance">("correlation");

  useEffect(() => {
    fetchTickers();
  }, []);

  async function fetchTickers() {
    try {
      const res = await fetch("/api/stocks");
      if (res.ok) {
        const stocksData = await res.json();
        setStocks(stocksData);
        const tickers = stocksData.map((stock: any) => stock.ticker);
        setAvailableTickers(tickers);
      }
    } catch (e) {
      console.error("Failed to fetch tickers:", e);
    }
  }

  const availableSectors = Array.from(
    new Set(stocks.map(s => s.sector).filter(Boolean))
  ).sort() as string[];

  const filteredStocks = selectedSectors.size > 0
    ? stocks.filter(s => s.sector && selectedSectors.has(s.sector))
    : stocks;

  const filteredTickersBySector = filteredStocks.map(s => s.ticker);

  const filteredTickers = availableTickers.filter(
    (t) =>
      t.toLowerCase().includes(tickerInput.toLowerCase()) &&
      !selectedTickers.includes(t) &&
      (selectedSectors.size === 0 || filteredTickersBySector.includes(t))
  );

  const sortedTickers = [...availableTickers].filter(t =>
    selectedSectors.size === 0 || filteredTickersBySector.includes(t)
  ).sort((a, b) => {
    if (sortBy === "selected") {
      const aSelected = selectedTickers.includes(a);
      const bSelected = selectedTickers.includes(b);
      if (aSelected && !bSelected) return -1;
      if (!aSelected && bSelected) return 1;
    }
    return a.localeCompare(b);
  });

  function handlePresetGroup(group: keyof typeof PRESET_GROUPS) {
    setSelectedTickers(PRESET_GROUPS[group]);
  }

  function addTicker(ticker: string) {
    if (!selectedTickers.includes(ticker)) {
      setSelectedTickers([...selectedTickers, ticker]);
    }
    setTickerInput("");
    setShowDropdown(false);
  }

  function removeTicker(ticker: string) {
    setSelectedTickers(selectedTickers.filter((t) => t !== ticker));
  }

  async function computeCorrelations() {
    if (selectedTickers.length < 2) {
      setError("Minimum 2 tickers required");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        tickers: selectedTickers.join(","),
        limit: timeframe.toString(),
        window: rollingWindow.toString(),
        mode: dataMode,
      });

      const res = await fetch(`/api/correlation?${params}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to compute correlations");
        setCorrelationData(null);
      } else {
        setCorrelationData(data);
      }
    } catch (e: any) {
      setError(e.message);
      setCorrelationData(null);
    } finally {
      setLoading(false);
    }
  }

  function exportToCSV() {
    try {
      if (!correlationData?.matrix) {
        alert('No correlation data to export');
        return;
      }

      const { tickers, values } = correlationData.matrix;
      const csvLines: string[] = [];

      // Header Section
      csvLines.push('=== CORRELATION MATRIX EXPORT ===');
      csvLines.push('');
      csvLines.push('EXPORT DETAILS');
      csvLines.push(`Export Date,${new Date().toISOString().split('T')[0]}`);
      csvLines.push(`Data Period,${correlationData.startDate} to ${correlationData.endDate}`);
      csvLines.push(`Observations,${correlationData.observations} days`);
      csvLines.push(`Data Mode,${dataMode === 'total_return' ? 'Total Return (Adjusted)' : 'Price (Raw)'}`);
      csvLines.push(`Rolling Window,${rollingWindow} days`);
      csvLines.push(`Lookback Period,${timeframe} days`);
      csvLines.push('');
      csvLines.push('');

      // Correlation with OBX Index (if OBX is in the data)
      const obxIndex = tickers.indexOf('OBX');
      if (obxIndex !== -1 && obxIndex < values.length) {
        csvLines.push('=== CORRELATION WITH OBX INDEX ===');
        csvLines.push('(Each stock\'s correlation with the Oslo Børs Benchmark Index)');
        csvLines.push('');
        csvLines.push('Ticker,Correlation with OBX,Strength');

        const obxCorrelations: Array<{ ticker: string; corr: number; strength: string }> = [];

        for (let i = 0; i < tickers.length && i < values.length; i++) {
          const ticker = tickers[i];
          if (ticker === 'OBX') continue;

          const row = values[i];
          if (!row || !Array.isArray(row) || row.length <= obxIndex) continue;

          const corr = row[obxIndex];
          if (typeof corr !== 'number' || isNaN(corr)) continue;

          let strength = '';
          if (Math.abs(corr) >= 0.7) strength = 'Strong';
          else if (Math.abs(corr) >= 0.4) strength = 'Moderate';
          else if (Math.abs(corr) >= 0.2) strength = 'Weak';
          else strength = 'Very Weak';

          obxCorrelations.push({ ticker, corr, strength });
        }

        obxCorrelations
          .sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr))
          .forEach(item => {
            csvLines.push(`${item.ticker},${item.corr.toFixed(4)},${item.strength}`);
          });

        csvLines.push('');
        csvLines.push('');
      }

      // Full Correlation Matrix
      csvLines.push('=== FULL CORRELATION MATRIX ===');
      csvLines.push('');

      // Matrix header row
      csvLines.push(['', ...tickers].join(','));

      // Matrix data rows
      values.forEach((row: number[], i: number) => {
        const rowData = [
          tickers[i] === 'OBX' ? 'OBX [INDEX]' : tickers[i],
          ...row.map((v: number) => v.toFixed(4))
        ];
        csvLines.push(rowData.join(','));
      });

      csvLines.push('');
      csvLines.push('');

      // Average Correlations
      if (correlationData.averageCorrelations) {
        csvLines.push('=== AVERAGE CORRELATIONS ===');
        csvLines.push('(Mean correlation of each ticker with all other tickers)');
        csvLines.push('');
        csvLines.push('Rank,Ticker,Average Correlation');
        correlationData.averageCorrelations.forEach((item: any, idx: number) => {
          const tickerLabel = item.ticker === 'OBX' ? 'OBX [INDEX]' : item.ticker;
          csvLines.push(`${idx + 1},${tickerLabel},${item.avgCorrelation.toFixed(4)}`);
        });
        csvLines.push('');
        csvLines.push('');
      }

      // Market Regime Distribution
      if (correlationData.regimeDistribution) {
        csvLines.push('=== MARKET REGIME DISTRIBUTION ===');
        csvLines.push('(Based on rolling volatility analysis)');
        csvLines.push('');
        csvLines.push('Regime,Percentage');
        Object.entries(correlationData.regimeDistribution).forEach(([regime, pct]) => {
          csvLines.push(`${regime},${(pct as number).toFixed(2)}%`);
        });
        csvLines.push('');
        csvLines.push('');
      }

      // Footer
      csvLines.push('=== END OF REPORT ===');

      const csv = csvLines.join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `correlation_matrix_${dataMode}_${timeframe}d_${new Date().toISOString().split('T')[0]}.csv`;

      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);

    } catch (error) {
      console.error('Error exporting CSV:', error);
      alert('Error exporting CSV: ' + error);
    }
  }

  const currentDate = new Date().toISOString().split('T')[0];

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--background)",
      color: "var(--foreground)",
      padding: 32
    }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .search-input {
          width: 100%;
          padding: 12px 16px;
          font-size: 14px;
          border: 1px solid var(--border);
          border-radius: 4px;
          background: var(--card-bg);
          color: var(--foreground);
          outline: none;
          transition: border-color 0.2s;
        }
        .search-input:focus {
          border-color: var(--accent);
        }
        .search-input::placeholder {
          color: var(--muted);
        }
        .stat-box {
          background: var(--card-bg);
          border: 1px solid var(--border);
          transition: all 0.15s;
        }
        .stat-box:hover {
          border-color: var(--accent);
        }
      `}} />

      <div style={{ maxWidth: 1400, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <h1 style={{ fontSize: 32, fontWeight: 700, margin: 0 }}>
              Correlation Matrix
            </h1>
            <Link
              href="/stocks"
              style={{
                display: "inline-block",
                color: "var(--foreground)",
                textDecoration: "none",
                fontSize: 13,
                fontWeight: 500,
                padding: "8px 16px",
                border: "1px solid var(--border)",
                borderRadius: 4,
                background: "var(--card-bg)",
                transition: "all 0.15s ease"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--foreground)";
                e.currentTarget.style.background = "var(--hover-bg)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.background = "var(--card-bg)";
              }}
            >
              Back to Assets
            </Link>
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            Last updated: {currentDate}
          </div>
        </div>
        <p style={{ color: "var(--muted)", marginBottom: 24, fontSize: 14 }}>
          Quantitative correlation and regime analysis
        </p>

        {/* Quick Presets - Prominent */}
        <div style={{
          background: "var(--card-bg)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          padding: 20,
          marginBottom: 16
        }}>
          <h3 style={{ fontSize: 12, fontWeight: 600, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted-foreground)" }}>
            Quick Presets
          </h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {Object.keys(PRESET_GROUPS).map((group) => (
              <button
                key={group}
                onClick={() => handlePresetGroup(group as keyof typeof PRESET_GROUPS)}
                style={{
                  padding: "8px 14px",
                  background: "var(--card-bg)",
                  color: "var(--foreground)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 500,
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--accent)";
                  e.currentTarget.style.background = "var(--hover-bg)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)";
                  e.currentTarget.style.background = "var(--card-bg)";
                }}
              >
                {group}
              </button>
            ))}
          </div>
        </div>

        {/* Settings Panel - More Prominent */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 16,
          marginBottom: 16
        }}>
          {/* Lookback Period */}
          <div style={{
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: 16
          }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Lookback Period
            </label>
            <div style={{ display: "flex", gap: 4 }}>
              {TIMEFRAMES.map((tf) => {
                const isSelected = timeframe === tf.days;
                return (
                  <button
                    key={tf.days}
                    onClick={() => setTimeframe(tf.days)}
                    style={{
                      flex: 1,
                      padding: "8px 4px",
                      fontSize: 12,
                      fontWeight: 500,
                      border: isSelected ? "1px solid var(--accent)" : "1px solid var(--border)",
                      borderRadius: 3,
                      background: isSelected ? "var(--accent)" : "var(--card-bg)",
                      color: isSelected ? "#fff" : "var(--foreground)",
                      cursor: "pointer",
                      transition: "all 0.15s"
                    }}
                  >
                    {tf.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Rolling Window */}
          <div style={{
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: 16
          }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Rolling Window
            </label>
            <div style={{ display: "flex", gap: 4 }}>
              {ROLLING_WINDOWS.map((rw) => {
                const isSelected = rollingWindow === rw.days;
                return (
                  <button
                    key={rw.days}
                    onClick={() => setRollingWindow(rw.days)}
                    style={{
                      flex: 1,
                      padding: "8px 4px",
                      fontSize: 12,
                      fontWeight: 500,
                      border: isSelected ? "1px solid var(--accent)" : "1px solid var(--border)",
                      borderRadius: 3,
                      background: isSelected ? "var(--accent)" : "var(--card-bg)",
                      color: isSelected ? "#fff" : "var(--foreground)",
                      cursor: "pointer",
                      transition: "all 0.15s"
                    }}
                  >
                    {rw.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Data Mode */}
          <div style={{
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: 16
          }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Data Mode
            </label>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                onClick={() => setDataMode("price")}
                style={{
                  flex: 1,
                  padding: "8px 4px",
                  fontSize: 12,
                  fontWeight: 500,
                  border: dataMode === "price" ? "1px solid var(--accent)" : "1px solid var(--border)",
                  borderRadius: 3,
                  background: dataMode === "price" ? "var(--accent)" : "var(--card-bg)",
                  color: dataMode === "price" ? "#fff" : "var(--foreground)",
                  cursor: "pointer",
                  transition: "all 0.15s"
                }}
              >
                Price
              </button>
              <button
                onClick={() => setDataMode("total_return")}
                style={{
                  flex: 1,
                  padding: "8px 4px",
                  fontSize: 12,
                  fontWeight: 500,
                  border: dataMode === "total_return" ? "1px solid var(--accent)" : "1px solid var(--border)",
                  borderRadius: 3,
                  background: dataMode === "total_return" ? "var(--accent)" : "var(--card-bg)",
                  color: dataMode === "total_return" ? "#fff" : "var(--foreground)",
                  cursor: "pointer",
                  transition: "all 0.15s"
                }}
              >
                Total Return
              </button>
            </div>
          </div>

          {/* Matrix Type */}
          <div style={{
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: 16
          }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Matrix Type
            </label>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                onClick={() => setMatrixMode("correlation")}
                style={{
                  flex: 1,
                  padding: "8px 4px",
                  fontSize: 12,
                  fontWeight: 500,
                  border: matrixMode === "correlation" ? "1px solid var(--accent)" : "1px solid var(--border)",
                  borderRadius: 3,
                  background: matrixMode === "correlation" ? "var(--accent)" : "var(--card-bg)",
                  color: matrixMode === "correlation" ? "#fff" : "var(--foreground)",
                  cursor: "pointer",
                  transition: "all 0.15s"
                }}
              >
                Corr
              </button>
              <button
                onClick={() => setMatrixMode("covariance")}
                style={{
                  flex: 1,
                  padding: "8px 4px",
                  fontSize: 12,
                  fontWeight: 500,
                  border: matrixMode === "covariance" ? "1px solid var(--accent)" : "1px solid var(--border)",
                  borderRadius: 3,
                  background: matrixMode === "covariance" ? "var(--accent)" : "var(--card-bg)",
                  color: matrixMode === "covariance" ? "#fff" : "var(--foreground)",
                  cursor: "pointer",
                  transition: "all 0.15s"
                }}
              >
                Cov
              </button>
            </div>
          </div>
        </div>

        {/* Ticker Selection */}
        <div style={{
          background: "var(--card-bg)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          padding: 20,
          marginBottom: 16
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted-foreground)", margin: 0 }}>
              Selection ({selectedTickers.length})
            </h3>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setShowTickerPanel(!showTickerPanel)}
                style={{
                  background: "none",
                  border: "1px solid var(--border)",
                  fontSize: 11,
                  color: "var(--accent)",
                  cursor: "pointer",
                  padding: "4px 8px",
                  borderRadius: 3,
                  fontWeight: 500
                }}
              >
                {showTickerPanel ? "Hide" : "Show"} All
              </button>
              {selectedTickers.length > 0 && (
                <button
                  onClick={() => setSelectedTickers([])}
                  style={{ background: "none", border: "none", fontSize: 11, color: "var(--danger)", cursor: "pointer", padding: 0 }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div style={{ position: "relative", marginBottom: 16 }}>
            <input
              type="text"
              value={tickerInput}
              onChange={(e) => {
                setTickerInput(e.target.value);
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
              placeholder="Search tickers..."
              className="search-input"
            />

            {showDropdown && tickerInput && filteredTickers.length > 0 && (
              <div style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                right: 0,
                background: "var(--card-bg)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                maxHeight: 240,
                overflowY: "auto",
                zIndex: 20,
                boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
              }}>
                {filteredTickers.slice(0, 50).map((ticker) => (
                  <div
                    key={ticker}
                    onClick={() => addTicker(ticker)}
                    style={{
                      padding: "10px 12px",
                      cursor: "pointer",
                      fontSize: 13,
                      borderBottom: "1px solid var(--border)",
                      transition: "background 0.1s"
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "var(--hover-bg)"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  >
                    {ticker}
                  </div>
                ))}
              </div>
            )}
          </div>

          {selectedTickers.length === 0 ? (
            <span style={{ fontSize: 13, color: "var(--muted)" }}>
              No tickers selected
            </span>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {selectedTickers.map((ticker) => (
                <div
                  key={ticker}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 12px",
                    background: "rgba(59, 130, 246, 0.15)",
                    color: "rgb(59, 130, 246)",
                    border: "1px solid rgba(59, 130, 246, 0.3)",
                    borderRadius: 3,
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {ticker}
                  <button
                    onClick={() => removeTicker(ticker)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "currentColor",
                      cursor: "pointer",
                      fontSize: 16,
                      lineHeight: 0.5,
                      padding: "0 2px",
                      opacity: 0.7
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.opacity = "1"}
                    onMouseLeave={(e) => e.currentTarget.style.opacity = "0.7"}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* All Tickers Panel */}
        {showTickerPanel && (
          <div style={{
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: 20,
            marginBottom: 16,
            maxHeight: 400,
            overflowY: "auto"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
                All Tickers ({availableTickers.length})
              </h3>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as "alpha" | "selected")}
                style={{
                  padding: "4px 8px",
                  background: "var(--card-bg)",
                  color: "var(--foreground)",
                  border: "1px solid var(--border)",
                  borderRadius: 3,
                  fontSize: 11,
                }}
              >
                <option value="alpha">Alphabetical</option>
                <option value="selected">Selected First</option>
              </select>
            </div>

            {availableSectors.length > 0 && (
              <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Filter by Sector
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {availableSectors.map((sector) => {
                    const isSelected = selectedSectors.has(sector);
                    return (
                      <button
                        key={sector}
                        onClick={() => {
                          setSelectedSectors(prev => {
                            const next = new Set(prev);
                            if (next.has(sector)) {
                              next.delete(sector);
                            } else {
                              next.add(sector);
                            }
                            return next;
                          });
                        }}
                        style={{
                          padding: "4px 10px",
                          fontSize: 11.5,
                          fontWeight: 500,
                          border: isSelected ? "1px solid var(--accent)" : "1px solid var(--border)",
                          borderRadius: 3,
                          background: isSelected ? "var(--accent)" : "transparent",
                          color: isSelected ? "#fff" : "var(--foreground)",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                      >
                        {sector}
                      </button>
                    );
                  })}
                  {selectedSectors.size > 0 && (
                    <button
                      onClick={() => {
                        setSelectedSectors(new Set());
                        setSelectedTickers([]);
                      }}
                      style={{
                        padding: "4px 10px",
                        fontSize: 11.5,
                        fontWeight: 500,
                        border: "1px solid var(--danger)",
                        borderRadius: 3,
                        background: "transparent",
                        color: "var(--danger)",
                        cursor: "pointer",
                      }}
                    >
                      Clear All
                    </button>
                  )}
                </div>
              </div>
            )}

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
              gap: 8
            }}>
              {sortedTickers.map((ticker) => {
                const isSelected = selectedTickers.includes(ticker);
                return (
                  <label
                    key={ticker}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 10px",
                      background: isSelected ? "rgba(59, 130, 246, 0.1)" : "var(--card-bg)",
                      border: `1px solid ${isSelected ? "var(--accent)" : "var(--border)"}`,
                      borderRadius: 3,
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: isSelected ? 600 : 400,
                      color: isSelected ? "var(--accent)" : "var(--foreground)",
                      transition: "all 0.15s"
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => {
                        if (e.target.checked) {
                          addTicker(ticker);
                        } else {
                          removeTicker(ticker);
                        }
                      }}
                      style={{
                        width: 14,
                        height: 14,
                        cursor: "pointer",
                        accentColor: "var(--accent)"
                      }}
                    />
                    <span>{ticker}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Compute Button */}
        <button
          onClick={computeCorrelations}
          disabled={loading || selectedTickers.length < 2}
          style={{
            width: "100%",
            padding: 16,
            background: loading || selectedTickers.length < 2 ? "var(--muted)" : "var(--accent)",
            color: "white",
            border: "none",
            borderRadius: 4,
            fontSize: 14,
            fontWeight: 600,
            cursor: loading || selectedTickers.length < 2 ? "not-allowed" : "pointer",
            marginBottom: 24,
            transition: "all 0.2s",
            opacity: loading ? 0.8 : 1
          }}
        >
          {loading ? "Computing..." : `Compute Correlations (${selectedTickers.length} assets)`}
        </button>

        {/* Error */}
        {error && (
          <div style={{
            background: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgb(239, 68, 68)",
            color: "rgb(239, 68, 68)",
            padding: 16,
            borderRadius: 4,
            marginBottom: 24,
            fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {/* Results */}
        {correlationData && (
          <div>

            {/* Data Quality Indicator */}
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 24,
              padding: 16,
              background: "var(--card-bg)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              fontSize: 12,
              color: "var(--muted-foreground)"
            }}>
              <div style={{ display: "flex", gap: 24 }}>
                <span><strong>Period:</strong> {correlationData.startDate} to {correlationData.endDate}</span>
                <span><strong>Observations:</strong> {correlationData.observations}</span>
                <span><strong>Mode:</strong> {dataMode === 'total_return' ? 'Adjusted' : 'Raw'}</span>
                <span><strong>Window:</strong> {rollingWindow}D</span>
              </div>
              {correlationData.matrix && (
                <button
                  onClick={exportToCSV}
                  style={{
                    padding: "6px 12px",
                    background: "var(--accent)",
                    color: "#fff",
                    border: "none",
                    borderRadius: 3,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em"
                  }}
                >
                  Export CSV
                </button>
              )}
            </div>

            {/* Market Regime Distribution - PROMINENT */}
            {correlationData.regimeDistribution && (
              <div style={{
                background: "var(--card-bg)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: 24,
                marginBottom: 24
              }}>
                <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Market Regime Distribution
                </h2>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16 }}>
                  {Object.entries(correlationData.regimeDistribution).map(
                    ([regime, pct]) => {
                      const colors: Record<string, string> = {
                        "High Stress": "rgb(239, 68, 68)",
                        "Elevated Risk": "rgb(251, 146, 60)",
                        "Normal": "rgb(59, 130, 246)",
                        "Low Volatility": "rgb(34, 197, 94)",
                      };
                      return (
                        <div key={regime} className="stat-box" style={{ padding: 16, borderRadius: 4, textAlign: "center" }}>
                          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            {regime}
                          </div>
                          <div style={{ fontSize: 24, fontWeight: 700, color: colors[regime] }}>
                            {(pct as number).toFixed(1)}%
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>
              </div>
            )}

            {/* Matrix & Stats Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(500px, 1fr))", gap: 24, marginBottom: 24 }}>

              {/* Correlation Matrix */}
              {correlationData.matrix && (
                <div style={{
                  background: "var(--card-bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  padding: 24
                }}>
                  <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {matrixMode === "correlation" ? "Correlation Matrix" : "Covariance Matrix"}
                  </h2>
                  <CorrelationHeatmap data={correlationData.matrix} />
                </div>
              )}

              {/* Average Correlations */}
              {correlationData.averageCorrelations && (
                <div style={{
                  background: "var(--card-bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  padding: 24
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <h2 style={{ fontSize: 16, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", margin: 0 }}>
                      Average Correlations
                    </h2>
                    <button
                      onClick={() => setShowCorrelationInfo(!showCorrelationInfo)}
                      style={{
                        background: "transparent",
                        border: "1px solid var(--border)",
                        borderRadius: 4,
                        padding: "6px 12px",
                        fontSize: 12,
                        color: "var(--foreground)",
                        cursor: "pointer",
                        fontWeight: 500,
                        transition: "all 0.2s"
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "var(--hover-bg)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                      }}
                    >
                      {showCorrelationInfo ? "Hide" : "Show"} Explanation
                    </button>
                  </div>

                  {showCorrelationInfo && (
                    <div style={{
                      background: "rgba(0,0,0,0.2)",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      padding: 16,
                      marginBottom: 20,
                      fontSize: 13,
                      lineHeight: 1.6
                    }}>
                      <div style={{ fontWeight: 600, marginBottom: 12, color: "var(--foreground)" }}>
                        Understanding Correlations & Statistical Significance
                      </div>

                      <div style={{ marginBottom: 12 }}>
                        <strong style={{ color: "var(--accent)" }}>Correlation:</strong> Measures how two stocks move together.
                        <ul style={{ marginTop: 4, marginBottom: 0, paddingLeft: 20, color: "var(--muted-foreground)" }}>
                          <li>+1.0 = Perfect positive correlation (move together)</li>
                          <li>0.0 = No correlation (move independently)</li>
                          <li>-1.0 = Perfect negative correlation (move opposite)</li>
                          <li>&gt;0.7 = Strong • 0.4-0.7 = Moderate • &lt;0.4 = Weak</li>
                        </ul>
                      </div>

                      <div style={{ marginBottom: 12 }}>
                        <strong style={{ color: "var(--accent)" }}>Beta (β):</strong> Measures sensitivity to market (OBX) movements.
                        <ul style={{ marginTop: 4, marginBottom: 0, paddingLeft: 20, color: "var(--muted-foreground)" }}>
                          <li>β = 1.0 → Stock moves 1% for every 1% OBX move</li>
                          <li>β &gt; 1.0 → More volatile than market (amplified moves)</li>
                          <li>β &lt; 1.0 → Less volatile than market (dampened moves)</li>
                          <li>β &lt; 0 → Moves opposite to market (rare)</li>
                        </ul>
                      </div>

                      <div>
                        <strong style={{ color: "var(--accent)" }}>Confidence Intervals (CI):</strong> Statistical reliability of estimates.
                        <ul style={{ marginTop: 4, marginBottom: 0, paddingLeft: 20, color: "var(--muted-foreground)" }}>
                          <li>95% CI: We're 95% confident true value is in this range</li>
                          <li>Narrow CI = More precise estimate (more data)</li>
                          <li>Wide CI = Less precise estimate (less data/more volatility)</li>
                          <li>p-value &lt; 0.05 = Statistically significant (*)</li>
                          <li>Significance: *** (p&lt;0.001), ** (p&lt;0.01), * (p&lt;0.05)</li>
                        </ul>
                      </div>
                    </div>
                  )}

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
                    {correlationData.averageCorrelations.map(
                      (item: { ticker: string; avgCorrelation: number }) => (
                        <div
                          key={item.ticker}
                          className="stat-box"
                          style={{
                            padding: 16,
                            borderRadius: 4,
                            textAlign: "center",
                          }}
                        >
                          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: "var(--muted-foreground)" }}>
                            {item.ticker}
                          </div>
                          <div style={{
                            fontSize: 20,
                            fontWeight: 700,
                            color: item.avgCorrelation > 0.7 ? "var(--accent)" :
                                   item.avgCorrelation < 0.3 ? "var(--muted)" : "var(--foreground)"
                          }}>
                            {item.avgCorrelation.toFixed(2)}
                            <span style={{ fontSize: 14, color: "#f59e0b", marginLeft: 4 }}>
                              {getSignificanceStars(item.avgCorrelation)}
                            </span>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Rolling Correlation Chart */}
            {correlationData.rollingCorrelations && correlationData.rollingCorrelations.length > 0 && (
              <div style={{
                background: "var(--card-bg)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: 24,
                marginBottom: 24
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <h2 style={{ fontSize: 16, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Rolling Correlation Time Series
                  </h2>
                  <span style={{ fontSize: 13, padding: "4px 8px", background: "var(--hover-bg)", borderRadius: 3, fontWeight: 600 }}>
                    {selectedTickers[0]} vs {selectedTickers[1]}
                  </span>
                </div>
                <div style={{ height: 400 }}>
                  <RollingCorrelationChart data={correlationData.rollingCorrelations} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
