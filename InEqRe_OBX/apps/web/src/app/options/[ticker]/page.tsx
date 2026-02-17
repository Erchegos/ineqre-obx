"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Label, Legend, ComposedChart,
} from "recharts";
import { useParams } from "next/navigation";
import {
  generateMultiTimePayoff,
  calculateBreakeven,
  calculateMaxProfitLoss,
  daysToExpiry,
  formatExpiry,
  blackScholes,
  type OptionPosition,
  type MultiTimePayoffPoint,
} from "@/lib/options";

// ─── Types ───────────────────────────────────────────────────────
interface OptionData {
  strike: number;
  right: "call" | "put";
  bid: number;
  ask: number;
  last: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  openInterest: number;
  volume: number;
  undPrice: number;
}

interface ChainRow {
  strike: number;
  call: Partial<OptionData> | null;
  put: Partial<OptionData> | null;
}

interface OIData {
  strike: number;
  callOI: number;
  putOI: number;
  callVolume: number;
  putVolume: number;
}

interface OptionsResponse {
  symbol: string;
  underlyingPrice: number;
  currency: string;
  selectedExpiry: string;
  expirations: string[];
  strikes: number[];
  multiplier: number;
  chain: ChainRow[];
  ivTermStructure: { expiry: string; daysToExpiry: number; atmIV: number | null }[];
  oiDistribution: OIData[];
  putCallRatio: number;
  putCallVolumeRatio: number;
  totalPutOI: number;
  totalCallOI: number;
  totalPutVolume: number;
  totalCallVolume: number;
  maxPain: { strike: number; value: number };
  aggregateGreeks: {
    totalCallDelta: number;
    totalPutDelta: number;
    totalGamma: number;
    totalVega: number;
    totalTheta: number;
  };
  dataType: string;
  lastUpdated: string;
}

// ─── Component ───────────────────────────────────────────────────
export default function OptionsPage() {
  const params = useParams();
  const rawTicker = (params.ticker as string)?.toUpperCase() || "EQNR";
  // Options API stores tickers without .US suffix (e.g. EQNR not EQNR.US)
  const ticker = rawTicker.endsWith(".US") ? rawTicker.replace(".US", "") : rawTicker;

  const [data, setData] = useState<OptionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedExpiry, setSelectedExpiry] = useState<string>("");
  const [positions, setPositions] = useState<OptionPosition[]>([]);
  const [calcType, setCalcType] = useState<"call" | "put">("call");
  const [calcStrike, setCalcStrike] = useState<number>(0);
  const [calcPremium, setCalcPremium] = useState<number>(0);
  const [calcQty, setCalcQty] = useState<number>(1);
  const [calcSide, setCalcSide] = useState<"long" | "short">("long");
  const [showGreeks, setShowGreeks] = useState(true);
  const [chainFilter, setChainFilter] = useState<"all" | "itm" | "otm" | "near">("near");
  const [strategyQty, setStrategyQty] = useState<number>(10);
  const [activeStrategy, setActiveStrategy] = useState<string | null>(null);

  // ─── Data Fetching ──────────────────────────────────────────
  const fetchData = useCallback(async (expiry?: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/options/${ticker}${expiry ? `?expiry=${expiry}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const result: OptionsResponse = await res.json();
      setData(result);
      if (!selectedExpiry && result.selectedExpiry) {
        setSelectedExpiry(result.selectedExpiry);
      }
      if (result.underlyingPrice && calcStrike === 0) {
        const atm = result.strikes.reduce((c, s) =>
          Math.abs(s - result.underlyingPrice) < Math.abs(c - result.underlyingPrice) ? s : c
        , result.strikes[0]);
        setCalcStrike(atm);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [ticker, selectedExpiry, calcStrike]);

  useEffect(() => {
    fetchData();
  }, []);// eslint-disable-line react-hooks/exhaustive-deps

  // Auto-load bull call spread when data first arrives
  useEffect(() => {
    if (data && data.chain.length > 0 && positions.length === 0) {
      buildStrategy("bull_call");
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleExpiryChange = (expiry: string) => {
    setSelectedExpiry(expiry);
    fetchData(expiry);
  };

  // ─── Filtered Chain ───────────────────────────────────────────
  const filteredChain = useMemo(() => {
    if (!data) return [];
    const chain = data.chain;
    const price = data.underlyingPrice;
    if (chainFilter === "all") return chain;
    if (chainFilter === "itm") {
      return chain.filter(r => {
        const callItm = price > r.strike;
        const putItm = price < r.strike;
        return callItm || putItm;
      });
    }
    if (chainFilter === "otm") {
      return chain.filter(r => {
        const callOtm = price < r.strike;
        const putOtm = price > r.strike;
        return callOtm || putOtm;
      });
    }
    return chain.filter(r => Math.abs(r.strike - price) / price < 0.3);
  }, [data, chainFilter]);

  // ─── Derived Data ─────────────────────────────────────────────
  const ivSkewData = useMemo(() => {
    if (!data) return [];
    return data.chain
      .filter(r => r.call?.iv || r.put?.iv)
      .map(r => ({
        strike: r.strike,
        callIV: r.call?.iv ? r.call.iv * 100 : null,
        putIV: r.put?.iv ? r.put.iv * 100 : null,
      }));
  }, [data]);

  const volumeData = useMemo(() => {
    if (!data) return [];
    return data.oiDistribution.filter(d => d.callVolume > 0 || d.putVolume > 0 || d.callOI > 0 || d.putOI > 0);
  }, [data]);

  const greeksData = useMemo(() => {
    if (!data) return [];
    return data.chain
      .filter(r => r.call?.delta || r.put?.delta)
      .map(r => ({
        strike: r.strike,
        callDelta: r.call?.delta ? Math.abs(r.call.delta) : null,
        putDelta: r.put?.delta ? Math.abs(r.put.delta) : null,
        gamma: r.call?.gamma || r.put?.gamma || null,
      }));
  }, [data]);

  // ─── Calculator ─────────────────────────────────────────────
  const addPosition = () => {
    if (calcStrike <= 0 || calcPremium < 0) return;
    const newPos: OptionPosition = {
      type: calcType,
      strike: calcStrike,
      premium: calcPremium,
      quantity: calcSide === "long" ? calcQty : -calcQty,
      expiry: selectedExpiry || "",
    };
    setPositions(prev => [...prev, newPos]);
  };

  const removePosition = (index: number) => {
    setPositions(prev => prev.filter((_, i) => i !== index));
  };

  const clearPositions = () => { setPositions([]); setActiveStrategy(null); };

  const addFromChain = (strike: number, type: "call" | "put", side: "long" | "short") => {
    const row = data?.chain.find(r => r.strike === strike);
    const opt = type === "call" ? row?.call : row?.put;
    if (!opt) return;
    const premium = side === "long"
      ? (opt.ask || opt.last || opt.bid || 0)
      : (opt.bid || opt.last || 0);
    const newPos: OptionPosition = {
      type,
      strike,
      premium,
      quantity: side === "long" ? 1 : -1,
      expiry: selectedExpiry || "",
      iv: opt.iv || undefined,
    };
    setPositions(prev => [...prev, newPos]);
  };

  const multiTimeData = useMemo((): MultiTimePayoffPoint[] => {
    if (positions.length === 0) return [];
    const currentPrice = data?.underlyingPrice || positions[0].strike;
    const totalDTE = selectedExpiry ? daysToExpiry(selectedExpiry) : 30;
    return generateMultiTimePayoff(positions, currentPrice, totalDTE, 0.04, 0.4);
  }, [positions, data?.underlyingPrice, selectedExpiry]);

  // Per-contract normalization factor (max absolute qty across legs)
  const greeksNorm = useMemo(() => {
    if (positions.length === 0) return 1;
    return Math.max(...positions.map(p => Math.abs(p.quantity)), 1);
  }, [positions]);

  const portfolioGreeks = useMemo(() => {
    if (positions.length === 0 || !data) return null;
    const curDte = selectedExpiry ? daysToExpiry(selectedExpiry) : 30;
    const T = Math.max(curDte, 1) / 365;
    let delta = 0, gamma = 0, theta = 0, vega = 0;
    for (const pos of positions) {
      const iv = pos.iv || 0.3;
      const bs = blackScholes(pos.type, data.underlyingPrice, pos.strike, T, 0.04, iv);
      delta += bs.delta * pos.quantity;
      gamma += bs.gamma * pos.quantity;
      theta += bs.theta * pos.quantity * 100;
      vega += bs.vega * pos.quantity;
    }
    // Normalize to per-contract values
    const n = greeksNorm;
    return {
      delta: Math.round((delta / n) * 1000) / 1000,
      gamma: Math.round((gamma / n) * 10000) / 10000,
      theta: Math.round((theta / n) * 100) / 100,
      vega: Math.round((vega / n) * 1000) / 1000,
    };
  }, [positions, data, selectedExpiry, greeksNorm]);

  const buildStrategy = (name: string, qty?: number) => {
    if (!data || data.chain.length === 0) return;
    const q = qty || strategyQty;
    const chain = data.chain;
    const price = data.underlyingPrice;
    const atm = chain.reduce((c, r) =>
      Math.abs(r.strike - price) < Math.abs(c.strike - price) ? r : c
    , chain[0]);
    const atmIdx = chain.findIndex(r => r.strike === atm.strike);
    const up1 = chain[Math.min(atmIdx + 1, chain.length - 1)];
    const up2 = chain[Math.min(atmIdx + 2, chain.length - 1)];
    const down1 = chain[Math.max(atmIdx - 1, 0)];
    const down2 = chain[Math.max(atmIdx - 2, 0)];

    const mk = (row: ChainRow, type: "call" | "put", side: "long" | "short", legQty = q): OptionPosition | null => {
      const opt = type === "call" ? row.call : row.put;
      if (!opt) return null;
      const prem = side === "long" ? (opt.ask || opt.last || opt.bid || 0) : (opt.bid || opt.last || 0);
      return { type, strike: row.strike, premium: prem, quantity: side === "long" ? legQty : -legQty, expiry: selectedExpiry || "", iv: opt.iv || undefined };
    };

    let legs: (OptionPosition | null)[] = [];
    switch (name) {
      case "bull_call": legs = [mk(atm, "call", "long"), mk(up1, "call", "short")]; break;
      case "bear_put": legs = [mk(atm, "put", "long"), mk(down1, "put", "short")]; break;
      case "straddle": legs = [mk(atm, "call", "long"), mk(atm, "put", "long")]; break;
      case "strangle": legs = [mk(up1, "call", "long"), mk(down1, "put", "long")]; break;
      case "iron_condor": legs = [mk(down1, "put", "short"), mk(down2, "put", "long"), mk(up1, "call", "short"), mk(up2, "call", "long")]; break;
      case "butterfly": {
        const opt = atm.call;
        const body: OptionPosition | null = opt ? { type: "call" as const, strike: atm.strike, premium: opt.bid || opt.last || 0, quantity: -2 * q, expiry: selectedExpiry || "", iv: opt.iv || undefined } : null;
        legs = [mk(down1, "call", "long"), body, mk(up1, "call", "long")];
        break;
      }
    }
    setPositions(legs.filter((l): l is OptionPosition => l !== null));
    setActiveStrategy(name);
  };

  const breakevens = useMemo(() => {
    if (positions.length === 0) return [];
    return calculateBreakeven(positions);
  }, [positions]);

  const maxProfitLoss = useMemo(() => {
    if (positions.length === 0) return { maxProfit: 0, maxLoss: 0 };
    return calculateMaxProfitLoss(positions);
  }, [positions]);

  const totalCost = useMemo(() => {
    return positions.reduce((sum, p) => sum + p.premium * p.quantity * 100, 0);
  }, [positions]);

  // ─── Loading State ────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div style={{ minHeight: "100vh", background: "#0a0a0f", color: "#e5e5e5" }}>
        <header style={{ borderBottom: "1px solid #1e1e2e", padding: "12px 24px" }}>
          <div style={{ maxWidth: 1800, margin: "0 auto" }}>
            <Link href="/options" style={{ color: "#666", fontSize: 11, textDecoration: "none", fontFamily: "monospace" }}>
              OPTIONS / ASSET LIST
            </Link>
            <h1 style={{ fontSize: 16, fontWeight: 700, marginTop: 4, fontFamily: "monospace", letterSpacing: "0.02em" }}>{ticker} OPTIONS</h1>
          </div>
        </header>
        <main style={{ maxWidth: 1800, margin: "0 auto", padding: 24 }}>
          <div style={{ ...panel, textAlign: "center", padding: 48 }}>
            <div style={{ width: 200, height: 2, background: "#1e1e2e", margin: "0 auto", overflow: "hidden" }}>
              <div style={{ width: "40%", height: "100%", background: "#3b82f6", animation: "load 1.2s ease-in-out infinite" }} />
            </div>
            <div style={{ fontSize: 11, color: "#666", marginTop: 10, fontFamily: "monospace" }}>LOADING OPTIONS DATA...</div>
          </div>
        </main>
        <style>{`@keyframes load { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }`}</style>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div style={{ minHeight: "100vh", background: "#0a0a0f", color: "#e5e5e5", padding: 24 }}>
        <div style={{ maxWidth: 1800, margin: "0 auto" }}>
          <Link href="/options" style={{ color: "#666", fontSize: 11, textDecoration: "none", fontFamily: "monospace" }}>OPTIONS / ASSET LIST</Link>
          <h1 style={{ fontSize: 16, fontWeight: 700, marginTop: 8, marginBottom: 16, fontFamily: "monospace" }}>{ticker} OPTIONS</h1>
          <div style={{ ...panel, borderColor: "#7f1d1d" }}>
            <div style={{ color: "#ef4444", fontWeight: 700, fontSize: 12, marginBottom: 6, fontFamily: "monospace" }}>ERROR</div>
            <div style={{ color: "#fca5a5", fontSize: 12 }}>{error}</div>
          </div>
        </div>
      </div>
    );
  }

  const chain = filteredChain;
  const underlyingPrice = data?.underlyingPrice || 0;
  const oiData = data?.oiDistribution || [];
  const dte = selectedExpiry ? daysToExpiry(selectedExpiry) : 0;

  const atmStrike = data?.strikes?.reduce((c, s) =>
    Math.abs(s - underlyingPrice) < Math.abs(c - underlyingPrice) ? s : c
  , data?.strikes[0] || 0) || 0;
  // Find ATM IV using valid IV from nearest strikes (Yahoo often has garbage at exact ATM)
  const findValidAtmIV = (type: "call" | "put"): number => {
    if (!data) return 0;
    // Sort chain by distance from ATM and find first valid IV
    const sorted = [...data.chain].sort((a, b) => Math.abs(a.strike - underlyingPrice) - Math.abs(b.strike - underlyingPrice));
    for (const row of sorted) {
      const opt = type === "call" ? row.call : row.put;
      const iv = opt?.iv;
      if (isValidIV(iv)) return iv;
    }
    return 0;
  };
  const atmCallIV = findValidAtmIV("call");
  const atmPutIV = findValidAtmIV("put");
  const atmIV = atmCallIV && atmPutIV ? (atmCallIV + atmPutIV) / 2 : (atmCallIV || atmPutIV || 0);

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", color: "#e5e5e5", fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {/* ═══ HEADER ═══ */}
      <header style={{ borderBottom: "1px solid #1e1e2e", padding: "10px 24px", background: "#0d0d14" }}>
        <div style={{ maxWidth: 1800, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <Link href="/options" style={{ color: "#555", textDecoration: "none", fontSize: 16, lineHeight: 1, padding: "6px 10px", border: "1px solid #1e1e2e", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center" }} title="Back to Options">
              &larr;
            </Link>
            <div>
              <Link href="/options" style={{ color: "#555", fontSize: 10, textDecoration: "none", fontFamily: "monospace", letterSpacing: "0.05em" }}>
                OPTIONS
              </Link>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 2 }}>
                <span style={{ fontSize: 20, fontWeight: 800, fontFamily: "monospace", letterSpacing: "0.02em" }}>
                  {data?.symbol || ticker}
                </span>
                <span style={{ fontSize: 24, fontWeight: 700, color: "#22c55e", fontFamily: "monospace" }}>
                  {underlyingPrice.toFixed(2)}
                </span>
                <span style={{ fontSize: 11, color: "#666", fontFamily: "monospace" }}>{data?.currency || "USD"}</span>
              </div>
            </div>
            <div style={{ height: 32, width: 1, background: "#1e1e2e" }} />
            <div style={{ display: "flex", gap: 20, fontSize: 11, fontFamily: "monospace" }}>
              <div>
                <span style={{ color: "#555" }}>ATM IV </span>
                <span style={{ color: "#a78bfa", fontWeight: 700 }}>{atmIV ? (atmIV * 100).toFixed(1) + "%" : "--"}</span>
              </div>
              <div>
                <span style={{ color: "#555" }}>DTE </span>
                <span style={{ fontWeight: 700 }}>{dte}</span>
              </div>
              <div>
                <span style={{ color: "#555" }}>MAX PAIN </span>
                <span style={{ color: "#eab308", fontWeight: 700 }}>{data?.maxPain ? data.maxPain.strike.toFixed(0) : "--"}</span>
              </div>
              <div>
                <span style={{ color: "#555" }}>P/C OI </span>
                <span style={{ color: (data?.putCallRatio || 0) > 1 ? "#ef4444" : "#22c55e", fontWeight: 700 }}>
                  {data?.putCallRatio?.toFixed(2) || "--"}
                </span>
              </div>
              <div>
                <span style={{ color: "#555" }}>P/C VOL </span>
                <span style={{ fontWeight: 700 }}>{data?.putCallVolumeRatio?.toFixed(2) || "--"}</span>
              </div>
            </div>
          </div>
          <div style={{ fontSize: 10, color: "#444", fontFamily: "monospace", textAlign: "right" }}>
            {data?.lastUpdated && <div>UPD {new Date(data.lastUpdated).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).toUpperCase()}</div>}
            {loading && <div style={{ color: "#eab308" }}>REFRESHING...</div>}
          </div>
        </div>
      </header>

      {/* ═══ EXPIRATION BAR ═══ */}
      <div style={{ borderBottom: "1px solid #1e1e2e", padding: "8px 24px", background: "#0d0d14" }}>
        <div style={{ maxWidth: 1800, margin: "0 auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#555", fontFamily: "monospace", marginRight: 4 }}>EXP</span>
          {data?.expirations.map(exp => {
            const d = daysToExpiry(exp);
            const active = exp === selectedExpiry;
            return (
              <button
                key={exp}
                onClick={() => handleExpiryChange(exp)}
                disabled={loading}
                style={{
                  padding: "4px 10px",
                  fontSize: 11,
                  fontWeight: active ? 700 : 500,
                  fontFamily: "monospace",
                  border: active ? "1px solid #3b82f6" : "1px solid #1e1e2e",
                  background: active ? "rgba(59,130,246,0.15)" : "transparent",
                  color: active ? "#60a5fa" : "#888",
                  cursor: "pointer",
                  borderRadius: 1,
                  opacity: loading ? 0.5 : 1,
                  transition: "all 0.1s",
                }}
              >
                {formatExpiry(exp)} ({d}d)
              </button>
            );
          })}
        </div>
      </div>

      <main style={{ maxWidth: 1800, margin: "0 auto", padding: "16px 24px" }}>
        {/* ═══ STATS STRIP ═══ */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, marginBottom: 16 }}>
          <StatCell label="ATM IV" value={atmIV ? `${(atmIV * 100).toFixed(1)}%` : "--"} color="#a78bfa" />
          <StatCell label="DAYS TO EXPIRY" value={String(dte)} />
          <StatCell label="MAX PAIN" value={data?.maxPain ? `$${data.maxPain.strike.toFixed(0)}` : "--"} color="#eab308" sub={data?.maxPain && underlyingPrice ? `${((data.maxPain.strike - underlyingPrice) / underlyingPrice * 100).toFixed(1)}% from spot` : undefined} />
          <StatCell label="P/C OI RATIO" value={data?.putCallRatio?.toFixed(2) || "--"} color={(data?.putCallRatio || 0) > 1 ? "#ef4444" : "#22c55e"} sub={`Put: ${fmtNum(data?.totalPutOI)} | Call: ${fmtNum(data?.totalCallOI)}`} />
          <StatCell label="P/C VOL RATIO" value={data?.putCallVolumeRatio?.toFixed(2) || "--"} color={(data?.putCallVolumeRatio || 0) > 1 ? "#ef4444" : "#22c55e"} sub={`Put: ${fmtNum(data?.totalPutVolume)} | Call: ${fmtNum(data?.totalCallVolume)}`} />
          <StatCell label="STRIKES" value={String(data?.strikes?.length || 0)} sub={`Mult: ${data?.multiplier || 100}`} />
        </div>

        {/* ═══ CHARTS ROW 1: OI + VOLUME ═══ */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          <section style={panel}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={secHead}>OPEN INTEREST BY STRIKE</div>
              {data?.maxPain && <div style={{ fontSize: 10, color: "#555", fontFamily: "monospace" }}>Max Pain: <span style={{ color: "#eab308", fontWeight: 700 }}>${data.maxPain.strike.toFixed(0)}</span></div>}
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={oiData.filter(d => d.callOI > 0 || d.putOI > 0)} barGap={0} barSize={7}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" />
                <XAxis dataKey="strike" tick={{ fontSize: 9, fill: "#555", fontFamily: "monospace" }} />
                <YAxis tick={{ fontSize: 9, fill: "#555", fontFamily: "monospace" }} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                <Tooltip contentStyle={ttStyle} formatter={(value: number | undefined, name?: string) => [(value ?? 0).toLocaleString(), name === "putOI" ? "Put OI" : "Call OI"]} />
                <ReferenceLine x={atmStrike} stroke="#22c55e" strokeDasharray="3 3" ifOverflow="extendDomain">
                  <Label value={`Spot ${underlyingPrice.toFixed(1)}`} fill="#22c55e" fontSize={9} fontFamily="monospace" position="insideTop" dy={-4} />
                </ReferenceLine>
                {data?.maxPain && (
                  <ReferenceLine x={data.maxPain.strike} stroke="#eab308" strokeDasharray="3 3">
                    <Label value="MaxPain" fill="#eab308" fontSize={9} fontFamily="monospace" position="insideTop" dy={-4} />
                  </ReferenceLine>
                )}
                <Bar dataKey="callOI" fill="#3b82f6" name="Call OI" radius={[1, 1, 0, 0]} />
                <Bar dataKey="putOI" fill="#f97316" name="Put OI" radius={[1, 1, 0, 0]} />
                <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }} />
              </BarChart>
            </ResponsiveContainer>
          </section>

          <section style={panel}>
            <div style={secHead}>VOLUME BY STRIKE</div>
            <div style={{ marginBottom: 12 }} />
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={volumeData} barGap={0} barSize={7}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" />
                <XAxis dataKey="strike" tick={{ fontSize: 9, fill: "#555", fontFamily: "monospace" }} />
                <YAxis tick={{ fontSize: 9, fill: "#555", fontFamily: "monospace" }} />
                <Tooltip contentStyle={ttStyle} formatter={(value: number | undefined, name?: string) => [(value ?? 0).toLocaleString(), name ?? ""]} />
                <ReferenceLine x={atmStrike} stroke="#22c55e" strokeDasharray="3 3" ifOverflow="extendDomain">
                  <Label value={`Spot ${underlyingPrice.toFixed(1)}`} fill="#22c55e" fontSize={9} fontFamily="monospace" position="insideTop" dy={-4} />
                </ReferenceLine>
                <Bar dataKey="callVolume" fill="#22c55e" name="Call Volume" radius={[1, 1, 0, 0]} />
                <Bar dataKey="putVolume" fill="#ef4444" name="Put Volume" radius={[1, 1, 0, 0]} />
                <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }} />
              </BarChart>
            </ResponsiveContainer>
          </section>
        </div>

        {/* ═══ CHARTS ROW 2: IV SKEW + GREEKS ═══ */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          <section style={panel}>
            <div style={secHead}>IMPLIED VOLATILITY SKEW</div>
            <div style={{ marginBottom: 12 }} />
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={ivSkewData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" />
                <XAxis dataKey="strike" tick={{ fontSize: 9, fill: "#555", fontFamily: "monospace" }} />
                <YAxis tick={{ fontSize: 9, fill: "#555", fontFamily: "monospace" }} tickFormatter={(v: number) => `${v.toFixed(0)}%`} domain={["auto", "auto"]} />
                <Tooltip contentStyle={ttStyle} formatter={(value: number | undefined) => [`${(value ?? 0).toFixed(1)}%`, ""]} labelFormatter={(label) => `Strike: ${label}`} />
                <ReferenceLine x={underlyingPrice} stroke="#3b82f6" strokeDasharray="3 3" label={{ value: "ATM", fill: "#3b82f6", fontSize: 8, fontFamily: "monospace" }} />
                <Line type="monotone" dataKey="callIV" stroke="#22c55e" strokeWidth={1.5} dot={{ r: 2.5, fill: "#22c55e" }} name="Call IV" connectNulls />
                <Line type="monotone" dataKey="putIV" stroke="#ef4444" strokeWidth={1.5} dot={{ r: 2.5, fill: "#ef4444" }} name="Put IV" connectNulls />
                <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }} />
              </LineChart>
            </ResponsiveContainer>
          </section>

          <section style={panel}>
            <div style={secHead}>GREEKS BY STRIKE</div>
            <div style={{ marginBottom: 12 }} />
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={greeksData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" />
                <XAxis dataKey="strike" tick={{ fontSize: 9, fill: "#555", fontFamily: "monospace" }} />
                <YAxis yAxisId="delta" tick={{ fontSize: 9, fill: "#555", fontFamily: "monospace" }} domain={[0, 1]} />
                <YAxis yAxisId="gamma" orientation="right" tick={{ fontSize: 9, fill: "#555", fontFamily: "monospace" }} />
                <Tooltip contentStyle={ttStyle} />
                <ReferenceLine x={underlyingPrice} stroke="#3b82f6" strokeDasharray="3 3" yAxisId="delta" />
                <Line yAxisId="delta" type="monotone" dataKey="callDelta" stroke="#22c55e" strokeWidth={1.5} dot={false} name="|Call D|" connectNulls />
                <Line yAxisId="delta" type="monotone" dataKey="putDelta" stroke="#ef4444" strokeWidth={1.5} dot={false} name="|Put D|" connectNulls />
                <Bar yAxisId="gamma" dataKey="gamma" fill="rgba(167,139,250,0.25)" name="Gamma" barSize={5} />
                <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }} />
              </ComposedChart>
            </ResponsiveContainer>
          </section>
        </div>


        {/* ═══ P&L CALCULATOR ═══ */}
        <section style={{ ...panel, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ ...secHead, margin: 0 }}>P&L CALCULATOR</div>
            {positions.length > 0 && (
              <button onClick={clearPositions} style={{ padding: "3px 10px", fontSize: 10, fontFamily: "monospace", fontWeight: 600, border: "1px solid #1e1e2e", background: "transparent", color: "#555", cursor: "pointer", borderRadius: 1 }}>
                CLEAR
              </button>
            )}
          </div>

          {/* PRESET STRATEGIES */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#555", fontFamily: "monospace", letterSpacing: "0.1em" }}>
                STRATEGIES
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: "#555", fontFamily: "monospace", letterSpacing: "0.1em" }}>QTY</span>
                <button onClick={() => setStrategyQty(q => Math.max(1, q - 1))} style={{ ...qtyBtn, opacity: strategyQty <= 1 ? 0.3 : 1 }}>-</button>
                <input
                  type="number"
                  min="1"
                  value={strategyQty}
                  onChange={e => { const v = parseInt(e.target.value) || 1; setStrategyQty(Math.max(1, v)); }}
                  style={{ width: 40, padding: "3px 4px", fontSize: 12, fontWeight: 700, textAlign: "center", background: "#0a0a0f", border: "1px solid #1e1e2e", color: "#e5e5e5", fontFamily: "monospace", borderRadius: 0 }}
                />
                <button onClick={() => setStrategyQty(q => q + 1)} style={qtyBtn}>+</button>
              </div>
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {strategies.map(s => (
                <button
                  key={s.key}
                  onClick={() => buildStrategy(s.key)}
                  style={{
                    padding: "5px 12px",
                    fontSize: 10,
                    fontWeight: activeStrategy === s.key ? 700 : 600,
                    fontFamily: "monospace",
                    border: activeStrategy === s.key ? "1px solid #3b82f6" : "1px solid #1e1e2e",
                    background: activeStrategy === s.key ? "rgba(59,130,246,0.1)" : "transparent",
                    color: activeStrategy === s.key ? "#60a5fa" : "#888",
                    cursor: "pointer",
                    borderRadius: 1,
                    letterSpacing: "0.03em",
                  }}
                  onMouseEnter={(e) => { if (activeStrategy !== s.key) { e.currentTarget.style.borderColor = "#3b82f6"; e.currentTarget.style.color = "#60a5fa"; } }}
                  onMouseLeave={(e) => { if (activeStrategy !== s.key) { e.currentTarget.style.borderColor = "#1e1e2e"; e.currentTarget.style.color = "#888"; } }}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {activeStrategy && (() => {
              const s = strategies.find(s => s.key === activeStrategy);
              return s ? (
                <div style={{ marginTop: 8, padding: "8px 12px", background: "#0a0a0f", border: "1px solid #1e1e2e", fontSize: 10, fontFamily: "monospace", lineHeight: 1.6 }}>
                  <div style={{ color: "#60a5fa", fontWeight: 700, marginBottom: 3 }}>{s.label}</div>
                  <div style={{ color: "#888" }}>{s.legs}</div>
                  <div style={{ color: "#666", marginTop: 2 }}>{s.desc}</div>
                  <div style={{ display: "flex", gap: 16, marginTop: 4, color: "#555", fontSize: 9 }}>
                    <span>Outlook: <span style={{ color: s.outlookColor, fontWeight: 700 }}>{s.outlook}</span></span>
                    <span>Risk: <span style={{ fontWeight: 700 }}>{s.risk}</span></span>
                    <span>Cost: <span style={{ fontWeight: 700 }}>{s.cost}</span></span>
                  </div>
                </div>
              ) : null;
            })()}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 20 }}>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#555", marginBottom: 8, fontFamily: "monospace", letterSpacing: "0.1em" }}>
                MANUAL ENTRY
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
                <div>
                  <label style={lbl}>TYPE</label>
                  <div style={{ display: "flex", gap: 2, marginTop: 4 }}>
                    <button onClick={() => setCalcType("call")} style={tabBtn(calcType === "call", "#22c55e")}>CALL</button>
                    <button onClick={() => setCalcType("put")} style={tabBtn(calcType === "put", "#ef4444")}>PUT</button>
                  </div>
                </div>
                <div>
                  <label style={lbl}>SIDE</label>
                  <div style={{ display: "flex", gap: 2, marginTop: 4 }}>
                    <button onClick={() => setCalcSide("long")} style={tabBtn(calcSide === "long", "#22c55e")}>LONG</button>
                    <button onClick={() => setCalcSide("short")} style={tabBtn(calcSide === "short", "#ef4444")}>SHORT</button>
                  </div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 8 }}>
                <div>
                  <label style={lbl}>STRIKE</label>
                  <input type="number" step="0.5" value={calcStrike} onChange={e => setCalcStrike(parseFloat(e.target.value) || 0)} style={inp} />
                </div>
                <div>
                  <label style={lbl}>PREMIUM</label>
                  <input type="number" step="0.05" value={calcPremium} onChange={e => setCalcPremium(parseFloat(e.target.value) || 0)} style={inp} />
                </div>
                <div>
                  <label style={lbl}>QTY</label>
                  <input type="number" step="1" min="1" value={calcQty} onChange={e => setCalcQty(parseInt(e.target.value) || 1)} style={inp} />
                </div>
              </div>
              <button onClick={addPosition} style={{
                padding: "6px 16px",
                width: "100%",
                fontSize: 10,
                fontWeight: 700,
                fontFamily: "monospace",
                border: "1px solid #3b82f6",
                background: "rgba(59,130,246,0.1)",
                color: "#60a5fa",
                cursor: "pointer",
                borderRadius: 1,
                letterSpacing: "0.05em",
              }}>
                ADD TO STRATEGY
              </button>

              {positions.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "#555", marginBottom: 6, fontFamily: "monospace", letterSpacing: "0.1em" }}>
                    POSITIONS ({positions.length})
                  </div>
                  {positions.map((pos, i) => (
                    <div key={i} style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "5px 8px",
                      background: "#0d0d14",
                      marginBottom: 2,
                      fontSize: 11,
                      fontFamily: "monospace",
                      borderLeft: `2px solid ${pos.quantity > 0 ? "#22c55e" : "#ef4444"}`,
                    }}>
                      <div>
                        <span style={{ color: pos.quantity > 0 ? "#22c55e" : "#ef4444", fontWeight: 700, fontSize: 9, letterSpacing: "0.05em" }}>
                          {pos.quantity > 0 ? "LONG" : "SHORT"}
                        </span>
                        {" "}
                        <span style={{ fontWeight: 600 }}>{Math.abs(pos.quantity)}x {pos.type.toUpperCase()}</span>
                        {" "}@{pos.strike} -- ${pos.premium.toFixed(2)}
                      </div>
                      <button onClick={() => removePosition(i)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 14, lineHeight: 1, fontFamily: "monospace" }}>x</button>
                    </div>
                  ))}
                  <div style={{ marginTop: 10, padding: "10px 12px", background: "#0d0d14", border: "1px solid #1e1e2e" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11, fontFamily: "monospace" }}>
                      <div>
                        <div style={{ color: "#555", fontSize: 9, letterSpacing: "0.1em", marginBottom: 2 }}>NET COST</div>
                        <div style={{ fontWeight: 700, fontSize: 13, color: totalCost < 0 ? "#22c55e" : "#ef4444" }}>
                          ${Math.abs(totalCost).toFixed(0)} {totalCost < 0 ? "(CR)" : "(DR)"}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: "#555", fontSize: 9, letterSpacing: "0.1em", marginBottom: 2 }}>BREAKEVEN</div>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>
                          {breakevens.length > 0 ? breakevens.map(b => `$${b}`).join(", ") : "--"}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: "#555", fontSize: 9, letterSpacing: "0.1em", marginBottom: 2 }}>MAX PROFIT</div>
                        <div style={{ fontWeight: 700, fontSize: 13, color: "#22c55e" }}>
                          {maxProfitLoss.maxProfit === "unlimited" ? "UNLIMITED" : `$${(maxProfitLoss.maxProfit as number).toFixed(0)}`}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: "#555", fontSize: 9, letterSpacing: "0.1em", marginBottom: 2 }}>MAX LOSS</div>
                        <div style={{ fontWeight: 700, fontSize: 13, color: "#ef4444" }}>
                          {maxProfitLoss.maxLoss === "unlimited" ? "UNLIMITED" : `$${Math.abs(maxProfitLoss.maxLoss as number).toFixed(0)}`}
                        </div>
                      </div>
                    </div>
                  </div>
                  {portfolioGreeks && (
                    <div style={{ marginTop: 8, padding: "8px 12px", background: "#0d0d14", border: "1px solid #1e1e2e" }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: "#555", marginBottom: 4, fontFamily: "monospace", letterSpacing: "0.1em" }}>PORTFOLIO GREEKS</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", fontSize: 11, fontFamily: "monospace" }}>
                        <div><span style={{ color: "#555", fontSize: 9 }}>DELTA </span><span style={{ fontWeight: 700 }}>{portfolioGreeks.delta.toFixed(3)}</span></div>
                        <div><span style={{ color: "#555", fontSize: 9 }}>GAMMA </span><span style={{ fontWeight: 700 }}>{portfolioGreeks.gamma.toFixed(4)}</span></div>
                        <div><span style={{ color: "#555", fontSize: 9 }}>THETA </span><span style={{ fontWeight: 700, color: portfolioGreeks.theta < 0 ? "#ef4444" : "#22c55e" }}>{portfolioGreeks.theta.toFixed(2)}</span></div>
                        <div><span style={{ color: "#555", fontSize: 9 }}>VEGA </span><span style={{ fontWeight: 700, color: "#a78bfa" }}>{portfolioGreeks.vega.toFixed(3)}</span></div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#555", marginBottom: 8, fontFamily: "monospace", letterSpacing: "0.1em" }}>
                PAYOFF ANALYSIS — TIME DECAY
              </div>
              {positions.length > 0 && multiTimeData.length > 0 ? (
                <ResponsiveContainer width="100%" height={360}>
                  <LineChart data={multiTimeData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" />
                    <XAxis dataKey="price" tick={{ fontSize: 9, fill: "#555", fontFamily: "monospace" }} tickFormatter={(v: number) => `${v.toFixed(0)}`} />
                    <YAxis tick={{ fontSize: 9, fill: "#555", fontFamily: "monospace" }} tickFormatter={(v: number) => `$${v.toFixed(0)}`} />
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <Tooltip content={({ active, payload, label }: any) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0]?.payload;
                      if (!d) return null;
                      const m1 = Math.max(Math.round(dte * 0.66), 1);
                      const m2 = Math.max(Math.round(dte * 0.33), 1);
                      return (
                        <div style={{ background: "#12121e", border: "1px solid #1e1e2e", padding: "8px 12px", fontSize: 11, fontFamily: "monospace" }}>
                          <div style={{ color: "#888", fontWeight: 700, marginBottom: 6 }}>PRICE: ${Number(label).toFixed(2)}</div>
                          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 10px", marginBottom: 6 }}>
                            <span style={{ color: "#22c55e", fontSize: 10 }}>Today ({dte}d)</span>
                            <span style={{ textAlign: "right", fontWeight: 700, color: d.pnlToday >= 0 ? "#22c55e" : "#ef4444" }}>${d.pnlToday?.toFixed(0)}</span>
                            <span style={{ color: "#eab308", fontSize: 10 }}>{m1}d to exp</span>
                            <span style={{ textAlign: "right", fontWeight: 700, color: d.pnlMid1 >= 0 ? "#22c55e" : "#ef4444" }}>${d.pnlMid1?.toFixed(0)}</span>
                            <span style={{ color: "#f97316", fontSize: 10 }}>{m2}d to exp</span>
                            <span style={{ textAlign: "right", fontWeight: 700, color: d.pnlMid2 >= 0 ? "#22c55e" : "#ef4444" }}>${d.pnlMid2?.toFixed(0)}</span>
                            <span style={{ color: "#555", fontSize: 10 }}>At Expiry</span>
                            <span style={{ textAlign: "right", fontWeight: 700, color: d.pnlExpiry >= 0 ? "#22c55e" : "#ef4444" }}>${d.pnlExpiry?.toFixed(0)}</span>
                          </div>
                          <div style={{ borderTop: "1px solid #1e1e2e", paddingTop: 4, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 10px", fontSize: 10 }}>
                            <span>Delta: <span style={{ fontWeight: 700 }}>{(d.delta / greeksNorm)?.toFixed(3)}</span></span>
                            <span>Gamma: <span style={{ fontWeight: 700 }}>{(d.gamma / greeksNorm)?.toFixed(4)}</span></span>
                            <span style={{ color: "#ef4444" }}>Theta: <span style={{ fontWeight: 700 }}>{(d.theta / greeksNorm)?.toFixed(2)}</span></span>
                            <span style={{ color: "#a78bfa" }}>Vega: <span style={{ fontWeight: 700 }}>{(d.vega / greeksNorm)?.toFixed(3)}</span></span>
                          </div>
                        </div>
                      );
                    }} />
                    <ReferenceLine y={0} stroke="#333" strokeWidth={1} />
                    <ReferenceLine x={underlyingPrice} stroke="#3b82f6" strokeDasharray="3 3" label={{ value: "Spot", fill: "#3b82f6", fontSize: 8, fontFamily: "monospace" }} />
                    {breakevens.map((be, i) => (
                      <ReferenceLine key={i} x={be} stroke="#eab308" strokeDasharray="3 3" label={{ value: `BE ${be}`, fill: "#eab308", fontSize: 8, fontFamily: "monospace" }} />
                    ))}
                    <Line type="monotone" dataKey="pnlExpiry" stroke="#555" strokeDasharray="4 2" strokeWidth={1} dot={false} name="At Expiry" />
                    <Line type="monotone" dataKey="pnlMid2" stroke="#f97316" strokeWidth={1} dot={false} name={`${Math.max(Math.round(dte * 0.33), 1)}d`} />
                    <Line type="monotone" dataKey="pnlMid1" stroke="#eab308" strokeWidth={1} dot={false} name={`${Math.max(Math.round(dte * 0.66), 1)}d`} />
                    <Line type="monotone" dataKey="pnlToday" stroke="#22c55e" strokeWidth={2} dot={false} name={`Today (${dte}d)`} />
                    <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div style={{
                  height: 360,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#0d0d14",
                  border: "1px solid #1e1e2e",
                  color: "#444",
                  fontSize: 11,
                  fontFamily: "monospace",
                  flexDirection: "column",
                  gap: 6,
                }}>
                  <div>Select a preset strategy or click <span style={{ color: "#22c55e", fontWeight: 700 }}>B</span>/<span style={{ color: "#ef4444", fontWeight: 700 }}>S</span> on the chain</div>
                  <div style={{ color: "#333", fontSize: 10 }}>Time decay curves show P&L at different DTE</div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ═══ OPTIONS CHAIN TABLE ═══ */}
        <section style={{ ...panel, marginBottom: 8, padding: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid #1e1e2e" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ ...secHead, margin: 0 }}>OPTIONS CHAIN</div>
              <div style={{ display: "flex", gap: 2 }}>
                {(["near", "all", "itm", "otm"] as const).map(f => (
                  <button key={f} onClick={() => setChainFilter(f)} style={{
                    padding: "3px 10px",
                    fontSize: 10,
                    fontWeight: chainFilter === f ? 700 : 500,
                    fontFamily: "monospace",
                    border: chainFilter === f ? "1px solid #6366f1" : "1px solid transparent",
                    background: chainFilter === f ? "rgba(99,102,241,0.15)" : "transparent",
                    color: chainFilter === f ? "#818cf8" : "#555",
                    cursor: "pointer",
                    borderRadius: 1,
                  }}>
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={() => setShowGreeks(!showGreeks)} style={{
              padding: "3px 10px",
              fontSize: 10,
              fontWeight: 600,
              fontFamily: "monospace",
              border: "1px solid #1e1e2e",
              background: showGreeks ? "rgba(167,139,250,0.1)" : "transparent",
              color: showGreeks ? "#a78bfa" : "#555",
              cursor: "pointer",
              borderRadius: 1,
            }}>
              {showGreeks ? "HIDE GREEKS" : "SHOW GREEKS"}
            </button>
          </div>
          <div style={{ overflowX: "auto", maxHeight: 600 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
              <thead style={{ position: "sticky", top: 0, background: "#0d0d14", zIndex: 1 }}>
                <tr style={{ borderBottom: "1px solid #1e1e2e" }}>
                  <th style={thStyle}>OI</th>
                  <th style={thStyle}>VOL</th>
                  <th style={thStyle}>BID</th>
                  <th style={thStyle}>ASK</th>
                  <th style={thStyle}>LAST</th>
                  <th style={{ ...thStyle, color: "#60a5fa" }}>IV</th>
                  {showGreeks && <>
                    <th style={thStyle}>D</th>
                    <th style={thStyle}>G</th>
                    <th style={thStyle}>TH</th>
                    <th style={thStyle}>V</th>
                  </>}
                  <th style={{ ...thStyle, textAlign: "center", width: 40 }}></th>
                  <th style={{ ...thStyle, textAlign: "center", background: "#12121e", fontSize: 10, fontWeight: 800, minWidth: 70, letterSpacing: "0.05em" }}>STRIKE</th>
                  <th style={{ ...thStyle, textAlign: "center", width: 40 }}></th>
                  {showGreeks && <>
                    <th style={thStyle}>D</th>
                    <th style={thStyle}>G</th>
                    <th style={thStyle}>TH</th>
                    <th style={thStyle}>V</th>
                  </>}
                  <th style={{ ...thStyle, color: "#60a5fa" }}>IV</th>
                  <th style={thStyle}>BID</th>
                  <th style={thStyle}>ASK</th>
                  <th style={thStyle}>LAST</th>
                  <th style={thStyle}>VOL</th>
                  <th style={thStyle}>OI</th>
                </tr>
                <tr style={{ borderBottom: "1px solid #1e1e2e" }}>
                  <th colSpan={showGreeks ? 11 : 7} style={{ padding: "2px 8px", fontSize: 9, fontWeight: 800, color: "#22c55e", textAlign: "center", background: "rgba(34,197,94,0.04)", letterSpacing: "0.1em" }}>
                    CALLS
                  </th>
                  <th style={{ padding: "2px", background: "#12121e" }} />
                  <th colSpan={showGreeks ? 11 : 7} style={{ padding: "2px 8px", fontSize: 9, fontWeight: 800, color: "#ef4444", textAlign: "center", background: "rgba(239,68,68,0.04)", letterSpacing: "0.1em" }}>
                    PUTS
                  </th>
                </tr>
              </thead>
              <tbody>
                {chain.map((row) => {
                  const callItm = underlyingPrice > row.strike;
                  const strikeSpacing = data?.strikes?.[1] ? Math.abs(data.strikes[1] - data.strikes[0]) : 1;
                  const isAtm = Math.abs(row.strike - underlyingPrice) <= strikeSpacing / 2;
                  const isMaxPain = data?.maxPain && row.strike === data.maxPain.strike;
                  const midCall = row.call?.bid && row.call?.ask ? ((row.call.bid + row.call.ask) / 2).toFixed(2) : null;
                  const midPut = row.put?.bid && row.put?.ask ? ((row.put.bid + row.put.ask) / 2).toFixed(2) : null;

                  return (
                    <tr
                      key={row.strike}
                      style={{
                        borderBottom: "1px solid #141420",
                        background: isAtm ? "rgba(59,130,246,0.08)" : isMaxPain ? "rgba(234,179,8,0.04)" : callItm ? "rgba(255,255,255,0.01)" : "transparent",
                      }}
                    >
                      <td style={{ ...tdStyle, color: "#666", cursor: "pointer" }} onClick={() => addFromChain(row.strike, "call", "long")}>{fmtOI(row.call?.openInterest)}</td>
                      <td style={{ ...tdStyle, color: row.call?.volume ? "#60a5fa" : "#333", cursor: "pointer" }} onClick={() => addFromChain(row.strike, "call", "long")}>{row.call?.volume || "--"}</td>
                      <td style={{ ...tdStyle, color: "#22c55e", cursor: "pointer" }} onClick={() => addFromChain(row.strike, "call", "short")} title="Sell Call at bid">{row.call?.bid?.toFixed(2) || "--"}</td>
                      <td style={{ ...tdStyle, color: "#ef4444", cursor: "pointer" }} onClick={() => addFromChain(row.strike, "call", "long")} title="Buy Call at ask">{row.call?.ask?.toFixed(2) || "--"}</td>
                      <td style={{ ...tdStyle, fontWeight: 600, color: "#e5e5e5", cursor: "pointer" }} onClick={() => addFromChain(row.strike, "call", "long")}>{row.call?.last?.toFixed(2) || (midCall ? <span style={{ color: "#444" }}>{midCall}</span> : "--")}</td>
                      <td style={{ ...tdStyle, color: "#60a5fa", fontWeight: 600, cursor: "pointer" }} onClick={() => addFromChain(row.strike, "call", "long")}>{row.call?.iv ? (row.call.iv * 100).toFixed(1) : "--"}</td>
                      {showGreeks && <>
                        <td style={{ ...tdStyle, color: deltaColor(row.call?.delta), cursor: "pointer" }} onClick={() => addFromChain(row.strike, "call", "long")}>{row.call?.delta?.toFixed(3) || "--"}</td>
                        <td style={{ ...tdStyle, color: "#666", cursor: "pointer" }} onClick={() => addFromChain(row.strike, "call", "long")}>{row.call?.gamma?.toFixed(4) || "--"}</td>
                        <td style={{ ...tdStyle, color: "#ef4444", cursor: "pointer" }} onClick={() => addFromChain(row.strike, "call", "long")}>{row.call?.theta?.toFixed(3) || "--"}</td>
                        <td style={{ ...tdStyle, color: "#a78bfa", cursor: "pointer" }} onClick={() => addFromChain(row.strike, "call", "long")}>{row.call?.vega?.toFixed(3) || "--"}</td>
                      </>}
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <button onClick={() => addFromChain(row.strike, "call", "long")} style={btnBuy} title="Buy Call">B</button>
                        {" "}
                        <button onClick={() => addFromChain(row.strike, "call", "short")} style={btnSell} title="Sell Call">S</button>
                      </td>

                      <td style={{
                        padding: "6px 8px",
                        textAlign: "center",
                        fontWeight: 800,
                        fontSize: 11,
                        background: "#12121e",
                        color: isAtm ? "#60a5fa" : isMaxPain ? "#eab308" : "#ccc",
                        borderLeft: "1px solid #1e1e2e",
                        borderRight: "1px solid #1e1e2e",
                        fontFamily: "monospace",
                        letterSpacing: "0.02em",
                      }}>
                        {row.strike.toFixed(2)}
                        {isAtm && <span style={{ fontSize: 7, color: "#60a5fa", display: "block", letterSpacing: "0.15em", fontWeight: 800 }}>ATM</span>}
                        {isMaxPain && !isAtm && <span style={{ fontSize: 7, color: "#eab308", display: "block", letterSpacing: "0.15em", fontWeight: 800 }}>MAX PAIN</span>}
                      </td>

                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <button onClick={() => addFromChain(row.strike, "put", "long")} style={btnBuy} title="Buy Put">B</button>
                        {" "}
                        <button onClick={() => addFromChain(row.strike, "put", "short")} style={btnSell} title="Sell Put">S</button>
                      </td>
                      {showGreeks && <>
                        <td style={{ ...tdStyle, color: deltaColor(row.put?.delta), cursor: "pointer" }} onClick={() => addFromChain(row.strike, "put", "long")}>{row.put?.delta?.toFixed(3) || "--"}</td>
                        <td style={{ ...tdStyle, color: "#666", cursor: "pointer" }} onClick={() => addFromChain(row.strike, "put", "long")}>{row.put?.gamma?.toFixed(4) || "--"}</td>
                        <td style={{ ...tdStyle, color: "#ef4444", cursor: "pointer" }} onClick={() => addFromChain(row.strike, "put", "long")}>{row.put?.theta?.toFixed(3) || "--"}</td>
                        <td style={{ ...tdStyle, color: "#a78bfa", cursor: "pointer" }} onClick={() => addFromChain(row.strike, "put", "long")}>{row.put?.vega?.toFixed(3) || "--"}</td>
                      </>}
                      <td style={{ ...tdStyle, color: "#60a5fa", fontWeight: 600, cursor: "pointer" }} onClick={() => addFromChain(row.strike, "put", "long")}>{row.put?.iv ? (row.put.iv * 100).toFixed(1) : "--"}</td>
                      <td style={{ ...tdStyle, color: "#22c55e", cursor: "pointer" }} onClick={() => addFromChain(row.strike, "put", "short")} title="Sell Put at bid">{row.put?.bid?.toFixed(2) || "--"}</td>
                      <td style={{ ...tdStyle, color: "#ef4444", cursor: "pointer" }} onClick={() => addFromChain(row.strike, "put", "long")} title="Buy Put at ask">{row.put?.ask?.toFixed(2) || "--"}</td>
                      <td style={{ ...tdStyle, fontWeight: 600, color: "#e5e5e5", cursor: "pointer" }} onClick={() => addFromChain(row.strike, "put", "long")}>{row.put?.last?.toFixed(2) || (midPut ? <span style={{ color: "#444" }}>{midPut}</span> : "--")}</td>
                      <td style={{ ...tdStyle, color: row.put?.volume ? "#60a5fa" : "#333", cursor: "pointer" }} onClick={() => addFromChain(row.strike, "put", "long")}>{row.put?.volume || "--"}</td>
                      <td style={{ ...tdStyle, color: "#666", cursor: "pointer" }} onClick={() => addFromChain(row.strike, "put", "long")}>{fmtOI(row.put?.openInterest)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "6px 16px", borderTop: "1px solid #1e1e2e", fontSize: 10, color: "#444", display: "flex", justifyContent: "space-between", fontFamily: "monospace" }}>
            <span>Showing {chain.length} of {data?.chain.length || 0} strikes</span>
            <span>Click B/S to add to P&L calculator</span>
          </div>
        </section>

        <div style={{ fontSize: 10, color: "#333", textAlign: "center", padding: "4px 0 16px", fontFamily: "monospace" }}>
          Data pre-loaded from Yahoo Finance (15-min delayed)
          {data?.lastUpdated && <> | Last refresh: {new Date(data.lastUpdated).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</>}
        </div>
      </main>
    </div>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────
function StatCell({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={panel}>
      <div style={{ fontSize: 9, color: "#555", fontFamily: "monospace", letterSpacing: "0.1em", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || "#e5e5e5", marginTop: 2, fontFamily: "monospace" }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: "#444", marginTop: 1, fontFamily: "monospace" }}>{sub}</div>}
    </div>
  );
}

// ─── Utilities ───────────────────────────────────────────────────
function fmtOI(oi: number | undefined): string {
  if (!oi || oi === 0) return "--";
  if (oi >= 1000) return `${(oi / 1000).toFixed(1)}k`;
  return String(oi);
}

function fmtNum(n: number | undefined): string {
  if (!n) return "0";
  return n.toLocaleString();
}

function deltaColor(delta: number | undefined): string {
  if (!delta) return "#333";
  const abs = Math.abs(delta);
  if (abs > 0.7) return "#22c55e";
  if (abs > 0.3) return "#eab308";
  return "#ef4444";
}

// ─── Style Constants ─────────────────────────────────────────────
const panel: React.CSSProperties = {
  background: "#0d0d14",
  border: "1px solid #1e1e2e",
  padding: "12px 16px",
};

const secHead: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "0.1em",
  color: "#888",
  fontFamily: "monospace",
};

const ttStyle: React.CSSProperties = {
  background: "#12121e",
  border: "1px solid #1e1e2e",
  borderRadius: 0,
  fontSize: 11,
  fontFamily: "monospace",
};

const thStyle: React.CSSProperties = {
  padding: "6px 5px",
  fontWeight: 700,
  color: "#555",
  textAlign: "right",
  fontSize: 9,
  letterSpacing: "0.05em",
  whiteSpace: "nowrap",
  fontFamily: "monospace",
};

const tdStyle: React.CSSProperties = {
  padding: "4px 5px",
  textAlign: "right",
  fontSize: 11,
  whiteSpace: "nowrap",
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
};

const btnBuy: React.CSSProperties = {
  background: "none",
  border: "1px solid rgba(34,197,94,0.3)",
  color: "#22c55e",
  cursor: "pointer",
  fontSize: 9,
  fontWeight: 800,
  padding: "1px 4px",
  fontFamily: "monospace",
  borderRadius: 1,
};

const btnSell: React.CSSProperties = {
  background: "none",
  border: "1px solid rgba(239,68,68,0.3)",
  color: "#ef4444",
  cursor: "pointer",
  fontSize: 9,
  fontWeight: 800,
  padding: "1px 4px",
  fontFamily: "monospace",
  borderRadius: 1,
};

const inp: React.CSSProperties = {
  width: "100%",
  padding: "5px 8px",
  fontSize: 12,
  background: "#0a0a0f",
  border: "1px solid #1e1e2e",
  color: "#e5e5e5",
  marginTop: 4,
  fontFamily: "monospace",
  borderRadius: 0,
};

const lbl: React.CSSProperties = {
  fontSize: 9,
  color: "#555",
  fontFamily: "monospace",
  letterSpacing: "0.1em",
  fontWeight: 700,
};

const strategies = [
  {
    key: "bull_call", label: "BULL CALL SPREAD",
    legs: "Buy ATM call + Sell OTM call",
    desc: "Profits from moderate upside. Caps max gain at upper strike but reduces cost vs naked call. Time decay hurts less than a naked long.",
    outlook: "BULLISH", outlookColor: "#22c55e", risk: "DEFINED", cost: "NET DEBIT",
  },
  {
    key: "bear_put", label: "BEAR PUT SPREAD",
    legs: "Buy ATM put + Sell OTM put",
    desc: "Profits from moderate downside. Lower cost than naked put, but caps profit at lower strike. Good for hedging long positions.",
    outlook: "BEARISH", outlookColor: "#ef4444", risk: "DEFINED", cost: "NET DEBIT",
  },
  {
    key: "straddle", label: "LONG STRADDLE",
    legs: "Buy ATM call + Buy ATM put",
    desc: "Profits from large moves in either direction. Loses if price stays near strike. Best before earnings or events. Expensive — needs big move to overcome premium.",
    outlook: "VOLATILE", outlookColor: "#a78bfa", risk: "DEFINED", cost: "NET DEBIT",
  },
  {
    key: "strangle", label: "LONG STRANGLE",
    legs: "Buy OTM call + Buy OTM put",
    desc: "Like straddle but cheaper — uses OTM options. Needs a bigger move to profit. Lower max loss but wider breakevens than straddle.",
    outlook: "VOLATILE", outlookColor: "#a78bfa", risk: "DEFINED", cost: "NET DEBIT",
  },
  {
    key: "iron_condor", label: "IRON CONDOR",
    legs: "Sell OTM put spread + Sell OTM call spread",
    desc: "Profits from range-bound prices and falling IV. Collects premium on both sides. Max profit if price stays between short strikes at expiry.",
    outlook: "NEUTRAL", outlookColor: "#eab308", risk: "DEFINED", cost: "NET CREDIT",
  },
  {
    key: "butterfly", label: "CALL BUTTERFLY",
    legs: "Buy 1 lower call + Sell 2 ATM calls + Buy 1 upper call",
    desc: "Max profit if price is at center strike at expiry. Very low cost, but narrow profit zone. Good when you have a precise price target.",
    outlook: "NEUTRAL", outlookColor: "#eab308", risk: "DEFINED", cost: "LOW DEBIT",
  },
];

const qtyBtn: React.CSSProperties = {
  width: 24,
  height: 24,
  fontSize: 14,
  fontWeight: 700,
  fontFamily: "monospace",
  border: "1px solid #1e1e2e",
  background: "transparent",
  color: "#888",
  cursor: "pointer",
  borderRadius: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

function tabBtn(active: boolean, color: string): React.CSSProperties {
  return {
    padding: "4px 10px",
    fontSize: 10,
    fontWeight: active ? 800 : 500,
    fontFamily: "monospace",
    border: active ? `1px solid ${color}` : "1px solid #1e1e2e",
    background: active ? `${color}1a` : "transparent",
    color: active ? color : "#555",
    cursor: "pointer",
    borderRadius: 0,
    letterSpacing: "0.05em",
  };
}
