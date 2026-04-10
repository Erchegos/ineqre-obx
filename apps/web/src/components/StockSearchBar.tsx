"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

export type SearchStock = {
  ticker: string;
  name: string;
  sector: string | null;
  last_close: number;
  prev_close: number | null;
  mktcap: number | null;
};

type Props = {
  stocks: SearchStock[];
};

const SECTOR_COLORS: Record<string, string> = {
  Energy: "#f59e0b",
  Financials: "#3b82f6",
  Materials: "#10b981",
  Industrials: "#8b5cf6",
  "Consumer Staples": "#06b6d4",
  "Consumer Discretionary": "#ec4899",
  "Health Care": "#ef4444",
  Technology: "#6366f1",
  Utilities: "#14b8a6",
  "Communication Services": "#f97316",
  "Real Estate": "#a78bfa",
};

function sectorColor(sector: string | null): string {
  if (!sector) return "#8b949e";
  return SECTOR_COLORS[sector] || "#8b949e";
}

function formatPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString("nb-NO", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  if (p >= 10) return p.toFixed(1);
  return p.toFixed(2);
}

function Sparkline({ data, width = 64, height = 24 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const color = data[data.length - 1] >= data[0] ? "#10b981" : "#ef4444";
  return (
    <svg width={width} height={height} style={{ display: "block", flexShrink: 0 }}>
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function StockSearchBar({ stocks }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [sparkCache, setSparkCache] = useState<Map<string, number[]>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fetchingRef = useRef<Set<string>>(new Set());

  // Sort stocks by mktcap desc for default display
  const byMktcap = useRef(
    [...stocks].sort((a, b) => (b.mktcap ?? 0) - (a.mktcap ?? 0))
  );

  const filtered = query.trim() === ""
    ? byMktcap.current.slice(0, 10)
    : stocks
        .filter((s) => {
          const q = query.toUpperCase();
          return s.ticker.toUpperCase().includes(q) || (s.name || "").toUpperCase().includes(q);
        })
        .sort((a, b) => {
          const q = query.toUpperCase();
          const aExact = a.ticker.toUpperCase() === q ? 0 : 1;
          const bExact = b.ticker.toUpperCase() === q ? 0 : 1;
          if (aExact !== bExact) return aExact - bExact;
          const aStarts = a.ticker.toUpperCase().startsWith(q) ? 0 : 1;
          const bStarts = b.ticker.toUpperCase().startsWith(q) ? 0 : 1;
          if (aStarts !== bStarts) return aStarts - bStarts;
          return (b.mktcap ?? 0) - (a.mktcap ?? 0);
        })
        .slice(0, 8);

  // Reset active index when results change
  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Fetch a single sparkline
  const fetchSparkline = useCallback(async (ticker: string) => {
    if (fetchingRef.current.has(ticker)) return;
    fetchingRef.current.add(ticker);
    try {
      const res = await fetch(`/api/prices/${encodeURIComponent(ticker)}?limit=30`);
      if (res.ok) {
        const json = await res.json();
        const closes: number[] = (json.rows || [])
          .map((r: { close: number | null }) => r.close)
          .filter((v: number | null): v is number => v !== null);
        setSparkCache((prev) => {
          const next = new Map(prev);
          next.set(ticker, closes);
          return next;
        });
      }
    } catch {
      // silently fail
    }
  }, []);

  // Eagerly fetch sparklines for ALL visible results when dropdown opens or results change
  useEffect(() => {
    if (!open || filtered.length === 0) return;
    for (const stock of filtered) {
      if (!sparkCache.has(stock.ticker) && !fetchingRef.current.has(stock.ticker)) {
        fetchSparkline(stock.ticker);
      }
    }
  }, [open, filtered, sparkCache, fetchSparkline]);

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current) {
      const el = listRef.current.children[activeIdx] as HTMLElement | undefined;
      if (el) el.scrollIntoView({ block: "nearest" });
    }
  }, [activeIdx]);

  const navigate = (ticker: string) => {
    setOpen(false);
    setQuery("");
    router.push(`/stocks/${ticker}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered.length > 0) {
      e.preventDefault();
      navigate(filtered[activeIdx].ticker);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  // Calculate the natural height of the results list for smooth animation
  const ROW_HEIGHT = 52; // approximate height per row including border
  const listHeight = open && filtered.length > 0 ? filtered.length * ROW_HEIGHT : 0;

  return (
    <div ref={containerRef} style={{ width: "100%" }}>
      {/* Search input */}
      <div style={{ position: "relative" }}>
        <svg
          style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search ticker or company name..."
          style={{
            width: "100%",
            padding: "12px 14px 12px 40px",
            fontSize: 15,
            fontFamily: "system-ui, -apple-system, sans-serif",
            background: "#161b22",
            border: "1px solid #30363d",
            borderRadius: 8,
            color: "#e6edf3",
            outline: "none",
            transition: "border-color 0.2s, box-shadow 0.2s",
          }}
          onMouseEnter={(e) => { (e.target as HTMLInputElement).style.borderColor = "#3b82f6"; }}
          onMouseLeave={(e) => { if (document.activeElement !== e.target) (e.target as HTMLInputElement).style.borderColor = "#30363d"; }}
          onFocusCapture={(e) => { (e.target as HTMLInputElement).style.borderColor = "#3b82f6"; (e.target as HTMLInputElement).style.boxShadow = "0 0 0 3px rgba(59,130,246,0.15)"; }}
          onBlurCapture={(e) => { (e.target as HTMLInputElement).style.borderColor = "#30363d"; (e.target as HTMLInputElement).style.boxShadow = "none"; }}
        />
      </div>

      {/* Dropdown — in normal flow, pushes content down with smooth height animation */}
      <div
        style={{
          overflow: "hidden",
          maxHeight: listHeight,
          transition: "max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          marginTop: listHeight > 0 ? 6 : 0,
        }}
      >
        <div
          ref={listRef}
          style={{
            background: "#0d1117",
            border: listHeight > 0 ? "1px solid #30363d" : "none",
            borderRadius: 8,
            overflowY: "auto",
            maxHeight: 420,
          }}
        >
          {open && filtered.map((stock, i) => {
            const isActive = i === activeIdx;
            const changePct = stock.prev_close && stock.prev_close > 0
              ? ((stock.last_close - stock.prev_close) / stock.prev_close) * 100
              : null;
            const spark = sparkCache.get(stock.ticker);

            return (
              <div
                key={stock.ticker}
                onClick={() => navigate(stock.ticker)}
                onMouseEnter={() => setActiveIdx(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  cursor: "pointer",
                  background: isActive ? "rgba(59,130,246,0.08)" : "transparent",
                  borderBottom: i < filtered.length - 1 ? "1px solid #21262d" : "none",
                  transition: "background 0.1s",
                }}
              >
                {/* Ticker + Name */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                    <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: "#e6edf3", letterSpacing: "0.02em" }}>
                      {stock.ticker}
                    </span>
                    {stock.sector && (
                      <span style={{
                        fontSize: 8,
                        fontWeight: 600,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        padding: "1px 6px",
                        borderRadius: 8,
                        background: `${sectorColor(stock.sector)}18`,
                        color: `${sectorColor(stock.sector)}cc`,
                        whiteSpace: "nowrap",
                      }}>
                        {stock.sector}
                      </span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 11,
                    color: "#8b949e",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    fontFamily: "system-ui, -apple-system, sans-serif",
                  }}>
                    {stock.name}
                  </div>
                </div>

                {/* Sparkline */}
                <div style={{ width: 64, height: 24, flexShrink: 0 }}>
                  {spark ? (
                    <Sparkline data={spark} />
                  ) : (
                    <div style={{ width: 64, height: 24, background: "rgba(255,255,255,0.03)", borderRadius: 4 }} />
                  )}
                </div>

                {/* Price + Change */}
                <div style={{ textAlign: "right", flexShrink: 0, minWidth: 70 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e6edf3", fontFamily: "monospace" }}>
                    {formatPrice(stock.last_close)}
                  </div>
                  {changePct !== null && (
                    <div style={{
                      fontSize: 10,
                      fontWeight: 600,
                      fontFamily: "monospace",
                      color: changePct >= 0 ? "#10b981" : "#ef4444",
                    }}>
                      {changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
