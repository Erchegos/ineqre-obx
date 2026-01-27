"use client";

import { useState, useEffect, useMemo } from "react";
import CandlestickChart from "@/components/CandlestickChart";
import TickerSelector from "@/components/TickerSelector";

type StdChannelData = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  midLine: number | null;
  upperBand1: number | null;
  lowerBand1: number | null;
  upperBand2: number | null;
  lowerBand2: number | null;
};

type StdChannelResponse = {
  ticker: string;
  count: number;
  metadata: {
    windowSize: number;
    k1: number;
    k2: number;
    slope: number;
    intercept: number;
    sigma: number;
    r: number;
    r2: number;
    score: number;
  };
  data: StdChannelData[];
};

export default function TestStdChannelPage() {
  const [ticker, setTicker] = useState<string>("AKER");
  const [limit, setLimit] = useState<number>(1600);
  const [k1, setK1] = useState<number>(1.0);
  const [k2, setK2] = useState<number>(2.0);
  const [showChannel, setShowChannel] = useState<boolean>(true);
  const [showDev1, setShowDev1] = useState<boolean>(true);
  const [showDev2, setShowDev2] = useState<boolean>(true);
  const [minWindow, setMinWindow] = useState<number>(255);
  const [maxWindow, setMaxWindow] = useState<number>(1530);
  const [step, setStep] = useState<number>(20);
  const [fixedWindow, setFixedWindow] = useState<number | null>(null);
  const [zoomStart, setZoomStart] = useState<number>(0); // 0 = show all
  const [zoomEnd, setZoomEnd] = useState<number>(0); // 0 = show all

  const [stdData, setStdData] = useState<StdChannelResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Manual fetch function triggered by Generate button
  const fetchData = async () => {
    if (!ticker) return;

    setLoading(true);
    setError(null);

    try {
      let url = `/api/std-channel/${encodeURIComponent(ticker)}?k1=${k1}&k2=${k2}&limit=${limit}`;

      if (fixedWindow) {
        // Use fixed window size (skip optimization)
        url += `&windowSize=${fixedWindow}`;
      } else {
        // Use optimization with min/max/step
        url += `&minWindow=${minWindow}&maxWindow=${maxWindow}&step=${step}`;
      }

      const stdRes = await fetch(url);
      if (!stdRes.ok) {
        throw new Error(`STD Channel API failed: ${stdRes.status} ${stdRes.statusText}`);
      }
      const stdJson: StdChannelResponse = await stdRes.json();

      setStdData(stdJson);
      setLoading(false);
    } catch (e: any) {
      setError(e?.message || String(e));
      setLoading(false);
    }
  };

  // Auto-generate chart on initial page load
  useEffect(() => {
    fetchData();
  }, []); // Empty dependency array = run once on mount

  // Chart data from STD channel API (includes filtered OHLC)
  const chartData = useMemo(() => {
    if (!stdData) return [];

    const data = stdData.data.map(d => ({
      date: d.date,
      open: d.open ?? d.close,
      high: d.high ?? d.close,
      low: d.low ?? d.close,
      close: d.close!,
      midLine: d.midLine,
      upperBand1: d.upperBand1,
      lowerBand1: d.lowerBand1,
      upperBand2: d.upperBand2,
      lowerBand2: d.lowerBand2,
    }));

    // Apply zoom if set
    let zoomedData = data;
    if (zoomStart > 0 || zoomEnd > 0) {
      const start = zoomStart > 0 ? Math.max(0, data.length - zoomStart) : 0;
      const end = zoomEnd > 0 ? Math.max(0, data.length - zoomEnd) : data.length;
      zoomedData = data.slice(start, end);
    }

    // REQUIREMENT: Verify channels will render
    const channelPoints = zoomedData.filter(d => d.midLine != null).length;
    console.log('[Test Page] STD Channel data:', {
      totalPoints: data.length,
      zoomedPoints: zoomedData.length,
      channelPoints,
      windowSize: stdData.metadata.windowSize,
      r2: stdData.metadata.r2,
    });

    return zoomedData;
  }, [stdData, zoomStart, zoomEnd]);

  // Mean reversal analysis
  const meanReversalInfo = useMemo(() => {
    if (!stdData || chartData.length === 0) return null;

    const lastBar = chartData[chartData.length - 1];
    if (!lastBar.midLine || !lastBar.upperBand2 || !lastBar.lowerBand2) return null;

    const sigma = stdData.metadata.sigma;
    const distanceFromMid = lastBar.close - lastBar.midLine;
    const sigmaUnits = distanceFromMid / sigma;

    // Determine position
    let position: 'extreme_high' | 'high' | 'neutral' | 'low' | 'extreme_low';
    if (sigmaUnits > 1.8) position = 'extreme_high';
    else if (sigmaUnits > 0.8) position = 'high';
    else if (sigmaUnits < -1.8) position = 'extreme_low';
    else if (sigmaUnits < -0.8) position = 'low';
    else position = 'neutral';

    // Calculate distance to bands as percentage
    const distanceToUpper2 = ((lastBar.upperBand2 - lastBar.close) / lastBar.close) * 100;
    const distanceToLower2 = ((lastBar.close - lastBar.lowerBand2) / lastBar.close) * 100;

    return {
      sigmaUnits,
      distanceFromMid,
      distanceToUpper2,
      distanceToLower2,
      position,
      lastClose: lastBar.close,
      midLine: lastBar.midLine,
      upperBand2: lastBar.upperBand2,
      lowerBand2: lastBar.lowerBand2,
    };
  }, [stdData, chartData]);

  // Preset window configurations
  const applyPreset = (preset: 'short' | 'medium' | 'long') => {
    setFixedWindow(null); // Clear fixed window
    if (preset === 'short') {
      setMinWindow(63); // ~3 months
      setMaxWindow(255); // ~1 year
    } else if (preset === 'medium') {
      setMinWindow(255); // ~1 year
      setMaxWindow(765); // ~3 years
    } else {
      setMinWindow(510); // ~2 years
      setMaxWindow(1530); // ~6 years
    }
  };

  return (
    <main style={{ padding: 24, maxWidth: 1800, margin: "0 auto", background: "#131722" }}>
      <h1 style={{ fontSize: 32, fontWeight: 600, marginBottom: 8, color: "#d1d4dc" }}>
        STD Channel Mean Reversion Screener
      </h1>
      <p style={{ fontSize: 14, color: "#787b86", marginBottom: 24 }}>
        Find optimal regression channels and identify mean reversion opportunities
      </p>

      {/* Controls */}
      <div style={{
        padding: 20,
        borderRadius: 6,
        border: "1px solid #2a2e39",
        background: "#1e222d",
        marginBottom: 24,
      }}>
        {/* Ticker and Generate Button */}
        <div style={{
          padding: 16,
          borderRadius: 6,
          background: "#131722",
          border: "1px solid #2a2e39",
          marginBottom: 16,
        }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: "0 1 200px" }}>
              <label style={{ display: "block", fontSize: 12, color: "#787b86", marginBottom: 6, fontWeight: 500 }}>
                Ticker
              </label>
              <TickerSelector
                value={ticker}
                onChange={setTicker}
                placeholder="e.g., AKER"
              />
            </div>

            <div style={{ flex: "0 1 auto" }}>
              <button
                onClick={fetchData}
                disabled={loading || !ticker}
                style={{
                  padding: "10px 24px",
                  borderRadius: 4,
                  border: "none",
                  background: loading ? "#363a45" : "#2962ff",
                  color: loading ? "#787b86" : "#ffffff",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: loading || !ticker ? "not-allowed" : "pointer",
                  whiteSpace: "nowrap",
                  boxShadow: loading ? "none" : "0 2px 8px rgba(41, 98, 255, 0.3)",
                }}
              >
                {loading ? "Loading..." : "Generate Chart"}
              </button>
            </div>
          </div>
        </div>

        {/* Window Optimization Settings */}
        <div style={{
          padding: 16,
          borderRadius: 6,
          background: "#131722",
          border: "1px solid #2a2e39",
          marginBottom: 16,
        }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "#d1d4dc" }}>
            Window Optimization
          </h3>

          {/* Preset Buttons */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 11, color: "#787b86", marginBottom: 8, fontWeight: 500 }}>
              Quick Presets
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => applyPreset('short')}
                style={{
                  padding: "6px 16px",
                  borderRadius: 4,
                  border: "1px solid #2a2e39",
                  background: "#1e222d",
                  color: "#d1d4dc",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Short (3M-1Y)
              </button>
              <button
                onClick={() => applyPreset('medium')}
                style={{
                  padding: "6px 16px",
                  borderRadius: 4,
                  border: "1px solid #2a2e39",
                  background: "#1e222d",
                  color: "#d1d4dc",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Medium (1Y-3Y)
              </button>
              <button
                onClick={() => applyPreset('long')}
                style={{
                  padding: "6px 16px",
                  borderRadius: 4,
                  border: "1px solid #2a2e39",
                  background: "#1e222d",
                  color: "#d1d4dc",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Long (2Y-6Y)
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
            <div style={{ flex: "0 1 120px" }}>
              <label style={{ display: "block", fontSize: 11, color: "#787b86", marginBottom: 6 }}>
                Fixed Window
              </label>
              <input
                type="number"
                value={fixedWindow ?? ""}
                onChange={(e) => {
                  const val = e.target.value;
                  setFixedWindow(val === "" ? null : parseInt(val));
                }}
                placeholder="Auto"
                min="50"
                max="3000"
                style={{
                  width: "100%",
                  padding: "7px 10px",
                  borderRadius: 4,
                  border: "1px solid #2a2e39",
                  background: "#131722",
                  color: "#d1d4dc",
                  fontSize: 13,
                }}
              />
            </div>

            <div style={{ flex: "0 1 120px" }}>
              <label style={{ display: "block", fontSize: 11, color: "#787b86", marginBottom: 6 }}>
                Min Window
              </label>
              <input
                type="number"
                value={minWindow}
                onChange={(e) => {
                  const val = e.target.value;
                  setMinWindow(val === "" ? 255 : parseInt(val));
                }}
                min="50"
                max="2000"
                disabled={fixedWindow !== null}
                style={{
                  width: "100%",
                  padding: "7px 10px",
                  borderRadius: 4,
                  border: "1px solid #2a2e39",
                  background: fixedWindow ? "#1e222d" : "#131722",
                  color: fixedWindow ? "#787b86" : "#d1d4dc",
                  fontSize: 13,
                }}
              />
            </div>

            <div style={{ flex: "0 1 120px" }}>
              <label style={{ display: "block", fontSize: 11, color: "#787b86", marginBottom: 6 }}>
                Max Window
              </label>
              <input
                type="number"
                value={maxWindow}
                onChange={(e) => {
                  const val = e.target.value;
                  setMaxWindow(val === "" ? 1530 : parseInt(val));
                }}
                min="20"
                max="3000"
                disabled={fixedWindow !== null}
                style={{
                  width: "100%",
                  padding: "7px 10px",
                  borderRadius: 4,
                  border: "1px solid #2a2e39",
                  background: fixedWindow ? "#1e222d" : "#131722",
                  color: fixedWindow ? "#787b86" : "#d1d4dc",
                  fontSize: 13,
                }}
              />
            </div>

            <div style={{ flex: "0 1 100px" }}>
              <label style={{ display: "block", fontSize: 11, color: "#787b86", marginBottom: 6 }}>
                Step Size
              </label>
              <input
                type="number"
                value={step}
                onChange={(e) => {
                  const val = e.target.value;
                  setStep(val === "" ? 20 : parseInt(val));
                }}
                min="1"
                max="100"
                disabled={fixedWindow !== null}
                style={{
                  width: "100%",
                  padding: "7px 10px",
                  borderRadius: 4,
                  border: "1px solid #2a2e39",
                  background: fixedWindow ? "#1e222d" : "#131722",
                  color: fixedWindow ? "#787b86" : "#d1d4dc",
                  fontSize: 13,
                }}
              />
            </div>

            <div style={{ flex: "0 1 120px" }}>
              <label style={{ display: "block", fontSize: 11, color: "#787b86", marginBottom: 6 }}>
                Data Limit
              </label>
              <input
                type="number"
                value={limit}
                onChange={(e) => {
                  const val = e.target.value;
                  setLimit(val === "" ? 1600 : parseInt(val));
                }}
                min="100"
                max="5000"
                style={{
                  width: "100%",
                  padding: "7px 10px",
                  borderRadius: 4,
                  border: "1px solid #2a2e39",
                  background: "#131722",
                  color: "#d1d4dc",
                  fontSize: 13,
                }}
              />
            </div>
          </div>
          <p style={{ fontSize: 11, color: "#787b86", marginTop: 8, lineHeight: 1.5 }}>
            {fixedWindow
              ? `Using fixed window of ${fixedWindow} bars. Clear "Fixed Window" to enable optimization.`
              : `Optimizes window size (${minWindow}-${maxWindow} bars, step ${step}) for best R². Higher R² = stronger trend.`
            }
          </p>
        </div>

        {/* Deviation & Display Settings */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
        }}>
          {/* Deviation Settings */}
          <div style={{
            padding: 16,
            borderRadius: 6,
            background: "#131722",
            border: "1px solid #2a2e39",
          }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "#d1d4dc" }}>
              Deviation Bands
            </h3>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 13,
                cursor: "pointer",
                userSelect: "none",
                color: "#d1d4dc",
              }}>
                <input
                  type="checkbox"
                  checked={showDev1}
                  onChange={(e) => setShowDev1(e.target.checked)}
                  style={{ width: 16, height: 16, cursor: "pointer" }}
                />
                <span style={{ flex: 1 }}>±1σ Deviation</span>
                <input
                  type="number"
                  value={k1}
                  onChange={(e) => setK1(parseFloat(e.target.value) || 1.0)}
                  min="0.1"
                  max="5"
                  step="0.1"
                  disabled={!showDev1}
                  style={{
                    width: "60px",
                    padding: "5px 8px",
                    borderRadius: 4,
                    border: "1px solid #2a2e39",
                    background: showDev1 ? "#1e222d" : "#131722",
                    color: showDev1 ? "#d1d4dc" : "#787b86",
                    fontSize: 13,
                  }}
                />
              </label>

              <label style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 13,
                cursor: "pointer",
                userSelect: "none",
                color: "#d1d4dc",
              }}>
                <input
                  type="checkbox"
                  checked={showDev2}
                  onChange={(e) => setShowDev2(e.target.checked)}
                  style={{ width: 16, height: 16, cursor: "pointer" }}
                />
                <span style={{ flex: 1 }}>±2σ Deviation</span>
                <input
                  type="number"
                  value={k2}
                  onChange={(e) => setK2(parseFloat(e.target.value) || 2.0)}
                  min="0.1"
                  max="5"
                  step="0.1"
                  disabled={!showDev2}
                  style={{
                    width: "60px",
                    padding: "5px 8px",
                    borderRadius: 4,
                    border: "1px solid #2a2e39",
                    background: showDev2 ? "#1e222d" : "#131722",
                    color: showDev2 ? "#d1d4dc" : "#787b86",
                    fontSize: 13,
                  }}
                />
              </label>

              <label style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 13,
                cursor: "pointer",
                userSelect: "none",
                color: "#d1d4dc",
              }}>
                <input
                  type="checkbox"
                  checked={showChannel}
                  onChange={(e) => setShowChannel(e.target.checked)}
                  style={{ width: 16, height: 16, cursor: "pointer" }}
                />
                <span>Show STD Channel</span>
              </label>
            </div>
          </div>

          {/* Zoom Controls */}
          <div style={{
            padding: 16,
            borderRadius: 6,
            background: "#131722",
            border: "1px solid #2a2e39",
          }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "#d1d4dc" }}>
              Zoom & Range
            </h3>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, color: "#787b86", marginBottom: 6 }}>
                  Show Last N Bars (0 = all)
                </label>
                <input
                  type="number"
                  value={zoomStart}
                  onChange={(e) => setZoomStart(parseInt(e.target.value) || 0)}
                  min="0"
                  max="3000"
                  placeholder="0 (show all)"
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    borderRadius: 4,
                    border: "1px solid #2a2e39",
                    background: "#1e222d",
                    color: "#d1d4dc",
                    fontSize: 13,
                  }}
                />
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setZoomStart(100)}
                  style={{
                    flex: 1,
                    padding: "6px 12px",
                    borderRadius: 4,
                    border: "1px solid #2a2e39",
                    background: "#1e222d",
                    color: "#d1d4dc",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  Last 100
                </button>
                <button
                  onClick={() => setZoomStart(250)}
                  style={{
                    flex: 1,
                    padding: "6px 12px",
                    borderRadius: 4,
                    border: "1px solid #2a2e39",
                    background: "#1e222d",
                    color: "#d1d4dc",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  Last 250
                </button>
                <button
                  onClick={() => setZoomStart(0)}
                  style={{
                    flex: 1,
                    padding: "6px 12px",
                    borderRadius: 4,
                    border: "1px solid #2a2e39",
                    background: "#1e222d",
                    color: "#d1d4dc",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  Show All
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Status */}
      {loading && (
        <div style={{
          padding: 20,
          borderRadius: 6,
          border: "1px solid #2a2e39",
          background: "#1e222d",
          color: "#787b86",
          marginBottom: 24,
        }}>
          Loading data...
        </div>
      )}

      {error && (
        <div style={{
          padding: 20,
          borderRadius: 6,
          border: "1px solid #ef5350",
          background: "#1e222d",
          marginBottom: 24,
        }}>
          <div style={{ fontWeight: 600, color: "#ef5350", marginBottom: 8 }}>Error</div>
          <div style={{ fontSize: 14, color: "#d1d4dc" }}>{error}</div>
        </div>
      )}

      {/* Metadata */}
      {stdData && (
        <div style={{
          padding: 20,
          borderRadius: 6,
          border: "1px solid #2a2e39",
          background: "#1e222d",
          marginBottom: 24,
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: "#d1d4dc" }}>
            Channel Statistics
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: "#787b86", marginBottom: 6 }}>Data Points</div>
              <div style={{ fontSize: 22, fontWeight: 600, fontFamily: "monospace", color: "#d1d4dc" }}>
                {stdData.count}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#787b86", marginBottom: 6 }}>Window Size</div>
              <div style={{ fontSize: 22, fontWeight: 600, fontFamily: "monospace", color: "#2962ff" }}>
                {stdData.metadata.windowSize}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#787b86", marginBottom: 6 }}>R² (Fit Quality)</div>
              <div style={{
                fontSize: 22,
                fontWeight: 600,
                fontFamily: "monospace",
                color: stdData.metadata.r2 > 0.8 ? "#4caf50"
                  : stdData.metadata.r2 > 0.6 ? "#26a69a"
                  : stdData.metadata.r2 > 0.4 ? "#ff9800"
                  : "#ef5350"
              }}>
                {stdData.metadata.r2.toFixed(4)}
              </div>
              <div style={{ fontSize: 10, color: "#787b86", marginTop: 2 }}>
                {stdData.metadata.r2 > 0.8 ? "Excellent" : stdData.metadata.r2 > 0.6 ? "Good" : stdData.metadata.r2 > 0.4 ? "Moderate" : "Poor"}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#787b86", marginBottom: 6 }}>Sigma (σ)</div>
              <div style={{ fontSize: 22, fontWeight: 600, fontFamily: "monospace", color: "#d1d4dc" }}>
                {stdData.metadata.sigma.toFixed(2)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#787b86", marginBottom: 6 }}>Slope (Trend)</div>
              <div style={{
                fontSize: 22,
                fontWeight: 600,
                fontFamily: "monospace",
                color: stdData.metadata.slope > 0 ? "#26a69a" : "#ef5350"
              }}>
                {stdData.metadata.slope > 0 ? "↑" : "↓"} {Math.abs(stdData.metadata.slope).toFixed(4)}
              </div>
              <div style={{ fontSize: 10, color: "#787b86", marginTop: 2 }}>
                {stdData.metadata.slope > 0 ? "Uptrend" : "Downtrend"}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#787b86", marginBottom: 6 }}>Correlation (R)</div>
              <div style={{ fontSize: 22, fontWeight: 600, fontFamily: "monospace", color: "#d1d4dc" }}>
                {stdData.metadata.r.toFixed(4)}
              </div>
            </div>
          </div>
        </div>
      )}


      {/* Chart */}
      {chartData.length > 0 && (
        <div style={{
          padding: 20,
          borderRadius: 6,
          border: "1px solid #2a2e39",
          background: "#1e222d",
          marginBottom: 24,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: "#d1d4dc" }}>
              {ticker} - Price Chart with STD Channels
            </h2>
            <div style={{ fontSize: 12, color: "#787b86", fontFamily: "monospace" }}>
              Showing {chartData.length} bars
              {showChannel && ` | Window: ${stdData?.metadata.windowSize} | k1=${k1}, k2=${k2}`}
            </div>
          </div>
          <CandlestickChart
            data={chartData}
            height={700}
            showStdChannel={showChannel}
            showDeviation1={showDev1}
            showDeviation2={showDev2}
            stdChannelColor="#2962ff"
          />
        </div>
      )}

      {/* Mean Reversion Analysis */}
      {meanReversalInfo && (
        <div style={{
          padding: 20,
          borderRadius: 6,
          border: "1px solid #2a2e39",
          background: "#1e222d",
          marginBottom: 24,
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: "#d1d4dc" }}>
            Position Analysis
          </h2>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: "#787b86", marginBottom: 6 }}>Current Price</div>
              <div style={{ fontSize: 20, fontWeight: 600, fontFamily: "monospace", color: "#d1d4dc" }}>
                {meanReversalInfo.lastClose.toFixed(2)}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, color: "#787b86", marginBottom: 6 }}>Distance from Regression Line</div>
              <div style={{
                fontSize: 20,
                fontWeight: 600,
                fontFamily: "monospace",
                color: meanReversalInfo.sigmaUnits > 0 ? "#26a69a" : "#ef5350"
              }}>
                {meanReversalInfo.sigmaUnits > 0 ? "+" : ""}{meanReversalInfo.sigmaUnits.toFixed(2)}σ
              </div>
              <div style={{ fontSize: 11, color: "#787b86", marginTop: 2 }}>
                {meanReversalInfo.distanceFromMid > 0 ? "+" : ""}{meanReversalInfo.distanceFromMid.toFixed(2)} pts
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, color: "#787b86", marginBottom: 6 }}>Position Classification</div>
              <div style={{
                fontSize: 16,
                fontWeight: 600,
                color: meanReversalInfo.position === 'extreme_high' || meanReversalInfo.position === 'extreme_low' ? "#ef5350"
                  : meanReversalInfo.position === 'high' || meanReversalInfo.position === 'low' ? "#ff9800"
                  : "#787b86"
              }}>
                {meanReversalInfo.position === 'extreme_high' ? "Extreme High"
                  : meanReversalInfo.position === 'extreme_low' ? "Extreme Low"
                  : meanReversalInfo.position === 'high' ? "Elevated"
                  : meanReversalInfo.position === 'low' ? "Depressed"
                  : "Within Range"}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, color: "#787b86", marginBottom: 6 }}>
                Distance to {meanReversalInfo.sigmaUnits > 0 ? "Upper" : "Lower"} Band (±2σ)
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, fontFamily: "monospace", color: "#d1d4dc" }}>
                {meanReversalInfo.sigmaUnits > 0
                  ? `${meanReversalInfo.distanceToUpper2.toFixed(2)}%`
                  : `${meanReversalInfo.distanceToLower2.toFixed(2)}%`
                }
              </div>
              <div style={{ fontSize: 11, color: "#787b86", marginTop: 2 }}>
                Level: {meanReversalInfo.sigmaUnits > 0
                  ? meanReversalInfo.upperBand2.toFixed(2)
                  : meanReversalInfo.lowerBand2.toFixed(2)
                }
              </div>
            </div>
          </div>

          <div style={{
            padding: 14,
            borderRadius: 4,
            background: "#131722",
            border: "1px solid #2a2e39",
          }}>
            <div style={{ fontSize: 12, color: "#d1d4dc", lineHeight: 1.6 }}>
              <strong style={{ color: "#787b86" }}>Analysis:</strong>{" "}
              {meanReversalInfo.position === 'extreme_high' || meanReversalInfo.position === 'extreme_low' ? (
                <>
                  Price is currently {Math.abs(meanReversalInfo.sigmaUnits).toFixed(1)}σ {meanReversalInfo.sigmaUnits > 0 ? "above" : "below"} the regression line,
                  indicating an extended move. Historical patterns suggest increased probability of mean reversion.
                  The midline at {meanReversalInfo.midLine.toFixed(2)} represents the statistical mean for this period.
                </>
              ) : meanReversalInfo.position === 'high' || meanReversalInfo.position === 'low' ? (
                <>
                  Price is moderately {meanReversalInfo.sigmaUnits > 0 ? "elevated" : "depressed"} at {Math.abs(meanReversalInfo.sigmaUnits).toFixed(1)}σ
                  from the regression line. Monitor for potential continuation or reversal signals.
                </>
              ) : (
                <>
                  Price is trading within normal range (±0.8σ) of the regression line. Current position suggests
                  trend continuation is more likely than mean reversion.
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Instructions */}
      <div style={{
        marginTop: 24,
        padding: 20,
        borderRadius: 6,
        border: "1px solid #2a2e39",
        background: "#131722",
        fontSize: 13,
        lineHeight: 1.7,
        color: "#d1d4dc",
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: "#d1d4dc" }}>
          Features & Methodology
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "#787b86" }}>Core Features:</h4>
            <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6, color: "#d1d4dc" }}>
              <li><strong>Automatic Window Optimization:</strong> Identifies optimal lookback period (255-1530 bars) by maximizing R²</li>
              <li><strong>Fixed Window Analysis:</strong> Manual window size selection for specific time periods</li>
              <li><strong>Preset Time Ranges:</strong> Predefined configurations for short, medium, and long-term analysis</li>
              <li><strong>Position Analysis:</strong> Statistical classification of price position relative to regression channel</li>
              <li><strong>Flexible Zoom:</strong> Adjustable time range display for detailed examination</li>
            </ul>
          </div>
          <div>
            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "#787b86" }}>Position Classifications:</h4>
            <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6, color: "#d1d4dc" }}>
              <li><strong>Extreme High/Low:</strong> Price exceeds ±1.8σ - Elevated mean reversion probability</li>
              <li><strong>Elevated/Depressed:</strong> Price between ±0.8σ and ±1.8σ - Moderate deviation range</li>
              <li><strong>Within Range:</strong> Price within ±0.8σ - Normal statistical range</li>
              <li><strong>R² Interpretation:</strong> Values &gt; 0.7 indicate strong linear trend and reliable channel structure</li>
              <li><strong>Sigma Bands:</strong> Standard deviation multiples (±1σ, ±2σ) representing statistical price boundaries</li>
            </ul>
          </div>
        </div>
        <div style={{ marginTop: 16, padding: 12, borderRadius: 4, background: "#1e222d", border: "1px solid #2a2e39" }}>
          <div style={{ fontSize: 11, color: "#787b86" }}>
            <strong>Methodology Note:</strong> The standard deviation channel uses linear regression to identify the trend and statistical boundaries.
            Higher R² values indicate better linear fit and more reliable mean reversion characteristics. Position analysis considers both
            the distance from the regression line (in sigma units) and proximity to the outer bands. This tool is intended for analysis purposes
            and should be used in conjunction with other technical and fundamental analysis methods.
          </div>
        </div>
      </div>
    </main>
  );
}
