"use client";

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import {
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Line,
  ReferenceLine,
} from "recharts";

// ─── Types ───────────────────────────────────────────────────────────────────

type OHLCVData = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type ChartType = "line" | "candle";
type Indicator = "ema20" | "ema50" | "ema200" | "vwap" | "bb" | "rsi" | "volume";

type TradingChartProps = {
  data: OHLCVData[];
  height?: number;
  /** How many bars to show initially (default: all data). Parent can set e.g. 63 for 3M view. */
  initialBars?: number;
};

// ─── Colors ──────────────────────────────────────────────────────────────────

const BULL = "#26a69a";
const BEAR = "#ef5350";
const EMA20 = "#2196f3";
const EMA50 = "#ff9800";
const EMA200 = "#e91e63";
const VWAP_COLOR = "#ab47bc";
const BB_COLOR = "#78909c";
const RSI_COLOR = "#2196f3";
const GRID = "rgba(255,255,255,0.05)";
const DIM = "#6b7280";
const MID = "#9ca3af";
const BRIGHT = "#d1d4dc";

const MARGIN = { top: 8, right: 60, bottom: 20, left: 0 };
const MIN_BARS = 15;
const MAX_BARS = 600;

// ─── Indicator calculations ──────────────────────────────────────────────────

function calcEMA(closes: number[], period: number): (number | null)[] {
  const alpha = 2 / (period + 1);
  const result: (number | null)[] = [];
  let ema: number | null = null;
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { result.push(null); }
    else if (ema === null) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += closes[j];
      ema = sum / period;
      result.push(ema);
    } else {
      ema = closes[i] * alpha + ema * (1 - alpha);
      result.push(ema);
    }
  }
  return result;
}

function calcVWAP(data: OHLCVData[]): (number | null)[] {
  let cumTPV = 0, cumVol = 0;
  return data.map((d) => {
    if (d.volume <= 0) return cumVol > 0 ? cumTPV / cumVol : null;
    const tp = (d.high + d.low + d.close) / 3;
    cumTPV += tp * d.volume;
    cumVol += d.volume;
    return cumTPV / cumVol;
  });
}

function calcBB(closes: number[], period = 20, mult = 2) {
  const upper: (number | null)[] = [];
  const middle: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { upper.push(null); middle.push(null); lower.push(null); }
    else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += closes[j];
      const sma = sum / period;
      let sqSum = 0;
      for (let j = i - period + 1; j <= i; j++) sqSum += (closes[j] - sma) ** 2;
      const std = Math.sqrt(sqSum / period);
      middle.push(sma);
      upper.push(sma + mult * std);
      lower.push(sma - mult * std);
    }
  }
  return { upper, middle, lower };
}

function calcRSI(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = [];
  if (closes.length < period + 1) return closes.map(() => null);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change; else avgLoss += Math.abs(change);
    result.push(null);
  }
  avgGain /= period; avgLoss /= period;
  result[0] = null;
  result.push(100 - 100 / (1 + (avgLoss === 0 ? 100 : avgGain / avgLoss)));
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
    result.push(100 - 100 / (1 + (avgLoss === 0 ? 100 : avgGain / avgLoss)));
  }
  return result;
}

// ─── Format helpers ──────────────────────────────────────────────────────────

const fmtP = (v: number) => v >= 1000 ? v.toFixed(0) : v >= 100 ? v.toFixed(1) : v.toFixed(2);
const fmtVol = (v: number) => v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v);
const fmtDate = (val: string) => { if (!val) return ""; const p = val.split("-"); return p.length >= 3 ? `${p[1]}/${p[2]}` : val.slice(5); };

// ─── Main Component ─────────────────────────────────────────────────────────

export default function TradingChart({ data, height = 500, initialBars }: TradingChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const autoType: ChartType = data.length > 200 ? "line" : "candle";
  const [typeOverride, setTypeOverride] = useState<ChartType | null>(null);
  const chartType = typeOverride ?? autoType;
  const [indicators, setIndicators] = useState<Set<Indicator>>(new Set(["volume", "bb"]));
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number; l: number; t: number } | null>(null);

  // ─── Viewport: which slice of data is visible ──────────────────────────────
  // viewEnd is exclusive index. View shows data[viewStart..viewEnd-1].
  const total = data.length;
  const defaultBars = initialBars ? Math.min(initialBars, total) : total;
  const [viewStart, setViewStart] = useState(Math.max(0, total - defaultBars));
  const [viewEnd, setViewEnd] = useState(total);

  // Reset viewport when data changes (e.g. timeframe switch)
  const prevDataLen = useRef(total);
  useEffect(() => {
    if (total !== prevDataLen.current) {
      const bars = initialBars ? Math.min(initialBars, total) : total;
      setViewStart(Math.max(0, total - bars));
      setViewEnd(total);
      setYOffset(0);
      prevDataLen.current = total;
    }
  }, [total, initialBars]);

  // Y-axis offset for vertical panning (in price units)
  const [yOffset, setYOffset] = useState(0);

  // Drag state
  const dragRef = useRef<{ startX: number; startY: number; origStart: number; origEnd: number; origYOffset: number } | null>(null);

  const toggle = useCallback((ind: Indicator) => {
    setIndicators(prev => { const n = new Set(prev); n.has(ind) ? n.delete(ind) : n.add(ind); return n; });
  }, []);
  const on = useCallback((ind: Indicator) => indicators.has(ind), [indicators]);

  // ─── Measure chart plot area ──────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const measure = () => {
      const el = containerRef.current;
      if (!el) return;
      const svg = el.querySelector("svg.recharts-surface");
      if (!svg) return;
      const svgRect = svg.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const clip = el.querySelector("svg.recharts-surface defs clipPath rect");
      if (clip) {
        const cx = parseFloat(clip.getAttribute("x") || "0");
        const cy = parseFloat(clip.getAttribute("y") || "0");
        const cw = parseFloat(clip.getAttribute("width") || "0");
        const ch = parseFloat(clip.getAttribute("height") || "0");
        if (cw > 0 && ch > 0) {
          setDims({ w: cw, h: ch, l: cx + (svgRect.left - elRect.left), t: cy + (svgRect.top - elRect.top) });
        }
      }
    };
    const t1 = setTimeout(measure, 150);
    const t2 = setTimeout(measure, 400);
    const t3 = setTimeout(measure, 800);
    window.addEventListener("resize", measure);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); window.removeEventListener("resize", measure); };
  }, [data, chartType, indicators, viewStart, viewEnd]);

  // ─── Enriched data (computed on full dataset for indicator lookback) ───────
  const enrichedAll = useMemo(() => {
    if (!data?.length) return [];
    // Sanitize OHLC: clamp bad data where high/low spike far beyond body
    // Step 1: compute median body range to set adaptive wick cap
    const bodyRanges: number[] = [];
    for (const d of data) {
      if (d.close > 0 && d.open > 0) {
        bodyRanges.push(Math.abs(d.close - d.open) / d.close);
      }
    }
    bodyRanges.sort((a, b) => a - b);
    const medianBody = bodyRanges.length > 0 ? bodyRanges[Math.floor(bodyRanges.length / 2)] : 0.02;
    // Max wick = 4x median body range, minimum 5%, maximum 20%
    const wickCap = Math.min(0.20, Math.max(0.05, medianBody * 4));

    const sane = data.map(d => {
      const cl = d.close;
      const bodyTop = Math.max(cl, d.open || cl);
      const bodyBot = Math.min(cl, d.open || cl);
      const maxHigh = bodyTop * (1 + wickCap);
      const minLow = bodyBot * (1 - wickCap);
      return {
        ...d,
        open: (d.open > 0 && d.open > cl * 0.5 && d.open < cl * 2) ? d.open : cl,
        high: (d.high > 0 && d.high >= bodyTop) ? Math.min(d.high, maxHigh) : bodyTop,
        low: (d.low > 0 && d.low <= bodyBot) ? Math.max(d.low, minLow) : bodyBot,
      };
    });
    const c = sane.map(d => d.close);
    const ema20 = calcEMA(c, 20), ema50 = calcEMA(c, 50), ema200 = calcEMA(c, 200);
    const vwap = calcVWAP(sane);
    const bb = calcBB(c);
    const rsi = calcRSI(c);
    return sane.map((d, i) => ({
      ...d,
      ema20: ema20[i], ema50: ema50[i], ema200: ema200[i],
      vwap: vwap[i],
      bbUpper: bb.upper[i], bbMiddle: bb.middle[i], bbLower: bb.lower[i],
      rsi: rsi[i],
    }));
  }, [data]);

  // Visible slice — supports overscroll (viewStart < 0 or viewEnd > total)
  const visibleBars = viewEnd - viewStart;
  const dataStart = Math.max(0, viewStart);
  const dataEnd = Math.min(total, viewEnd);
  const dataOffset = dataStart - viewStart; // empty bars before first data bar
  const enriched = useMemo(() => enrichedAll.slice(dataStart, dataEnd), [enrichedAll, dataStart, dataEnd]);

  // Padded data for Recharts (drives grid/axes across full width including empty space)
  const paddedData = useMemo(() => {
    const result: (typeof enrichedAll[0] | { date: string; close: number | null; open: number; high: number; low: number; volume: number })[] = [];
    for (let i = 0; i < visibleBars; i++) {
      const di = i - dataOffset;
      if (di >= 0 && di < enriched.length) {
        result.push(enriched[di]);
      } else {
        result.push({ date: "", close: null, open: 0, high: 0, low: 0, volume: 0 });
      }
    }
    return result;
  }, [enriched, visibleBars, dataOffset]);

  // Auto chart type based on visible bars
  const effectiveType = typeOverride ?? (visibleBars > 200 ? "line" : "candle");

  // ─── Domains (computed on visible data) ───────────────────────────────────
  const showVol = on("volume");
  const showRSI = on("rsi");

  const [minP, maxP] = useMemo(() => {
    if (!enriched.length) return [0, 100];
    let mn = Infinity, mx = -Infinity;
    for (const d of enriched) {
      if (d.low < mn) mn = d.low;
      if (d.high > mx) mx = d.high;
      if (on("bb")) {
        if (d.bbLower != null && d.bbLower < mn) mn = d.bbLower;
        if (d.bbUpper != null && d.bbUpper > mx) mx = d.bbUpper;
      }
    }
    const pad = (mx - mn) * 0.05;
    const domainMin = showVol ? mn - pad - (mx - mn) * 0.18 : mn - pad;
    return [domainMin + yOffset, mx + pad + yOffset];
  }, [enriched, on, showVol, yOffset]);

  const maxVol = useMemo(() => Math.max(...enriched.map(d => d.volume || 0), 1), [enriched]);

  // ─── Layout ──────────────────────────────────────────────────────────────
  const rsiH = showRSI ? 110 : 0;
  const mainH = height - rsiH;

  // ─── Zoom (scroll wheel) — native listener to allow preventDefault ────────
  // React synthetic onWheel uses passive listeners, so preventDefault() is ignored.
  // We attach a native wheel listener with { passive: false } instead.
  const wheelStateRef = useRef({ viewStart, viewEnd, total, dims });
  wheelStateRef.current = { viewStart, viewEnd, total, dims };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const { viewStart: vs, viewEnd: ve, total: t, dims: d } = wheelStateRef.current;

      const delta = e.deltaY > 0 ? 1 : -1;
      const zoomFactor = 0.15;
      const currentBars = ve - vs;
      const change = Math.max(1, Math.round(currentBars * zoomFactor)) * delta;

      let mouseRatio = 0.5;
      if (d && el) {
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        mouseRatio = Math.max(0, Math.min(1, (mx - d.l) / d.w));
      }

      const leftChange = Math.round(change * mouseRatio);
      const rightChange = change - leftChange;

      let newStart = vs - leftChange;
      let newEnd = ve + rightChange;

      const newBars = newEnd - newStart;
      if (newBars < MIN_BARS) return;
      if (newBars > Math.min(t, MAX_BARS)) {
        const maxB = Math.min(t, MAX_BARS);
        newEnd = newStart + maxB;
      }
      // Allow overscroll on zoom
      const overscroll = Math.floor((newEnd - newStart) * 0.75);
      newStart = Math.max(-overscroll, newStart);
      newEnd = Math.min(t + overscroll, newEnd);
      if (newEnd - newStart < MIN_BARS) return;

      setViewStart(newStart);
      setViewEnd(newEnd);
    };

    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []); // stable — reads state via ref

  // ─── Drag to pan (X + Y) ─────────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, origStart: viewStart, origEnd: viewEnd, origYOffset: yOffset };
  }, [viewStart, viewEnd, yOffset]);

  const panFromDrag = useCallback((clientX: number, clientY: number) => {
    if (!dragRef.current || !dims) return;
    // Horizontal pan — allow overscroll past data edges
    const dx = clientX - dragRef.current.startX;
    const bars = dragRef.current.origEnd - dragRef.current.origStart;
    const barsPerPx = bars / dims.w;
    const barShift = Math.round(-dx * barsPerPx);
    const overscroll = Math.floor(bars * 0.75);
    let newStart = dragRef.current.origStart + barShift;
    let newEnd = dragRef.current.origEnd + barShift;
    // Clamp: allow up to 75% empty space on either side
    if (newStart < -overscroll) { newStart = -overscroll; newEnd = newStart + bars; }
    if (newEnd > total + overscroll) { newEnd = total + overscroll; newStart = newEnd - bars; }
    setViewStart(newStart);
    setViewEnd(newEnd);

    // Vertical pan — dragging up shifts prices down (reveals higher prices)
    const dy = clientY - dragRef.current.startY;
    const pricePerPx = (maxP - minP) / dims.h;
    const priceShift = dy * pricePerPx;
    setYOffset(dragRef.current.origYOffset + priceShift);
  }, [dims, total, maxP, minP]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (dragRef.current && dims) {
      panFromDrag(e.clientX, e.clientY);
      return;
    }
    // Normal crosshair — account for data offset in overscroll
    if (!dims || !enriched.length) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    if (x < dims.l || x > dims.l + dims.w) { setHoverIdx(null); return; }
    const gap = dims.w / visibleBars;
    const visIdx = Math.floor((x - dims.l) / gap);
    const dataIdx = visIdx - dataOffset;
    if (dataIdx >= 0 && dataIdx < enriched.length) {
      setHoverIdx(dataIdx);
    } else {
      setHoverIdx(null);
    }
  }, [dims, enriched, visibleBars, dataOffset, panFromDrag]);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // ─── Touch support for mobile ──────────────────────────────────────────────
  const touchStateRef = useRef({ viewStart, viewEnd, yOffset, dims, total, maxP, minP });
  touchStateRef.current = { viewStart, viewEnd, yOffset, dims, total, maxP, minP };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const st = touchStateRef.current;
      dragRef.current = { startX: t.clientX, startY: t.clientY, origStart: st.viewStart, origEnd: st.viewEnd, origYOffset: st.yOffset };
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!dragRef.current || e.touches.length !== 1) return;
      e.preventDefault(); // prevent page scroll while dragging chart
      const t = e.touches[0];
      const st = touchStateRef.current;
      const d = st.dims;
      if (!d) return;

      // Horizontal pan — allow overscroll
      const dx = t.clientX - dragRef.current.startX;
      const bars = dragRef.current.origEnd - dragRef.current.origStart;
      const barsPerPx = bars / d.w;
      const barShift = Math.round(-dx * barsPerPx);
      const overscroll = Math.floor(bars * 0.75);
      let newStart = dragRef.current.origStart + barShift;
      let newEnd = dragRef.current.origEnd + barShift;
      if (newStart < -overscroll) { newStart = -overscroll; newEnd = newStart + bars; }
      if (newEnd > st.total + overscroll) { newEnd = st.total + overscroll; newStart = newEnd - bars; }
      setViewStart(newStart);
      setViewEnd(newEnd);

      // Vertical pan
      const dy = t.clientY - dragRef.current.startY;
      const priceRange = st.maxP - st.minP;
      const pricePerPx = priceRange / d.h;
      setYOffset(dragRef.current.origYOffset + dy * pricePerPx);
    };

    const handleTouchEnd = () => {
      dragRef.current = null;
    };

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd);
    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
    };
  }, []);

  // ─── Reset zoom button ───────────────────────────────────────────────────
  const isZoomed = viewStart !== Math.max(0, total - defaultBars) || viewEnd !== total || yOffset !== 0;
  const resetView = useCallback(() => {
    const bars = initialBars ? Math.min(initialBars, total) : total;
    setViewStart(Math.max(0, total - bars));
    setViewEnd(total);
    setYOffset(0);
  }, [total, initialBars]);

  if (!data?.length) {
    return <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: DIM }}>No data</div>;
  }

  const hd = hoverIdx != null ? enriched[hoverIdx] : enriched[enriched.length - 1];
  const lastC = enriched[enriched.length - 1]?.close;
  const prevC = enriched.length > 1 ? enriched[enriched.length - 2]?.close : lastC;

  // ─── SVG overlay ──────────────────────────────────────────────────────────
  const renderOverlay = () => {
    if (!dims || !enriched.length) return null;
    const { w, h: ch, l, t } = dims;
    const gap = w / visibleBars;
    const candleW = Math.max(Math.min(gap * 0.65, 10), 1);
    const priceRange = maxP - minP;
    const yS = (p: number) => t + ch * (1 - (p - minP) / priceRange);
    // xC maps data index → pixel position, accounting for overscroll offset
    const xC = (i: number) => l + (dataOffset + i + 0.5) * gap;

    const linePath = (values: (number | null)[]) => {
      let d = "";
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v == null) continue;
        d += `${d === "" ? "M" : "L"} ${xC(i)} ${yS(v)} `;
      }
      return d;
    };

    return (
      <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
        {/* BB fill */}
        {on("bb") && (() => {
          const pts: string[] = [], bot: string[] = [];
          enriched.forEach((d, i) => {
            if (d.bbUpper != null && d.bbLower != null) {
              const x = xC(i);
              pts.push(`${pts.length === 0 ? "M" : "L"} ${x} ${yS(d.bbUpper)}`);
              bot.unshift(`L ${x} ${yS(d.bbLower)}`);
            }
          });
          if (pts.length < 2) return null;
          return <path d={`${pts.join(" ")} ${bot.join(" ")} Z`} fill={BB_COLOR} fillOpacity={0.06} />;
        })()}

        {/* BB lines */}
        {on("bb") && (
          <>
            <path d={linePath(enriched.map(d => d.bbUpper))} fill="none" stroke={BB_COLOR} strokeWidth={1} strokeDasharray="3 2" />
            <path d={linePath(enriched.map(d => d.bbMiddle))} fill="none" stroke={BB_COLOR} strokeWidth={1} opacity={0.4} />
            <path d={linePath(enriched.map(d => d.bbLower))} fill="none" stroke={BB_COLOR} strokeWidth={1} strokeDasharray="3 2" />
          </>
        )}

        {on("ema20") && <path d={linePath(enriched.map(d => d.ema20))} fill="none" stroke={EMA20} strokeWidth={1} />}
        {on("ema50") && <path d={linePath(enriched.map(d => d.ema50))} fill="none" stroke={EMA50} strokeWidth={1} />}
        {on("ema200") && <path d={linePath(enriched.map(d => d.ema200))} fill="none" stroke={EMA200} strokeWidth={1} />}
        {on("vwap") && <path d={linePath(enriched.map(d => d.vwap))} fill="none" stroke={VWAP_COLOR} strokeWidth={1} strokeDasharray="4 2" />}
        {effectiveType === "line" && <path d={linePath(enriched.map(d => d.close))} fill="none" stroke={BRIGHT} strokeWidth={1.5} />}

        {/* Volume bars */}
        {showVol && enriched.map((d, i) => {
          const volFrac = d.volume / maxVol;
          const barH = ch * 0.14 * volFrac;
          if (barH < 1) return null;
          const x = xC(i) - candleW / 2;
          return <rect key={`v${i}`} x={x} y={t + ch - barH} width={candleW} height={barH} fill={d.close >= d.open ? BULL : BEAR} fillOpacity={0.3} />;
        })}

        {/* Candles */}
        {effectiveType === "candle" && enriched.map((d, i) => {
          const cx = xC(i);
          const isUp = d.close >= d.open;
          const color = isUp ? BULL : BEAR;
          const yH = yS(d.high), yL = yS(d.low), yO = yS(d.open), yC = yS(d.close);
          const bodyTop = Math.min(yO, yC), bodyBot = Math.max(yO, yC);
          const bodyH = Math.max(bodyBot - bodyTop, 1);
          return (
            <g key={`c${i}`}>
              <line x1={cx} y1={yH} x2={cx} y2={bodyTop} stroke={color} strokeWidth={1} />
              <line x1={cx} y1={bodyBot} x2={cx} y2={yL} stroke={color} strokeWidth={1} />
              <rect x={cx - candleW / 2} y={bodyTop} width={candleW} height={bodyH}
                fill={isUp ? "transparent" : color} stroke={color} strokeWidth={1} />
            </g>
          );
        })}

        {/* Crosshair */}
        {hoverIdx != null && !dragRef.current && (() => {
          const d = enriched[hoverIdx];
          if (!d) return null;
          const cx = xC(hoverIdx);
          const py = yS(d.close);
          return (
            <g>
              <line x1={cx} y1={t} x2={cx} y2={t + ch} stroke="rgba(255,255,255,0.2)" strokeWidth={1} strokeDasharray="4 2" />
              <line x1={l} y1={py} x2={l + w} y2={py} stroke="rgba(255,255,255,0.2)" strokeWidth={1} strokeDasharray="4 2" />
              <rect x={l + w + 2} y={py - 10} width={54} height={20} fill="#2962ff" rx={2} opacity={0.9} />
              <text x={l + w + 29} y={py + 4} fill="white" fontSize={10} fontFamily="monospace" textAnchor="middle" fontWeight={600}>
                {fmtP(d.close)}
              </text>
            </g>
          );
        })()}
      </svg>
    );
  };

  // ─── Button ──────────────────────────────────────────────────────────────
  const Btn = ({ ind, label, color }: { ind: Indicator; label: string; color?: string }) => {
    const a = on(ind);
    return (
      <button onClick={() => toggle(ind)} style={{
        padding: "2px 8px", borderRadius: 3,
        border: `1px solid ${a ? (color || "#3b82f6") : "rgba(255,255,255,0.1)"}`,
        background: a ? `${color || "#3b82f6"}15` : "transparent",
        color: a ? (color || "#3b82f6") : DIM,
        fontSize: 10, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
        letterSpacing: "0.02em", lineHeight: "18px", transition: "all 0.15s",
      }}>{label}</button>
    );
  };

  return (
    <div style={{ width: "100%", fontFamily: "'SF Mono','Cascadia Code','Fira Code',monospace" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, gap: 6, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 1 }}>
            {(["line", "candle"] as const).map(ct => (
              <button key={ct} onClick={() => setTypeOverride(ct)} style={{
                padding: "2px 10px",
                borderRadius: ct === "line" ? "3px 0 0 3px" : "0 3px 3px 0",
                border: "1px solid rgba(255,255,255,0.1)",
                borderLeft: ct === "candle" ? "none" : undefined,
                background: chartType === ct ? "rgba(255,255,255,0.1)" : "transparent",
                color: chartType === ct ? BRIGHT : DIM,
                fontSize: 10, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                letterSpacing: "0.02em", lineHeight: "18px",
              }}>{ct === "line" ? "LINE" : "CANDLE"}</button>
            ))}
          </div>
          {isZoomed && (
            <button onClick={resetView} style={{
              padding: "2px 8px", borderRadius: 3,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.05)",
              color: MID, fontSize: 9, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
            }}>RESET</button>
          )}
          <span style={{ fontSize: 8, color: DIM, opacity: 0.6 }}>
            {enriched.length > 0 ? `${enriched[0]?.date?.slice(5)} — ${enriched[enriched.length - 1]?.date?.slice(5)}` : ""}
            {` (${enriched.length}d)`}
          </span>
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <Btn ind="ema20" label="EMA 20" color={EMA20} />
          <Btn ind="ema50" label="EMA 50" color={EMA50} />
          <Btn ind="ema200" label="EMA 200" color={EMA200} />
          <Btn ind="vwap" label="VWAP" color={VWAP_COLOR} />
          <Btn ind="bb" label="BB" color={BB_COLOR} />
          <Btn ind="volume" label="VOL" />
          <Btn ind="rsi" label="RSI" color={RSI_COLOR} />
        </div>
      </div>

      {/* ═══ Main Chart ═══ */}
      <div
        ref={containerRef}
        style={{ position: "relative", width: "100%", height: mainH, cursor: dragRef.current ? "grabbing" : "crosshair", userSelect: "none" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { setHoverIdx(null); dragRef.current = null; }}
      >
        {/* Info Box */}
        <div style={{
          position: "absolute", top: 8, left: 8, zIndex: 10, pointerEvents: "none",
          background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)",
          borderRadius: 4, padding: "6px 10px", fontSize: 10, lineHeight: "16px", minWidth: 180,
        }}>
          <div style={{ color: DIM, marginBottom: 2, fontSize: 9 }}>{hd?.date || ""}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span style={{ color: DIM }}>O <span style={{ color: BRIGHT }}>{hd ? fmtP(hd.open) : "—"}</span></span>
            <span style={{ color: DIM }}>H <span style={{ color: BRIGHT }}>{hd ? fmtP(hd.high) : "—"}</span></span>
            <span style={{ color: DIM }}>L <span style={{ color: BRIGHT }}>{hd ? fmtP(hd.low) : "—"}</span></span>
            <span style={{ color: DIM }}>C <span style={{ color: hd && hd.close >= hd.open ? BULL : BEAR, fontWeight: 700 }}>{hd ? fmtP(hd.close) : "—"}</span></span>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 1, flexWrap: "wrap" }}>
            <span style={{ color: DIM }}>Vol <span style={{ color: MID }}>{hd ? fmtVol(hd.volume) : "—"}</span></span>
            {hd && hd.close !== hd.open && (
              <span style={{ color: hd.close >= hd.open ? BULL : BEAR, fontWeight: 700 }}>
                {hd.close >= hd.open ? "+" : ""}{(((hd.close - hd.open) / hd.open) * 100).toFixed(2)}%
              </span>
            )}
          </div>
          {hd && (
            <div style={{ display: "flex", gap: 8, marginTop: 3, flexWrap: "wrap", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 3 }}>
              {on("ema20") && hd.ema20 != null && <span style={{ color: EMA20, fontSize: 9 }}>EMA20 {fmtP(hd.ema20!)}</span>}
              {on("ema50") && hd.ema50 != null && <span style={{ color: EMA50, fontSize: 9 }}>EMA50 {fmtP(hd.ema50!)}</span>}
              {on("ema200") && hd.ema200 != null && <span style={{ color: EMA200, fontSize: 9 }}>EMA200 {fmtP(hd.ema200!)}</span>}
              {on("vwap") && hd.vwap != null && <span style={{ color: VWAP_COLOR, fontSize: 9 }}>VWAP {fmtP(hd.vwap!)}</span>}
              {on("bb") && hd.bbUpper != null && <span style={{ color: BB_COLOR, fontSize: 9 }}>BB {fmtP(hd.bbLower!)}–{fmtP(hd.bbUpper!)}</span>}
              {on("rsi") && hd.rsi != null && (
                <span style={{ color: hd.rsi > 70 ? BEAR : hd.rsi < 30 ? BULL : RSI_COLOR, fontSize: 9, fontWeight: 700 }}>RSI {hd.rsi.toFixed(1)}</span>
              )}
            </div>
          )}
        </div>

        {/* Recharts base (grid + axes only) */}
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={paddedData} margin={MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="date" stroke={DIM} fontSize={9} tickFormatter={fmtDate} minTickGap={60} tickMargin={4} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} tickLine={false} />
            <YAxis stroke={DIM} fontSize={9} domain={[minP, maxP]} tickFormatter={fmtP} width={55} orientation="right" axisLine={false} tickLine={false} tickCount={8} />
            <Line type="monotone" dataKey="close" stroke="transparent" strokeWidth={0} dot={false} activeDot={false} isAnimationActive={false} />
            {lastC && <ReferenceLine y={lastC} stroke={lastC >= (prevC || 0) ? BULL : BEAR} strokeDasharray="2 4" strokeWidth={1} strokeOpacity={0.4} />}
          </ComposedChart>
        </ResponsiveContainer>

        {renderOverlay()}
      </div>

      {/* ═══ RSI — SVG rendered, synced with main chart ═══ */}
      {showRSI && dims && enriched.length > 0 && (() => {
        const { w, l } = dims;
        const n = enriched.length;
        const gap = w / visibleBars;
        const xC = (i: number) => l + (dataOffset + i + 0.5) * gap;
        const rsiPad = 6; // top/bottom padding in px
        const rsiChartH = rsiH - 24; // subtract label row height
        const yR = (v: number) => rsiPad + (rsiChartH - 2 * rsiPad) * (1 - v / 100);
        const rightEdge = l + w;
        const axisX = rightEdge + 4;

        // Build RSI line path
        let rsiPath = "";
        let rsiAreaPath = "";
        let firstPt = "";
        let lastX = 0;
        for (let i = 0; i < n; i++) {
          const v = enriched[i].rsi;
          if (v == null) continue;
          const x = xC(i);
          const y = yR(v);
          if (rsiPath === "") {
            rsiPath = `M ${x} ${y}`;
            firstPt = `${x}`;
          } else {
            rsiPath += ` L ${x} ${y}`;
          }
          lastX = x;
        }
        // Area fill path (line + close along bottom at 50 line)
        const y50 = yR(50);
        rsiAreaPath = `${rsiPath} L ${lastX} ${y50} L ${parseFloat(firstPt)} ${y50} Z`;

        // Hover data
        const hoverRsi = hoverIdx != null ? enriched[hoverIdx]?.rsi : enriched[n - 1]?.rsi;
        const rsiColor = hoverRsi != null ? (hoverRsi > 70 ? BEAR : hoverRsi < 30 ? BULL : BRIGHT) : BRIGHT;

        return (
          <div style={{ width: "100%", height: rsiH, borderTop: "1px solid rgba(255,255,255,0.08)", position: "relative" }}>
            {/* Label row */}
            <div style={{ fontSize: 9, color: DIM, padding: "3px 8px 0", display: "flex", alignItems: "center", gap: 6, height: 18 }}>
              <span style={{ fontWeight: 700, letterSpacing: "0.04em" }}>RSI(14)</span>
              {hoverRsi != null && (
                <span style={{ fontSize: 12, color: rsiColor, fontWeight: 700 }}>{hoverRsi.toFixed(1)}</span>
              )}
              <span style={{ fontSize: 8, color: DIM, opacity: 0.4 }}>70 overbought · 30 oversold</span>
            </div>
            <svg width="100%" height={rsiChartH} style={{ display: "block" }}>
              {/* Overbought/oversold zones */}
              <rect x={l} y={yR(100)} width={w} height={yR(70) - yR(100)} fill="rgba(239,83,80,0.04)" />
              <rect x={l} y={yR(30)} width={w} height={yR(0) - yR(30)} fill="rgba(38,166,154,0.04)" />

              {/* Grid lines at 30, 50, 70 */}
              <line x1={l} y1={yR(70)} x2={rightEdge} y2={yR(70)} stroke="rgba(239,83,80,0.25)" strokeWidth={0.5} strokeDasharray="3 2" />
              <line x1={l} y1={yR(50)} x2={rightEdge} y2={yR(50)} stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} strokeDasharray="2 4" />
              <line x1={l} y1={yR(30)} x2={rightEdge} y2={yR(30)} stroke="rgba(38,166,154,0.25)" strokeWidth={0.5} strokeDasharray="3 2" />

              {/* Y-axis labels */}
              <text x={axisX} y={yR(70) + 3} fill={DIM} fontSize={9} fontFamily="inherit">70</text>
              <text x={axisX} y={yR(50) + 3} fill={DIM} fontSize={9} fontFamily="inherit">50</text>
              <text x={axisX} y={yR(30) + 3} fill={DIM} fontSize={9} fontFamily="inherit">30</text>

              {/* RSI area fill */}
              {rsiPath && <path d={rsiAreaPath} fill={RSI_COLOR} fillOpacity={0.06} />}

              {/* RSI line */}
              {rsiPath && <path d={rsiPath} fill="none" stroke={RSI_COLOR} strokeWidth={1.5} />}

              {/* Crosshair vertical line + value label */}
              {hoverIdx != null && !dragRef.current && (() => {
                const d = enriched[hoverIdx];
                if (!d || d.rsi == null) return null;
                const cx = xC(hoverIdx);
                const ry = yR(d.rsi);
                const dotColor = d.rsi > 70 ? BEAR : d.rsi < 30 ? BULL : RSI_COLOR;
                return (
                  <g>
                    <line x1={cx} y1={0} x2={cx} y2={rsiChartH} stroke="rgba(255,255,255,0.2)" strokeWidth={1} strokeDasharray="4 2" />
                    <circle cx={cx} cy={ry} r={3} fill={dotColor} stroke="#111" strokeWidth={1} />
                    {/* Value badge on right axis */}
                    <rect x={rightEdge + 2} y={ry - 8} width={28} height={16} fill={dotColor} rx={2} opacity={0.85} />
                    <text x={rightEdge + 16} y={ry + 4} fill="white" fontSize={9} fontFamily="monospace" textAnchor="middle" fontWeight={600}>
                      {d.rsi.toFixed(0)}
                    </text>
                  </g>
                );
              })()}
            </svg>
          </div>
        );
      })()}
    </div>
  );
}
