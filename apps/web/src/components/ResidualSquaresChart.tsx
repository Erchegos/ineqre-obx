"use client";

import { useMemo, useState } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Line,
} from "recharts";

type ResidualSquaresChartProps = {
  data: Array<{
    date: string;
    stockReturn: number;
    marketReturn: number;
    residual: number;
    residualSquare: number;
  }>;
  alpha?: number;
  beta?: number;
  rSquared?: number;
  height?: number;
  ticker?: string;
};

export default function ResidualSquaresChart({
  data,
  alpha = 0,
  beta = 0,
  rSquared = 0,
  height = 400,
  ticker,
}: ResidualSquaresChartProps) {
  const [period, setPeriod] = useState<string>("All");
  const [showGuide, setShowGuide] = useState<boolean>(false);

  if (!data || data.length === 0) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
        }}
      >
        No data available
      </div>
    );
  }

  // Filter data based on selected period and calculate regression
  const { filteredData, filteredRegression } = useMemo(() => {
    const periodDays: Record<string, number> = {
      "1M": 21,
      "3M": 63,
      "6M": 126,
      "1Y": 252,
      "3Y": 756,
      "All": data.length,
    };

    const days = periodDays[period] || data.length;
    const startIdx = Math.max(0, data.length - days);
    const slicedData = data.slice(startIdx);

    if (slicedData.length === 0) {
      return {
        filteredData: [],
        filteredRegression: { alpha: 0, beta: 0, rSquared: 0 }
      };
    }

    // Calculate regression statistics on filtered data
    const n = slicedData.length;
    const stockReturns = slicedData.map(d => d.stockReturn);
    const marketReturns = slicedData.map(d => d.marketReturn);

    // Calculate means
    const meanStock = stockReturns.reduce((a, b) => a + b, 0) / n;
    const meanMarket = marketReturns.reduce((a, b) => a + b, 0) / n;

    // Calculate covariance and variance
    let covariance = 0;
    let marketVariance = 0;
    for (let i = 0; i < n; i++) {
      const stockDiff = stockReturns[i] - meanStock;
      const marketDiff = marketReturns[i] - meanMarket;
      covariance += stockDiff * marketDiff;
      marketVariance += marketDiff * marketDiff;
    }

    // Beta = Cov(stock, market) / Var(market)
    const calcBeta = marketVariance !== 0 ? covariance / marketVariance : 0;

    // Alpha = mean(stock) - beta * mean(market)
    const calcAlpha = meanStock - calcBeta * meanMarket;

    // Calculate R²
    let ssRes = 0;
    let ssTot = 0;
    for (let i = 0; i < n; i++) {
      const predicted = calcAlpha + calcBeta * marketReturns[i];
      const residual = stockReturns[i] - predicted;
      ssRes += residual * residual;
      ssTot += Math.pow(stockReturns[i] - meanStock, 2);
    }

    const calcRSquared = ssTot !== 0 ? 1 - (ssRes / ssTot) : 0;

    // Map data with recalculated residuals
    const mappedData = slicedData.map((d) => {
      const predicted = calcAlpha + calcBeta * d.marketReturn;
      const newResidual = d.stockReturn - predicted;

      return {
        x: d.marketReturn * 100, // Market return as percentage for x-axis
        y: d.stockReturn * 100, // Stock return as percentage for y-axis
        date: d.date,
        residual: newResidual, // Recalculated residual
        residualSquare: newResidual * newResidual,
        stockReturn: d.stockReturn,
        marketReturn: d.marketReturn,
      };
    });

    return {
      filteredData: mappedData,
      filteredRegression: {
        alpha: calcAlpha,
        beta: calcBeta,
        rSquared: calcRSquared,
      }
    };
  }, [data, period]);

  // Calculate RSS and regression line using filtered beta and alpha
  const { rss, regressionLine } = useMemo(() => {
    if (filteredData.length === 0) return { rss: 0, regressionLine: [] };

    // Recalculate residuals based on filtered regression
    const totalRSS = filteredData.reduce((sum, d) => {
      const predicted = filteredRegression.alpha + filteredRegression.beta * d.marketReturn;
      const residual = d.stockReturn - predicted;
      return sum + residual * residual * 10000; // Convert to percentage squared
    }, 0);

    // Generate regression line: y = alpha + beta * x (already in percentage)
    const minX = Math.min(...filteredData.map(d => d.x));
    const maxX = Math.max(...filteredData.map(d => d.x));

    // Convert alpha and beta from decimal to percentage for display
    const alphaPercent = filteredRegression.alpha * 100;
    const regressionLineData = [
      { x: minX, y: alphaPercent + filteredRegression.beta * minX },
      { x: maxX, y: alphaPercent + filteredRegression.beta * maxX },
    ];

    return {
      rss: totalRSS,
      regressionLine: regressionLineData,
    };
  }, [filteredData, filteredRegression]);

  return (
    <div style={{ width: "100%" }}>
      {/* Control Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          padding: "8px 12px",
          background: "var(--card-bg)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 6,
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          {["1M", "3M", "6M", "1Y", "3Y", "All"].map((p) => {
            const isActive = period === p;
            return (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 4,
                  border: `1px solid ${isActive ? "var(--accent)" : "var(--border)"}`,
                  background: isActive ? "var(--accent)" : "var(--card-bg)",
                  color: isActive ? "#fff" : "var(--foreground)",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  transform: "scale(1)",
                  boxShadow: isActive ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
                }}
                onMouseEnter={(e) => {
                  if (isActive) {
                    e.currentTarget.style.filter = "brightness(0.9)";
                  } else {
                    e.currentTarget.style.background = "var(--hover-bg)";
                    e.currentTarget.style.borderColor = "var(--accent)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (isActive) {
                    e.currentTarget.style.filter = "brightness(1)";
                  } else {
                    e.currentTarget.style.background = "var(--card-bg)";
                    e.currentTarget.style.borderColor = "var(--border)";
                  }
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = "scale(0.95)";
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = "scale(1)";
                }}
              >
                {p}
              </button>
            );
          })}
        </div>
        <div
          style={{
            display: "flex",
            gap: 16,
            fontSize: 12,
            color: "var(--muted)",
            fontFamily: "monospace",
          }}
        >
          <div>
            <span style={{ color: "var(--muted-foreground)" }}>β:</span>{" "}
            <strong style={{ color: "var(--foreground)" }}>
              {filteredRegression.beta.toFixed(3)}
            </strong>
          </div>
          <div>
            <span style={{ color: "var(--muted-foreground)" }}>α:</span>{" "}
            {(filteredRegression.alpha * 100).toFixed(4)}%
          </div>
          <div>
            <span style={{ color: "var(--muted-foreground)" }}>R²:</span>{" "}
            {filteredRegression.rSquared.toFixed(3)}
          </div>
        </div>
      </div>

      {/* Chart */}
      <div style={{ position: "relative", width: "100%", height, background: "var(--card-bg)", borderRadius: 8, padding: 8 }}>
        <ResponsiveContainer width="100%" height={height}>
          <ScatterChart margin={{ top: 20, right: 30, left: 20, bottom: 30 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border-subtle)"
              opacity={0.2}
            />

            <XAxis
              dataKey="x"
              type="number"
              stroke="var(--muted)"
              fontSize={12}
              tickFormatter={(val) => `${val.toFixed(1)}%`}
              domain={["auto", "auto"]}
              label={{
                value: "Market Daily Return (OBX)",
                position: "insideBottom",
                offset: -10,
                style: { fontSize: 12, fill: "var(--foreground)", fontWeight: 500 },
              }}
            />

            <YAxis
              dataKey="y"
              stroke="var(--muted)"
              fontSize={12}
              tickFormatter={(val) => `${val.toFixed(1)}%`}
              label={{
                value: ticker ? `${ticker} Daily Return` : "Stock Daily Return",
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 12, fill: "var(--foreground)", fontWeight: 500 },
              }}
            />

            <Tooltip
              contentStyle={{
                backgroundColor: "var(--card-bg)",
                borderColor: "var(--card-border)",
                color: "var(--foreground)",
                borderRadius: "4px",
                fontSize: "12px",
                padding: "8px 10px",
              }}
              labelStyle={{
                color: "var(--muted)",
                marginBottom: "6px",
                fontWeight: 600,
              }}
              content={(props: any) => {
                const { active, payload } = props;
                if (!active || !payload || !payload.length) return null;

                const point = payload[0].payload;
                return (
                  <div
                    style={{
                      backgroundColor: "var(--card-bg)",
                      border: "1px solid var(--card-border)",
                      borderRadius: "4px",
                      padding: "8px 10px",
                      fontSize: "12px",
                    }}
                  >
                    <div
                      style={{
                        color: "var(--muted)",
                        marginBottom: "4px",
                        fontWeight: 600,
                      }}
                    >
                      {point.date}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "12px",
                        marginBottom: "2px",
                      }}
                    >
                      <span>Market Return:</span>
                      <span
                        style={{ fontWeight: 600, fontFamily: "monospace" }}
                      >
                        {point.x.toFixed(3)}%
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "12px",
                        marginBottom: "2px",
                      }}
                    >
                      <span>Stock Return:</span>
                      <span
                        style={{ fontWeight: 600, fontFamily: "monospace" }}
                      >
                        {point.y.toFixed(3)}%
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "12px",
                      }}
                    >
                      <span>Residual (ε):</span>
                      <span
                        style={{
                          fontWeight: 600,
                          fontFamily: "monospace",
                          color:
                            point.residual >= 0 ? "#22c55e" : "#ef4444",
                        }}
                      >
                        {(point.residual * 100).toFixed(3)}%
                      </span>
                    </div>
                  </div>
                );
              }}
            />

            {/* Regression line */}
            <Line
              data={regressionLine}
              type="monotone"
              dataKey="y"
              stroke="#d97706"
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />

            {/* Scatter dots */}
            <Scatter
              data={filteredData}
              fill="#3b82f6"
              fillOpacity={0.5}
              strokeWidth={0}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Interpretation Guide - Collapsible */}
      <div
        style={{
          marginTop: 16,
          border: "1px solid var(--border)",
          borderRadius: 6,
          overflow: "hidden",
          background: "var(--card-bg)",
        }}
      >
        <button
          onClick={() => setShowGuide(!showGuide)}
          style={{
            width: "100%",
            padding: "10px 12px",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--foreground)",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--hover-bg)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          <span>How to Read This Chart</span>
          <span style={{ fontSize: 16 }}>{showGuide ? "▼" : "▶"}</span>
        </button>
        {showGuide && (
          <div
            style={{
              padding: 12,
              background: "var(--hover-bg)",
              fontSize: 11,
              color: "var(--muted-foreground)",
              lineHeight: 1.5,
              borderTop: "1px solid var(--border)",
            }}
          >
            <div style={{ display: "grid", gap: 4 }}>
              <div>
                <strong>CAPM Regression:</strong> R<sub>stock</sub> = α + β × R<sub>market</sub> + ε
              </div>
              <div>
                <strong>Beta (β):</strong> Market sensitivity. β = 1 means stock moves with market, β &gt; 1 means more volatile
              </div>
              <div>
                <strong>Alpha (α):</strong> Excess return above market. Positive α indicates outperformance
              </div>
              <div>
                <strong>R²:</strong> How much variance is explained by market. High R² = stock follows market closely
              </div>
              <div>
                <strong>Orange line:</strong> Regression fit. Points far from line = high idiosyncratic risk
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
