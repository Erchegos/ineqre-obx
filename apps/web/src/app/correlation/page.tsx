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
  const [showRollingInfo, setShowRollingInfo] = useState(false);
  const [rollingPairIndices, setRollingPairIndices] = useState<[number, number]>([0, 1]);
  const [rollingChartData, setRollingChartData] = useState<any>(null);
  const [rollingLoading, setRollingLoading] = useState(false);

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
        // Initialize rolling chart with first two tickers
        if (data.rollingCorrelations && data.rollingCorrelations.length > 0) {
          setRollingChartData(data.rollingCorrelations);
        }
      }
    } catch (e: any) {
      setError(e.message);
      setCorrelationData(null);
    } finally {
      setLoading(false);
    }
  }

  async function fetchRollingCorrelationForPair(idx1: number, idx2: number) {
    if (selectedTickers.length < 2 || idx1 === idx2) return;

    setRollingLoading(true);

    try {
      const ticker1 = selectedTickers[idx1];
      const ticker2 = selectedTickers[idx2];

      const params = new URLSearchParams({
        tickers: `${ticker1},${ticker2}`,
        limit: timeframe.toString(),
        window: rollingWindow.toString(),
        mode: dataMode,
      });

      const res = await fetch(`/api/correlation?${params}`);
      const data = await res.json();

      if (res.ok && data.rollingCorrelations) {
        setRollingChartData(data.rollingCorrelations);
      }
    } catch (e: any) {
      console.error("Failed to fetch rolling correlation:", e);
    } finally {
      setRollingLoading(false);
    }
  }

  // Fetch rolling correlation when ticker pair selection changes
  useEffect(() => {
    if (selectedTickers.length >= 2 && rollingPairIndices[0] !== rollingPairIndices[1]) {
      fetchRollingCorrelationForPair(rollingPairIndices[0], rollingPairIndices[1]);
    }
  }, [rollingPairIndices, timeframe, rollingWindow, dataMode]);

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
      background: "#0a0a0a",
      color: "#fff",
      fontFamily: "monospace",
      padding: "20px 16px"
    }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .search-input {
          width: 100%;
          padding: 8px 10px;
          font-size: 12px;
          font-family: monospace;
          border: 1px solid #30363d;
          border-radius: 5px;
          background: #0d1117;
          color: #fff;
          outline: none;
          transition: border-color 0.2s;
        }
        .search-input:focus {
          border-color: #3b82f6;
        }
        .search-input::placeholder {
          color: rgba(255,255,255,0.4);
        }
        .stat-box {
          background: #0d1117;
          border: 1px solid #21262d;
          transition: all 0.15s;
        }
        .stat-box:hover {
          border-color: #3b82f6;
        }
      `}} />

      <div style={{ maxWidth: 1400, margin: "0 auto" }}>

        {/* Header */}
        <Link href="/" style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textDecoration: "none", fontFamily: "monospace" }}>
          ← HOME
        </Link>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 12, marginTop: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, fontFamily: "monospace", letterSpacing: "-0.02em" }}>
              Correlation Matrix
            </h1>
            <Link
              href="/stocks"
              style={{
                display: "inline-block",
                color: "rgba(255,255,255,0.5)",
                textDecoration: "none",
                fontSize: 11,
                fontWeight: 600,
                padding: "5px 12px",
                border: "1px solid #30363d",
                borderRadius: 8,
                background: "#161b22",
                fontFamily: "monospace",
                letterSpacing: "0.05em",
                transition: "all 0.15s ease"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "#3b82f6";
                e.currentTarget.style.color = "#3b82f6";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "#30363d";
                e.currentTarget.style.color = "rgba(255,255,255,0.5)";
              }}
            >
              ASSETS
            </Link>
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>
            {currentDate}
          </div>
        </div>
        <p style={{ color: "rgba(255,255,255,0.4)", marginBottom: 20, fontSize: 11, fontFamily: "monospace" }}>
          Quantitative correlation and regime analysis
        </p>

        {/* Quick Presets - Prominent */}
        <div style={{
          background: "#161b22",
          border: "1px solid #30363d",
          borderRadius: 8,
          padding: 16,
          marginBottom: 12
        }}>
          <h3 style={{ fontSize: 11, fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.6)", fontFamily: "monospace" }}>
            Quick Presets
          </h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {Object.keys(PRESET_GROUPS).map((group) => (
              <button
                key={group}
                onClick={() => handlePresetGroup(group as keyof typeof PRESET_GROUPS)}
                style={{
                  padding: "6px 12px",
                  background: "#21262d",
                  color: "rgba(255,255,255,0.8)",
                  border: "1px solid #30363d",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: "monospace",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "#3b82f6";
                  e.currentTarget.style.color = "#3b82f6";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "#30363d";
                  e.currentTarget.style.color = "rgba(255,255,255,0.8)";
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
          gap: 12,
          marginBottom: 12
        }}>
          {/* Lookback Period */}
          <div style={{
            background: "#161b22",
            border: "1px solid #30363d",
            borderRadius: 8,
            padding: 16
          }}>
            <label style={{ display: "block", fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.5)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "monospace" }}>
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
                      padding: "6px 4px",
                      fontSize: 11,
                      fontWeight: 600,
                      fontFamily: "monospace",
                      border: isSelected ? "1px solid #3b82f6" : "1px solid #30363d",
                      borderRadius: 3,
                      background: isSelected ? "#3b82f6" : "#0d1117",
                      color: isSelected ? "#fff" : "rgba(255,255,255,0.6)",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                      transform: "scale(1)",
                      boxShadow: isSelected ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
                    }}
                    onMouseEnter={(e) => {
                      if (isSelected) {
                        e.currentTarget.style.filter = "brightness(0.9)";
                      } else {
                        e.currentTarget.style.background = "#0d1117";
                        e.currentTarget.style.borderColor = "#3b82f6";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (isSelected) {
                        e.currentTarget.style.filter = "brightness(1)";
                      } else {
                        e.currentTarget.style.background = "#0d1117";
                        e.currentTarget.style.borderColor = "#30363d";
                      }
                    }}
                    onMouseDown={(e) => {
                      e.currentTarget.style.transform = "scale(0.95)";
                    }}
                    onMouseUp={(e) => {
                      e.currentTarget.style.transform = "scale(1)";
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
            background: "#161b22",
            border: "1px solid #30363d",
            borderRadius: 8,
            padding: 16
          }}>
            <label style={{ display: "block", fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.5)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "monospace" }}>
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
                      padding: "6px 4px",
                      fontSize: 11,
                      fontWeight: 600,
                      fontFamily: "monospace",
                      border: isSelected ? "1px solid #3b82f6" : "1px solid #30363d",
                      borderRadius: 3,
                      background: isSelected ? "#3b82f6" : "#0d1117",
                      color: isSelected ? "#fff" : "rgba(255,255,255,0.6)",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                      transform: "scale(1)",
                      boxShadow: isSelected ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
                    }}
                    onMouseEnter={(e) => {
                      if (isSelected) {
                        e.currentTarget.style.filter = "brightness(0.9)";
                      } else {
                        e.currentTarget.style.background = "#0d1117";
                        e.currentTarget.style.borderColor = "#3b82f6";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (isSelected) {
                        e.currentTarget.style.filter = "brightness(1)";
                      } else {
                        e.currentTarget.style.background = "#0d1117";
                        e.currentTarget.style.borderColor = "#30363d";
                      }
                    }}
                    onMouseDown={(e) => {
                      e.currentTarget.style.transform = "scale(0.95)";
                    }}
                    onMouseUp={(e) => {
                      e.currentTarget.style.transform = "scale(1)";
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
            background: "#161b22",
            border: "1px solid #30363d",
            borderRadius: 8,
            padding: 16
          }}>
            <label style={{ display: "block", fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.5)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "monospace" }}>
              Data Mode
            </label>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                onClick={() => setDataMode("price")}
                style={{
                  flex: 1,
                  padding: "6px 4px",
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: "monospace",
                  border: dataMode === "price" ? "1px solid #3b82f6" : "1px solid #30363d",
                  borderRadius: 3,
                  background: dataMode === "price" ? "#3b82f6" : "#0d1117",
                  color: dataMode === "price" ? "#fff" : "rgba(255,255,255,0.6)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  transform: "scale(1)",
                  boxShadow: dataMode === "price" ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
                }}
                onMouseEnter={(e) => {
                  if (dataMode === "price") {
                    e.currentTarget.style.filter = "brightness(0.9)";
                  } else {
                    e.currentTarget.style.background = "#0d1117";
                    e.currentTarget.style.borderColor = "#3b82f6";
                  }
                }}
                onMouseLeave={(e) => {
                  if (dataMode === "price") {
                    e.currentTarget.style.filter = "brightness(1)";
                  } else {
                    e.currentTarget.style.background = "#0d1117";
                    e.currentTarget.style.borderColor = "#30363d";
                  }
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = "scale(0.95)";
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = "scale(1)";
                }}
              >
                Price
              </button>
              <button
                onClick={() => setDataMode("total_return")}
                style={{
                  flex: 1,
                  padding: "6px 4px",
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: "monospace",
                  border: dataMode === "total_return" ? "1px solid #3b82f6" : "1px solid #30363d",
                  borderRadius: 3,
                  background: dataMode === "total_return" ? "#3b82f6" : "#0d1117",
                  color: dataMode === "total_return" ? "#fff" : "rgba(255,255,255,0.6)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  transform: "scale(1)",
                  boxShadow: dataMode === "total_return" ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
                }}
                onMouseEnter={(e) => {
                  if (dataMode === "total_return") {
                    e.currentTarget.style.filter = "brightness(0.9)";
                  } else {
                    e.currentTarget.style.background = "#0d1117";
                    e.currentTarget.style.borderColor = "#3b82f6";
                  }
                }}
                onMouseLeave={(e) => {
                  if (dataMode === "total_return") {
                    e.currentTarget.style.filter = "brightness(1)";
                  } else {
                    e.currentTarget.style.background = "#0d1117";
                    e.currentTarget.style.borderColor = "#30363d";
                  }
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = "scale(0.95)";
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = "scale(1)";
                }}
              >
                Total Return
              </button>
            </div>
          </div>

          {/* Matrix Type */}
          <div style={{
            background: "#161b22",
            border: "1px solid #30363d",
            borderRadius: 8,
            padding: 16
          }}>
            <label style={{ display: "block", fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.5)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "monospace" }}>
              Matrix Type
            </label>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                onClick={() => setMatrixMode("correlation")}
                style={{
                  flex: 1,
                  padding: "6px 4px",
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: "monospace",
                  border: matrixMode === "correlation" ? "1px solid #3b82f6" : "1px solid #30363d",
                  borderRadius: 3,
                  background: matrixMode === "correlation" ? "#3b82f6" : "#0d1117",
                  color: matrixMode === "correlation" ? "#fff" : "rgba(255,255,255,0.6)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  transform: "scale(1)",
                  boxShadow: matrixMode === "correlation" ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
                }}
                onMouseEnter={(e) => {
                  if (matrixMode === "correlation") {
                    e.currentTarget.style.filter = "brightness(0.9)";
                  } else {
                    e.currentTarget.style.background = "#0d1117";
                    e.currentTarget.style.borderColor = "#3b82f6";
                  }
                }}
                onMouseLeave={(e) => {
                  if (matrixMode === "correlation") {
                    e.currentTarget.style.filter = "brightness(1)";
                  } else {
                    e.currentTarget.style.background = "#0d1117";
                    e.currentTarget.style.borderColor = "#30363d";
                  }
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = "scale(0.95)";
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = "scale(1)";
                }}
              >
                Corr
              </button>
              <button
                onClick={() => setMatrixMode("covariance")}
                style={{
                  flex: 1,
                  padding: "6px 4px",
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: "monospace",
                  border: matrixMode === "covariance" ? "1px solid #3b82f6" : "1px solid #30363d",
                  borderRadius: 3,
                  background: matrixMode === "covariance" ? "#3b82f6" : "#0d1117",
                  color: matrixMode === "covariance" ? "#fff" : "rgba(255,255,255,0.6)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  transform: "scale(1)",
                  boxShadow: matrixMode === "covariance" ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
                }}
                onMouseEnter={(e) => {
                  if (matrixMode === "covariance") {
                    e.currentTarget.style.filter = "brightness(0.9)";
                  } else {
                    e.currentTarget.style.background = "#0d1117";
                    e.currentTarget.style.borderColor = "#3b82f6";
                  }
                }}
                onMouseLeave={(e) => {
                  if (matrixMode === "covariance") {
                    e.currentTarget.style.filter = "brightness(1)";
                  } else {
                    e.currentTarget.style.background = "#0d1117";
                    e.currentTarget.style.borderColor = "#30363d";
                  }
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = "scale(0.95)";
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = "scale(1)";
                }}
              >
                Cov
              </button>
            </div>
          </div>
        </div>

        {/* Ticker Selection */}
        <div style={{
          background: "#161b22",
          border: "1px solid #30363d",
          borderRadius: 8,
          padding: 16,
          marginBottom: 12
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.6)", margin: 0, fontFamily: "monospace" }}>
              Selection ({selectedTickers.length})
            </h3>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setShowTickerPanel(!showTickerPanel)}
                style={{
                  background: "none",
                  border: "1px solid #30363d",
                  fontSize: 10,
                  color: "#3b82f6",
                  cursor: "pointer",
                  padding: "4px 8px",
                  borderRadius: 3,
                  fontWeight: 600,
                  fontFamily: "monospace",
                  letterSpacing: "0.05em",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#0d1117";
                  e.currentTarget.style.borderColor = "#3b82f6";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "none";
                  e.currentTarget.style.borderColor = "#30363d";
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = "scale(0.95)";
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = "scale(1)";
                }}
              >
                {showTickerPanel ? "Hide" : "Show"} All
              </button>
              {selectedTickers.length > 0 && (
                <button
                  onClick={() => setSelectedTickers([])}
                  style={{ background: "none", border: "none", fontSize: 10, color: "#ef4444", cursor: "pointer", padding: 0, fontFamily: "monospace", fontWeight: 600 }}
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
                background: "#161b22",
                border: "1px solid #30363d",
                borderRadius: 6,
                maxHeight: 240,
                overflowY: "auto",
                zIndex: 20,
                boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.3)",
              }}>
                {filteredTickers.slice(0, 50).map((ticker) => (
                  <div
                    key={ticker}
                    onClick={() => addTicker(ticker)}
                    style={{
                      padding: "8px 10px",
                      cursor: "pointer",
                      fontSize: 11,
                      fontFamily: "monospace",
                      borderBottom: "1px solid #30363d",
                      transition: "background 0.1s"
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "rgba(59,130,246,0.08)"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  >
                    {ticker}
                  </div>
                ))}
              </div>
            )}
          </div>

          {selectedTickers.length === 0 ? (
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>
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
                    gap: 6,
                    padding: "4px 10px",
                    background: "rgba(59,130,246,0.1)",
                    color: "#3b82f6",
                    border: "1px solid rgba(59,130,246,0.25)",
                    borderRadius: 3,
                    fontSize: 11,
                    fontWeight: 600,
                    fontFamily: "monospace",
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
            background: "#161b22",
            border: "1px solid #30363d",
            borderRadius: 8,
            padding: 16,
            marginBottom: 12,
            maxHeight: 400,
            overflowY: "auto"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ fontSize: 11, fontWeight: 700, margin: 0, fontFamily: "monospace", color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                All Tickers ({availableTickers.length})
              </h3>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as "alpha" | "selected")}
                style={{
                  padding: "4px 8px",
                  background: "#0d1117",
                  color: "rgba(255,255,255,0.6)",
                  border: "1px solid #30363d",
                  borderRadius: 4,
                  fontSize: 10,
                  fontFamily: "monospace",
                }}
              >
                <option value="alpha">Alphabetical</option>
                <option value="selected">Selected First</option>
              </select>
            </div>

            {availableSectors.length > 0 && (
              <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid #30363d" }}>
                <div style={{ fontSize: 9, fontWeight: 700, marginBottom: 10, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "monospace" }}>
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
                          padding: "3px 8px",
                          fontSize: 10,
                          fontWeight: 600,
                          fontFamily: "monospace",
                          border: isSelected ? "1px solid #3b82f6" : "1px solid #30363d",
                          borderRadius: 3,
                          background: isSelected ? "#3b82f6" : "transparent",
                          color: isSelected ? "#fff" : "rgba(255,255,255,0.6)",
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
                        padding: "3px 8px",
                        fontSize: 10,
                        fontWeight: 600,
                        fontFamily: "monospace",
                        border: "1px solid #ef4444",
                        borderRadius: 3,
                        background: "transparent",
                        color: "#ef4444",
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
                      gap: 6,
                      padding: "6px 8px",
                      background: isSelected ? "rgba(59,130,246,0.08)" : "#0d1117",
                      border: `1px solid ${isSelected ? "#3b82f6" : "#30363d"}`,
                      borderRadius: 3,
                      cursor: "pointer",
                      fontSize: 11,
                      fontFamily: "monospace",
                      fontWeight: isSelected ? 600 : 400,
                      color: isSelected ? "#3b82f6" : "rgba(255,255,255,0.6)",
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
                        accentColor: "#3b82f6"
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
            padding: "10px 20px",
            background: loading || selectedTickers.length < 2 ? "#30363d" : "linear-gradient(135deg, #3b82f6, #2563eb)",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 700,
            fontFamily: "monospace",
            letterSpacing: "0.05em",
            cursor: loading || selectedTickers.length < 2 ? "not-allowed" : "pointer",
            marginBottom: 20,
            transition: "all 0.2s",
            opacity: loading || selectedTickers.length < 2 ? 0.5 : 1
          }}
        >
          {loading ? "Computing..." : `Compute Correlations (${selectedTickers.length} assets)`}
        </button>

        {/* Error */}
        {error && (
          <div style={{
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.3)",
            color: "#ef4444",
            padding: 12,
            borderRadius: 6,
            marginBottom: 20,
            fontSize: 11,
            fontFamily: "monospace",
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
              marginBottom: 20,
              padding: 12,
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: 8,
              fontSize: 10,
              fontFamily: "monospace",
              color: "rgba(255,255,255,0.5)"
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
                    padding: "5px 12px",
                    background: "linear-gradient(135deg, #3b82f6, #2563eb)",
                    color: "#fff",
                    border: "none",
                    borderRadius: 4,
                    fontSize: 9,
                    fontWeight: 700,
                    fontFamily: "monospace",
                    cursor: "pointer",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em"
                  }}
                >
                  Export CSV
                </button>
              )}
            </div>

            {/* Market Regime Distribution - PROMINENT */}
            {correlationData.regimeDistribution && (
              <div style={{
                background: "#161b22",
                border: "1px solid #30363d",
                borderRadius: 8,
                padding: 16,
                marginBottom: 20
              }}>
                <h2 style={{ fontSize: 11, fontWeight: 700, marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.6)", fontFamily: "monospace" }}>
                  Market Regime Distribution
                </h2>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
                  {Object.entries(correlationData.regimeDistribution).map(
                    ([regime, pct]) => {
                      const colors: Record<string, string> = {
                        "High Stress": "rgb(239, 68, 68)",
                        "Elevated Risk": "rgb(251, 146, 60)",
                        "Normal": "rgb(59, 130, 246)",
                        "Low Volatility": "rgb(34, 197, 94)",
                      };
                      return (
                        <div key={regime} className="stat-box" style={{ padding: 12, borderRadius: 6, textAlign: "center" }}>
                          <div style={{ fontSize: 9, fontWeight: 700, marginBottom: 6, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "monospace" }}>
                            {regime}
                          </div>
                          <div style={{ fontSize: 18, fontWeight: 800, color: colors[regime], fontFamily: "monospace" }}>
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 20 }}>

              {/* Correlation Matrix */}
              {correlationData.matrix && (
                <div style={{
                  background: "#161b22",
                  border: "1px solid #30363d",
                  borderRadius: 8,
                  padding: 16
                }}>
                  <h2 style={{ fontSize: 11, fontWeight: 700, marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.6)", fontFamily: "monospace" }}>
                    {matrixMode === "correlation" ? "Correlation Matrix" : "Covariance Matrix"}
                  </h2>
                  <CorrelationHeatmap data={correlationData.matrix} />
                </div>
              )}

              {/* Average Correlations */}
              {correlationData.averageCorrelations && (
                <div style={{
                  background: "#161b22",
                  border: "1px solid #30363d",
                  borderRadius: 8,
                  padding: 16
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <h2 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", margin: 0, color: "rgba(255,255,255,0.6)", fontFamily: "monospace" }}>
                      Average Correlations
                    </h2>
                    <button
                      onClick={() => setShowCorrelationInfo(!showCorrelationInfo)}
                      style={{
                        background: "transparent",
                        border: "1px solid #30363d",
                        borderRadius: 4,
                        padding: "4px 10px",
                        fontSize: 9,
                        color: "rgba(255,255,255,0.5)",
                        cursor: "pointer",
                        fontWeight: 600,
                        fontFamily: "monospace",
                        letterSpacing: "0.05em",
                        transition: "all 0.2s"
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "#0d1117";
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
                      background: "#0d1117",
                      border: "1px solid #21262d",
                      borderRadius: 6,
                      padding: 14,
                      marginBottom: 16,
                      fontSize: 11,
                      fontFamily: "monospace",
                      lineHeight: 1.7,
                      color: "rgba(255,255,255,0.6)"
                    }}>
                      <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 11, color: "rgba(255,255,255,0.8)", letterSpacing: "0.05em" }}>
                        Understanding Correlation Metrics
                      </div>

                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontWeight: 600, marginBottom: 4, color: "rgba(255,255,255,0.8)" }}>Correlation Coefficient</div>
                        <div style={{ marginBottom: 6, color: "rgba(255,255,255,0.6)" }}>
                          Measures linear relationship strength between two assets. Range: -1.0 to +1.0
                        </div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", paddingLeft: 10 }}>
                          <div>+1.0: Perfect positive (move in lockstep)</div>
                          <div>0.0: No linear relationship (independent)</div>
                          <div>-1.0: Perfect negative (mirror opposite)</div>
                          <div style={{ marginTop: 4 }}>Interpretation: Strong (&gt;0.7), Moderate (0.4-0.7), Weak (&lt;0.4)</div>
                        </div>
                      </div>

                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontWeight: 600, marginBottom: 4, color: "rgba(255,255,255,0.8)" }}>Beta (Market Sensitivity)</div>
                        <div style={{ marginBottom: 6, color: "rgba(255,255,255,0.6)" }}>
                          Measures systematic risk relative to market (OBX) movements
                        </div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", paddingLeft: 10 }}>
                          <div>b = 1.0: Moves in line with market</div>
                          <div>b &gt; 1.0: Amplifies market moves (higher volatility)</div>
                          <div>b &lt; 1.0: Dampens market moves (defensive)</div>
                          <div>b &lt; 0: Inverse market relationship</div>
                        </div>
                      </div>

                      <div>
                        <div style={{ fontWeight: 600, marginBottom: 4, color: "rgba(255,255,255,0.8)" }}>Statistical Significance</div>
                        <div style={{ marginBottom: 6, color: "rgba(255,255,255,0.6)" }}>
                          Stars (***) indicate reliability - not strength - of the correlation estimate
                        </div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", paddingLeft: 10 }}>
                          <div>*** p&lt;0.001: Highly significant (very low chance of randomness)</div>
                          <div>** p&lt;0.01: Significant</div>
                          <div>* p&lt;0.05: Marginally significant</div>
                          <div>No stars: Could be random noise</div>
                          <div style={{ marginTop: 4, fontStyle: "italic" }}>Note: High significance does not equal strong correlation. A 0.2 correlation can be highly significant with enough data.</div>
                        </div>
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
                            borderRadius: 8,
                            textAlign: "center",
                          }}
                        >
                          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: "rgba(255,255,255,0.5)" }}>
                            {item.ticker}
                          </div>
                          <div style={{
                            fontSize: 20,
                            fontWeight: 700,
                            color: item.avgCorrelation > 0.7 ? "#3b82f6" :
                                   item.avgCorrelation < 0.3 ? "rgba(255,255,255,0.5)" : "#fff"
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
            {correlationData.rollingCorrelations && correlationData.rollingCorrelations.length > 0 && selectedTickers.length >= 2 && (
              <div style={{
                background: "#161b22",
                border: "1px solid #30363d",
                borderRadius: 8,
                padding: 24,
                marginBottom: 24
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <h2 style={{ fontSize: 16, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Rolling Correlation Time Series
                  </h2>
                  <button
                    onClick={() => setShowRollingInfo(!showRollingInfo)}
                    style={{
                      background: "#0d1117",
                      border: "1px solid #30363d",
                      fontSize: 11,
                      color: "#3b82f6",
                      cursor: "pointer",
                      padding: "6px 12px",
                      borderRadius: 3,
                      fontWeight: 500
                    }}
                  >
                    {showRollingInfo ? "Hide" : "Show"} Explanation
                  </button>
                </div>

                {showRollingInfo && (
                  <div style={{
                    background: "#0d1117",
                    border: "1px solid #30363d",
                    borderRadius: 8,
                    padding: 16,
                    marginBottom: 20,
                    fontSize: 13,
                    lineHeight: 1.6
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: 8, color: "#fff" }}>
                      What is Rolling Correlation?
                    </div>
                    <p style={{ margin: "0 0 12px 0", color: "rgba(255,255,255,0.5)" }}>
                      Rolling correlation measures how the relationship between two assets changes over time.
                      Instead of calculating a single correlation for the entire period, it uses a moving window
                      (e.g., 60 days) to compute correlation at each point in time.
                    </p>
                    <div style={{ fontWeight: 600, marginBottom: 8, color: "#fff" }}>
                      Why it Matters
                    </div>
                    <p style={{ margin: "0 0 12px 0", color: "rgba(255,255,255,0.5)" }}>
                      • <strong>Dynamic Relationships:</strong> Correlations are not constant - they vary with market regimes,
                      economic cycles, and company-specific events<br/>
                      • <strong>Risk Management:</strong> Portfolio diversification depends on low correlations.
                      If correlations spike during crises, your "diversified" portfolio may not protect you<br/>
                      • <strong>Volatility Context:</strong> The background shading shows market volatility.
                      High volatility periods often coincide with correlation changes
                    </p>
                    <div style={{ fontWeight: 600, marginBottom: 8, color: "#fff" }}>
                      Interpretation
                    </div>
                    <p style={{ margin: 0, color: "rgba(255,255,255,0.5)" }}>
                      • <strong>+1.0:</strong> Perfect positive correlation (assets move together)<br/>
                      • <strong>0.0:</strong> No correlation (assets move independently)<br/>
                      • <strong>-1.0:</strong> Perfect negative correlation (assets move in opposite directions)<br/>
                      • <strong>Volatility spikes</strong> (purple shading) often trigger correlation regime changes
                    </p>
                  </div>
                )}

                {/* Ticker Pair Selector */}
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 16,
                  padding: "12px 16px",
                  background: "#0d1117",
                  borderRadius: 8,
                  border: "1px solid #30363d"
                }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>
                    Compare:
                  </span>
                  <select
                    value={rollingPairIndices[0]}
                    onChange={(e) => {
                      const newIdx = parseInt(e.target.value);
                      if (newIdx !== rollingPairIndices[1]) {
                        setRollingPairIndices([newIdx, rollingPairIndices[1]]);
                      }
                    }}
                    style={{
                      padding: "6px 10px",
                      fontSize: 13,
                      fontWeight: 500,
                      background: "#161b22",
                      color: "#fff",
                      border: "1px solid #30363d",
                      borderRadius: 3,
                      cursor: "pointer"
                    }}
                  >
                    {selectedTickers.map((ticker, idx) => (
                      <option key={ticker} value={idx}>
                        {ticker}
                      </option>
                    ))}
                  </select>
                  <span style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>vs</span>
                  <select
                    value={rollingPairIndices[1]}
                    onChange={(e) => {
                      const newIdx = parseInt(e.target.value);
                      if (newIdx !== rollingPairIndices[0]) {
                        setRollingPairIndices([rollingPairIndices[0], newIdx]);
                      }
                    }}
                    style={{
                      padding: "6px 10px",
                      fontSize: 13,
                      fontWeight: 500,
                      background: "#161b22",
                      color: "#fff",
                      border: "1px solid #30363d",
                      borderRadius: 3,
                      cursor: "pointer"
                    }}
                  >
                    {selectedTickers.map((ticker, idx) => (
                      <option key={ticker} value={idx}>
                        {ticker}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ height: 400, position: "relative" }}>
                  {rollingLoading && (
                    <div style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "rgba(0,0,0,0.5)",
                      zIndex: 10,
                      borderRadius: 4
                    }}>
                      <div style={{ color: "#fff", fontSize: 14 }}>Loading correlation data...</div>
                    </div>
                  )}
                  <RollingCorrelationChart data={rollingChartData || correlationData.rollingCorrelations} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
