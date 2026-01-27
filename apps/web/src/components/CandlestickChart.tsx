"use client";

import { useMemo, useRef, useEffect, useState } from "react";
import {
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type OHLCData = {
  date: string;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close: number;
  midLine?: number | null;
  upperBand1?: number | null;
  lowerBand1?: number | null;
  upperBand2?: number | null;
  lowerBand2?: number | null;
};

type CandlestickChartProps = {
  data: OHLCData[];
  height?: number;
  showStdChannel?: boolean;
  stdChannelColor?: string;
  showDeviation1?: boolean;
  showDeviation2?: boolean;
};

export default function CandlestickChart({
  data,
  height = 400,
  showStdChannel = false,
  stdChannelColor = "#2962ff",
  showDeviation1 = true,
  showDeviation2 = true,
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [chartDimensions, setChartDimensions] = useState<{
    width: number;
    height: number;
    left: number;
    top: number;
  } | null>(null);

  const [crosshair, setCrosshair] = useState<{ x: number; y: number; dataIndex: number } | null>(null);

  // Calculate domain with padding
  const [minPrice, maxPrice] = useMemo(() => {
    if (!data || data.length === 0) return [0, 100];

    let min = Infinity;
    let max = -Infinity;

    for (const d of data) {
      const low = d.low ?? d.close;
      const high = d.high ?? d.close;
      if (low < min) min = low;
      if (high > max) max = high;

      // Include STD channel bands in domain calculation
      if (showStdChannel) {
        if (showDeviation1) {
          if (d.lowerBand1 != null && d.lowerBand1 < min) min = d.lowerBand1;
          if (d.upperBand1 != null && d.upperBand1 > max) max = d.upperBand1;
        }
        if (showDeviation2) {
          if (d.lowerBand2 != null && d.lowerBand2 < min) min = d.lowerBand2;
          if (d.upperBand2 != null && d.upperBand2 > max) max = d.upperBand2;
        }
      }
    }

    const padding = (max - min) * 0.05;
    return [min - padding, max + padding];
  }, [data, showStdChannel, showDeviation1, showDeviation2]);

  // Measure the chart area after render
  useEffect(() => {
    if (!containerRef.current) return;

    const measureChart = () => {
      const container = containerRef.current;
      if (!container) return;

      // Find the SVG element
      const svg = container.querySelector('svg.recharts-surface');

      if (svg) {
        const svgRect = svg.getBoundingClientRect();

        // Use fixed margins that match ComposedChart margins
        const marginLeft = 10;
        const marginTop = 10;
        const marginRight = 65; // YAxis width
        const marginBottom = 35; // XAxis height

        const chartWidth = svgRect.width - marginLeft - marginRight;
        const chartHeight = svgRect.height - marginTop - marginBottom;

        setChartDimensions({
          width: chartWidth,
          height: chartHeight,
          left: marginLeft,
          top: marginTop,
        });
      }
    };

    // Measure multiple times to ensure Recharts has fully rendered
    const timer1 = setTimeout(measureChart, 100);
    const timer2 = setTimeout(measureChart, 300);

    // Re-measure on window resize
    window.addEventListener('resize', measureChart);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      window.removeEventListener('resize', measureChart);
    };
  }, [data]);

  if (!data || data.length === 0) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>
        No OHLC data available
      </div>
    );
  }

  // Mouse move handler for crosshair
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!chartDimensions || !data.length) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check if mouse is within chart area
    const { left, top, width, height: chartHeight } = chartDimensions;
    if (x < left || x > left + width || y < top || y > top + chartHeight) {
      setCrosshair(null);
      return;
    }

    // Find nearest candle
    const candleGap = width / data.length;
    const dataIndex = Math.floor((x - left) / candleGap);

    if (dataIndex >= 0 && dataIndex < data.length) {
      setCrosshair({ x, y, dataIndex });
    }
  };

  const handleMouseLeave = () => {
    setCrosshair(null);
  };

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height, position: "relative", cursor: crosshair ? "crosshair" : "default" }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 10, right: 10, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />

          <XAxis
            dataKey="date"
            stroke="var(--muted)"
            fontSize={11}
            tickFormatter={(val) => {
              if (!val) return "";
              const parts = val.split("-");
              if (parts.length >= 2) {
                return `${parts[1]}/${parts[2]}`;
              }
              return val.slice(5);
            }}
            minTickGap={50}
            tickMargin={8}
          />

          <YAxis
            stroke="var(--muted)"
            fontSize={11}
            domain={[minPrice, maxPrice]}
            tickFormatter={(val) => val.toFixed(2)}
            width={55}
            orientation="right"
          />

          <Tooltip
            cursor={false}
            contentStyle={{
              backgroundColor: "#1e222d",
              border: "1px solid #363a45",
              borderRadius: "4px",
              fontSize: "12px",
              padding: "8px 12px",
            }}
            labelStyle={{ color: "#787b86", marginBottom: "6px", fontWeight: 500 }}
            content={(props: any) => {
              const { active, payload, label } = props;
              if (!active || !payload || !payload.length) return null;

              const d = payload[0]?.payload;
              if (!d) return null;

              const open = d.open ?? d.close;
              const isUp = d.close >= open;
              const change = open > 0 ? ((d.close - open) / open * 100) : 0;

              return (
                <div style={{
                  backgroundColor: "#1e222d",
                  border: "1px solid #363a45",
                  borderRadius: "4px",
                  padding: "8px 12px",
                  fontSize: "12px",
                }}>
                  <div style={{ color: "#787b86", marginBottom: "6px", fontWeight: 500 }}>
                    {label}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "16px" }}>
                      <span style={{ color: "#787b86" }}>O</span>
                      <span style={{ fontFamily: "monospace", color: "#d1d4dc" }}>{d.open?.toFixed(2) ?? "-"}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "16px" }}>
                      <span style={{ color: "#787b86" }}>H</span>
                      <span style={{ fontFamily: "monospace", color: "#d1d4dc" }}>{d.high?.toFixed(2) ?? "-"}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "16px" }}>
                      <span style={{ color: "#787b86" }}>L</span>
                      <span style={{ fontFamily: "monospace", color: "#d1d4dc" }}>{d.low?.toFixed(2) ?? "-"}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "16px" }}>
                      <span style={{ color: "#787b86" }}>C</span>
                      <span style={{ fontFamily: "monospace", color: "#d1d4dc", fontWeight: 600 }}>{d.close?.toFixed(2)}</span>
                    </div>
                  </div>
                  <div style={{
                    borderTop: "1px solid #363a45",
                    marginTop: "6px",
                    paddingTop: "4px",
                    color: isUp ? "#26a69a" : "#ef5350",
                    fontFamily: "monospace",
                    fontWeight: 600,
                  }}>
                    {isUp ? "+" : ""}{change.toFixed(2)}%
                  </div>
                  {showStdChannel && (d.midLine != null || d.upperBand1 != null || d.upperBand2 != null) && (
                    <>
                      <div style={{
                        borderTop: "1px solid #363a45",
                        marginTop: "6px",
                        paddingTop: "6px",
                        fontSize: "11px",
                        color: "#787b86"
                      }}>
                        STD Channel
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "11px" }}>
                        {showDeviation2 && d.upperBand2 != null && (
                          <div style={{ display: "flex", justifyContent: "space-between", gap: "16px" }}>
                            <span style={{ color: "#787b86" }}>Upper +2σ</span>
                            <span style={{ fontFamily: "monospace", color: "#4caf50" }}>{d.upperBand2.toFixed(2)}</span>
                          </div>
                        )}
                        {showDeviation1 && d.upperBand1 != null && (
                          <div style={{ display: "flex", justifyContent: "space-between", gap: "16px" }}>
                            <span style={{ color: "#787b86" }}>Upper +1σ</span>
                            <span style={{ fontFamily: "monospace", color: stdChannelColor }}>{d.upperBand1.toFixed(2)}</span>
                          </div>
                        )}
                        {d.midLine != null && (
                          <div style={{ display: "flex", justifyContent: "space-between", gap: "16px" }}>
                            <span style={{ color: "#787b86" }}>Mid</span>
                            <span style={{ fontFamily: "monospace", color: stdChannelColor }}>{d.midLine.toFixed(2)}</span>
                          </div>
                        )}
                        {showDeviation1 && d.lowerBand1 != null && (
                          <div style={{ display: "flex", justifyContent: "space-between", gap: "16px" }}>
                            <span style={{ color: "#787b86" }}>Lower -1σ</span>
                            <span style={{ fontFamily: "monospace", color: "#ff9800" }}>{d.lowerBand1.toFixed(2)}</span>
                          </div>
                        )}
                        {showDeviation2 && d.lowerBand2 != null && (
                          <div style={{ display: "flex", justifyContent: "space-between", gap: "16px" }}>
                            <span style={{ color: "#787b86" }}>Lower -2σ</span>
                            <span style={{ fontFamily: "monospace", color: "#4caf50" }}>{d.lowerBand2.toFixed(2)}</span>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            }}
          />

        </ComposedChart>
      </ResponsiveContainer>

      {/* Candlesticks overlay */}
      {chartDimensions && (
        <svg
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        >
          {/* STD Channel Bands */}
          {showStdChannel && (() => {
            const { width, height: chartHeight, left, top } = chartDimensions;
            const candleGap = width / data.length;

            const yScale = (price: number): number => {
              return top + chartHeight - ((price - minPrice) / (maxPrice - minPrice)) * chartHeight;
            };

            // REQUIREMENT: Must have channel data to render
            const channelDataCount = data.filter(d =>
              d.midLine != null && d.upperBand1 != null && d.lowerBand1 != null
            ).length;

            console.log('[STD Channel Debug]', {
              totalDataPoints: data.length,
              pointsWithChannelData: channelDataCount,
              showDeviation1,
              showDeviation2,
              sampleData: data.slice(-5).map(d => ({
                date: d.date,
                close: d.close,
                midLine: d.midLine,
                upperBand1: d.upperBand1,
                lowerBand1: d.lowerBand1,
              }))
            });

            if (channelDataCount < 50) {
              console.error('CandlestickChart: Insufficient STD channel data - need at least 50 points, got', channelDataCount);
              return null;
            }

            // Generate path for each band line
            const createPath = (valueKey: keyof OHLCData): string => {
              const points: string[] = [];
              data.forEach((d, i) => {
                const value = d[valueKey];
                if (value != null && typeof value === 'number') {
                  const x = left + (i + 0.5) * candleGap;
                  const y = yScale(value);
                  points.push(i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`);
                }
              });
              return points.join(' ');
            };

            // Create filled area path (TradingView style)
            const createFillPath = (upperKey: keyof OHLCData, lowerKey: keyof OHLCData): string => {
              const points: string[] = [];

              // Forward pass (upper line)
              data.forEach((d, i) => {
                const upper = d[upperKey];
                if (upper != null && typeof upper === 'number') {
                  const x = left + (i + 0.5) * candleGap;
                  const y = yScale(upper);
                  points.push(i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`);
                }
              });

              // Backward pass (lower line)
              for (let i = data.length - 1; i >= 0; i--) {
                const d = data[i];
                const lower = d[lowerKey];
                if (lower != null && typeof lower === 'number') {
                  const x = left + (i + 0.5) * candleGap;
                  const y = yScale(lower);
                  points.push(`L ${x} ${y}`);
                }
              }

              points.push('Z'); // Close path
              return points.join(' ');
            };

            // Parse hex color and add opacity (Increased for better contrast)
            const addOpacity = (hexColor: string, opacity: number): string => {
              const hex = hexColor.replace('#', '');
              const r = parseInt(hex.substring(0, 2), 16);
              const g = parseInt(hex.substring(2, 4), 16);
              const b = parseInt(hex.substring(4, 6), 16);
              return `rgba(${r}, ${g}, ${b}, ${opacity})`;
            };

            const upperFillColor1 = addOpacity(stdChannelColor, 0.12); // Blue fill for ±1σ (increased from 0.08)
            const lowerFillColor1 = addOpacity('#ff9800', 0.12); // Orange fill for ±1σ (increased from 0.08)
            const upperFillColor2 = addOpacity('#4caf50', 0.12); // Green fill for ±2σ (increased from 0.08)
            const lowerFillColor2 = addOpacity('#4caf50', 0.12); // Green fill for ±2σ (increased from 0.08)

            return (
              <g>
                {/* Deviation 2 filled areas (outer, drawn first) */}
                {showDeviation2 && (
                  <>
                    <path
                      d={createFillPath('upperBand2', 'midLine')}
                      fill={upperFillColor2}
                      stroke="none"
                    />
                    <path
                      d={createFillPath('midLine', 'lowerBand2')}
                      fill={lowerFillColor2}
                      stroke="none"
                    />
                  </>
                )}

                {/* Deviation 1 filled areas (inner, drawn on top) */}
                {showDeviation1 && (
                  <>
                    <path
                      d={createFillPath('upperBand1', 'midLine')}
                      fill={upperFillColor1}
                      stroke="none"
                    />
                    <path
                      d={createFillPath('midLine', 'lowerBand1')}
                      fill={lowerFillColor1}
                      stroke="none"
                    />
                  </>
                )}

                {/* Band lines with dashed style - Improved contrast */}
                {showDeviation2 && (
                  <>
                    <path
                      d={createPath('upperBand2')}
                      stroke="#4caf50"
                      strokeWidth={1.5}
                      fill="none"
                      strokeDasharray="5 3"
                      opacity={0.8}
                    />
                    <path
                      d={createPath('lowerBand2')}
                      stroke="#4caf50"
                      strokeWidth={1.5}
                      fill="none"
                      strokeDasharray="5 3"
                      opacity={0.8}
                    />
                  </>
                )}

                {showDeviation1 && (
                  <>
                    <path
                      d={createPath('upperBand1')}
                      stroke={stdChannelColor}
                      strokeWidth={1.5}
                      fill="none"
                      strokeDasharray="5 3"
                      opacity={0.8}
                    />
                    <path
                      d={createPath('lowerBand1')}
                      stroke="#ff9800"
                      strokeWidth={1.5}
                      fill="none"
                      strokeDasharray="5 3"
                      opacity={0.8}
                    />
                  </>
                )}

                {/* Mid line - More visible */}
                <path
                  d={createPath('midLine')}
                  stroke={stdChannelColor}
                  strokeWidth={2}
                  fill="none"
                  strokeDasharray="6 4"
                  opacity={0.7}
                />
              </g>
            );
          })()}

          {/* Candlesticks */}
          {data.map((d, index) => {
            const open = d.open ?? d.close;
            const high = d.high ?? d.close;
            const low = d.low ?? d.close;
            const close = d.close;

            const isUp = close >= open;
            const bullColor = "#26a69a"; // TradingView green
            const bearColor = "#ef5350"; // TradingView red
            const color = isUp ? bullColor : bearColor;

            // Calculate positions
            const { width, height: chartHeight, left, top } = chartDimensions;

            const candleGap = width / data.length;
            const candleWidth = Math.max(Math.min(candleGap * 0.7, 8), 1);
            const centerX = left + (index + 0.5) * candleGap;

            // Y scale
            const yScale = (price: number): number => {
              return top + chartHeight - ((price - minPrice) / (maxPrice - minPrice)) * chartHeight;
            };

            const yHigh = yScale(high);
            const yLow = yScale(low);
            const yOpen = yScale(open);
            const yClose = yScale(close);

            const bodyTop = Math.min(yOpen, yClose);
            const bodyBottom = Math.max(yOpen, yClose);
            const bodyHeight = Math.max(bodyBottom - bodyTop, 1);

            return (
              <g key={`candle-${index}`}>
                {/* Upper wick */}
                <line
                  x1={centerX}
                  y1={yHigh}
                  x2={centerX}
                  y2={bodyTop}
                  stroke={color}
                  strokeWidth={1}
                />
                {/* Lower wick */}
                <line
                  x1={centerX}
                  y1={bodyBottom}
                  x2={centerX}
                  y2={yLow}
                  stroke={color}
                  strokeWidth={1}
                />
                {/* Body */}
                <rect
                  x={centerX - candleWidth / 2}
                  y={bodyTop}
                  width={candleWidth}
                  height={bodyHeight}
                  fill={isUp ? "transparent" : color}
                  stroke={color}
                  strokeWidth={1}
                />
              </g>
            );
          })}

          {/* Crosshair */}
          {crosshair && (() => {
            const { width, height: chartHeight, left, top } = chartDimensions;
            const d = data[crosshair.dataIndex];
            if (!d) return null;

            const yScale = (price: number): number => {
              return top + chartHeight - ((price - minPrice) / (maxPrice - minPrice)) * chartHeight;
            };

            const priceY = yScale(d.close);

            return (
              <g>
                {/* Vertical crosshair line */}
                <line
                  x1={crosshair.x}
                  y1={top}
                  x2={crosshair.x}
                  y2={top + chartHeight}
                  stroke="rgba(255, 255, 255, 0.3)"
                  strokeWidth={1}
                  strokeDasharray="4 2"
                />

                {/* Horizontal crosshair line */}
                <line
                  x1={left}
                  y1={priceY}
                  x2={left + width}
                  y2={priceY}
                  stroke="rgba(255, 255, 255, 0.3)"
                  strokeWidth={1}
                  strokeDasharray="4 2"
                />

                {/* Price label on Y-axis */}
                <g>
                  <rect
                    x={left + width}
                    y={priceY - 12}
                    width={55}
                    height={24}
                    fill="#2962ff"
                    opacity={0.9}
                  />
                  <text
                    x={left + width + 27.5}
                    y={priceY + 4}
                    fill="white"
                    fontSize={12}
                    fontFamily="monospace"
                    textAnchor="middle"
                    fontWeight={600}
                  >
                    {d.close.toFixed(2)}
                  </text>
                </g>

                {/* Date label on X-axis */}
                <g>
                  <rect
                    x={crosshair.x - 40}
                    y={top + chartHeight}
                    width={80}
                    height={24}
                    fill="#2962ff"
                    opacity={0.9}
                  />
                  <text
                    x={crosshair.x}
                    y={top + chartHeight + 16}
                    fill="white"
                    fontSize={11}
                    fontFamily="monospace"
                    textAnchor="middle"
                    fontWeight={500}
                  >
                    {d.date}
                  </text>
                </g>
              </g>
            );
          })()}
        </svg>
      )}

      {/* Floating price panel (TradingView style) */}
      {crosshair && (() => {
        const d = data[crosshair.dataIndex];
        if (!d) return null;

        const open = d.open ?? d.close;
        const isUp = d.close >= open;
        const change = open > 0 ? ((d.close - open) / open * 100) : 0;

        return (
          <div style={{
            position: "absolute",
            top: 10,
            left: 10,
            background: "rgba(30, 34, 45, 0.95)",
            border: "1px solid #363a45",
            borderRadius: 4,
            padding: "8px 12px",
            fontSize: 12,
            fontFamily: "monospace",
            pointerEvents: "none",
            zIndex: 1000,
          }}>
            <div style={{ marginBottom: 4, color: "#787b86", fontSize: 11 }}>{d.date}</div>
            <div style={{ display: "flex", gap: 12 }}>
              <span style={{ color: "#787b86" }}>O</span>
              <span style={{ color: "#d1d4dc" }}>{d.open?.toFixed(2) ?? "-"}</span>
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <span style={{ color: "#787b86" }}>H</span>
              <span style={{ color: "#d1d4dc" }}>{d.high?.toFixed(2) ?? "-"}</span>
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <span style={{ color: "#787b86" }}>L</span>
              <span style={{ color: "#d1d4dc" }}>{d.low?.toFixed(2) ?? "-"}</span>
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <span style={{ color: "#787b86" }}>C</span>
              <span style={{ color: "#d1d4dc", fontWeight: 600 }}>{d.close.toFixed(2)}</span>
            </div>
            <div style={{ marginTop: 4, color: isUp ? "#26a69a" : "#ef5350", fontWeight: 600 }}>
              {isUp ? "+" : ""}{change.toFixed(2)}%
            </div>
            {showStdChannel && (d.midLine != null || d.upperBand1 != null || d.upperBand2 != null) && (
              <>
                <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #363a45" }}>
                  <div style={{ color: "#787b86", fontSize: 10, marginBottom: 4 }}>STD Channel</div>
                  {showDeviation2 && d.upperBand2 != null && (
                    <div style={{ display: "flex", gap: 12 }}>
                      <span style={{ color: "#787b86", fontSize: 10 }}>+2σ</span>
                      <span style={{ color: "#4caf50" }}>{d.upperBand2.toFixed(2)}</span>
                    </div>
                  )}
                  {showDeviation1 && d.upperBand1 != null && (
                    <div style={{ display: "flex", gap: 12 }}>
                      <span style={{ color: "#787b86", fontSize: 10 }}>+1σ</span>
                      <span style={{ color: "#2962ff" }}>{d.upperBand1.toFixed(2)}</span>
                    </div>
                  )}
                  {d.midLine != null && (
                    <div style={{ display: "flex", gap: 12 }}>
                      <span style={{ color: "#787b86", fontSize: 10 }}>Mid</span>
                      <span style={{ color: "#2962ff" }}>{d.midLine.toFixed(2)}</span>
                    </div>
                  )}
                  {showDeviation1 && d.lowerBand1 != null && (
                    <div style={{ display: "flex", gap: 12 }}>
                      <span style={{ color: "#787b86", fontSize: 10 }}>-1σ</span>
                      <span style={{ color: "#ff9800" }}>{d.lowerBand1.toFixed(2)}</span>
                    </div>
                  )}
                  {showDeviation2 && d.lowerBand2 != null && (
                    <div style={{ display: "flex", gap: 12 }}>
                      <span style={{ color: "#787b86", fontSize: 10 }}>-2σ</span>
                      <span style={{ color: "#4caf50" }}>{d.lowerBand2.toFixed(2)}</span>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}
