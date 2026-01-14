"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import VolatilityChart from "@/components/VolatilityChart";

type VolatilityData = {
  ticker: string;
  count: number;
  current: {
    date: string;
    historical: number | null;
    rolling20: number | null;
    rolling60: number | null;
    rolling120: number | null;
    ewma94: number | null;
    ewma97: number | null;
    parkinson: number | null;
    garmanKlass: number | null;
  };
  percentiles: {
    rolling20: number | null;
    rolling60: number | null;
    rolling120: number | null;
    ewma94: number | null;
    ewma97: number | null;
    parkinson: number | null;
    garmanKlass: number | null;
  };
  series: Array<{
    date: string;
    historical?: number;
    rolling20?: number;
    rolling60?: number;
    rolling120?: number;
    ewma94?: number;
    ewma97?: number;
    parkinson?: number;
    garmanKlass?: number;
  }>;
  eventAnalysis?: Array<{
    date: string;
    before: number;
    after: number;
    change: number;
    changePercent: number;
  }>;
  dateRange: {
    start: string;
    end: string;
  };
};

const MEASURE_COLORS: Record<string, string> = {
  rolling20: "#3b82f6",
  rolling60: "#10b981",
  rolling120: "#f59e0b",
  ewma94: "#8b5cf6",
  ewma97: "#ec4899",
  parkinson: "#ef4444",
  garmanKlass: "#06b6d4",
};

const MEASURE_NAMES: Record<string, string> = {
  rolling20: "20-Day Rolling",
  rolling60: "60-Day Rolling",
  rolling120: "120-Day Rolling",
  ewma94: "EWMA (λ=0.94)",
  ewma97: "EWMA (λ=0.97)",
  parkinson: "Parkinson",
  garmanKlass: "Garman-Klass",
};

const MEASURE_INFO = {
  historical: { label: "HISTORICAL (FULL SAMPLE)", desc: "Close-to-close" },
  rolling20: { label: "20-DAY ROLLING", desc: "59th percentile" },
  rolling60: { label: "60-DAY ROLLING", desc: "Medium-term" },
  rolling120: { label: "120-DAY ROLLING", desc: "Long-term" },
  ewma94: { label: "EWMA (λ=0.94)", desc: "67th percentile" },
  ewma97: { label: "EWMA (λ=0.97)", desc: "Slower decay" },
  parkinson: { label: "PARKINSON (H-L)", desc: "Range-based" },
  garmanKlass: { label: "GARMAN-KLASS", desc: "OHLC-based" },
};

function clampInt(v: string | null, def: number, min: number, max: number) {
  const n = v ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

export default function VolatilityPage() {
  const params = useParams<{ ticker?: string }>();
  const searchParams = useSearchParams();

  const ticker = useMemo(() => {
    const t = params?.ticker;
    return typeof t === "string" && t.length ? decodeURIComponent(t).toUpperCase() : "";
  }, [params]);

  const initialLimit = useMemo(() => {
    return clampInt(searchParams.get("limit"), 1500, 100, 2000);
  }, [searchParams]);

  const [limit, setLimit] = useState<number>(initialLimit);
  const [loading, setLoading] = useState<boolean>(true);
  const [data, setData] = useState<VolatilityData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedMeasures, setSelectedMeasures] = useState<string[]>([
    "rolling20",
    "rolling60",
    "ewma94",
    "parkinson",
  ]);

  const [eventDate, setEventDate] = useState<string>("");
  const [eventLabel, setEventLabel] = useState<string>("");
  const [events, setEvents] = useState<Array<{ date: string; label: string }>>([]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!ticker) {
        setLoading(false);
        setData(null);
        setError("Missing ticker in route params.");
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const url = `/api/volatility/${encodeURIComponent(ticker)}?limit=${limit}`;
        const res = await fetch(url, {
          method: "GET",
          headers: { accept: "application/json" },
          cache: "no-store",
        });

        if (!res.ok) {
          const text = await res.text();
          if (!cancelled) {
            setError(`Volatility API failed (${res.status} ${res.statusText}): ${text}`);
            setData(null);
          }
          return;
        }

        const json = (await res.json()) as VolatilityData;

        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? String(e));
          setData(null);
          setLoading(false);
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [ticker, limit]);

  const toggleMeasure = (measure: string) => {
    setSelectedMeasures((prev) =>
      prev.includes(measure) ? prev.filter((m) => m !== measure) : [...prev, measure]
    );
  };

  const handleAddEvent = () => {
    if (eventDate) {
      setEvents((prev) => [...prev, { date: eventDate, label: eventLabel || eventDate }]);
      setEventDate("");
      setEventLabel("");
    }
  };

  const handleRemoveEvent = (date: string) => {
    setEvents((prev) => prev.filter((e) => e.date !== date));
  };

  if (loading) {
    return (
      <main style={{ padding: 24, background: "var(--background)", minHeight: "100vh" }}>
        <div style={{ color: "var(--muted)", fontSize: 14 }}>Loading volatility data...</div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main style={{ padding: 24, background: "var(--background)", minHeight: "100vh" }}>
        <div style={{ color: "var(--danger)", fontSize: 14 }}>Error: {error || "No data"}</div>
      </main>
    );
  }

  return (
    <main style={{ padding: 24, maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 32, fontWeight: 600, margin: 0, letterSpacing: "-0.02em", color: "var(--foreground)" }}>
          {data.ticker}
        </h1>
        <Link
          href={`/stocks/${data.ticker}`}
          style={{ color: "var(--muted)", textDecoration: "none", fontSize: 14 }}
        >
          ← Back to {data.ticker}
        </Link>
      </div>

      <div style={{ color: "var(--muted)", fontSize: 14, marginBottom: 32 }}>Volatility Analysis</div>

      {/* Timeframe Selector */}
      <div style={{ marginBottom: 24, display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 13, color: "var(--muted)", letterSpacing: "0.02em", textTransform: "uppercase" }}>
          Timeframe
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          {[
            { label: "6M", value: 126 },
            { label: "1Y", value: 252 },
            { label: "2Y", value: 504 },
            { label: "3Y", value: 756 },
            { label: "5Y", value: 1260 },
            { label: "Max", value: 2000 },
          ].map((tf) => (
            <button
              key={tf.value}
              onClick={() => setLimit(tf.value)}
              style={{
                padding: "6px 12px",
                borderRadius: 3,
                border: `1px solid ${limit === tf.value ? "var(--accent)" : "var(--input-border)"}`,
                background: limit === tf.value ? "var(--accent)" : "var(--input-bg)",
                color: limit === tf.value ? "#ffffff" : "var(--foreground)",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {/* Current Volatility */}
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, letterSpacing: "0.01em", color: "var(--foreground)" }}>
          Current Volatility
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          {Object.entries(data.current).map(([key, value]) => {
            if (key === "date" || value === null || typeof value !== 'number') return null;
            const info = MEASURE_INFO[key as keyof typeof MEASURE_INFO];
            if (!info) return null;
            const percentile = data.percentiles[key as keyof typeof data.percentiles];
            return (
              <div
                key={key}
                style={{
                  padding: 14,
                  borderRadius: 3,
                  border: "1px solid var(--card-border)",
                  background: "var(--card-bg)",
                }}
              >
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6, letterSpacing: "0.03em", textTransform: "uppercase" }}>
                  {info.label}
                </div>
                <div style={{ fontSize: 22, fontWeight: 600, fontFamily: "monospace", color: "var(--foreground)" }}>
                  {(value * 100).toFixed(2)}%
                </div>
                <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 4 }}>
                  {info.desc}
                  {percentile !== null && percentile !== undefined && (
                    <span> • {percentile.toFixed(0)}th percentile</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sample Info */}
      <div style={{ marginBottom: 24, color: "var(--muted)", fontSize: 12, letterSpacing: "0.02em" }}>
        Sample: {data.dateRange.start} to {data.dateRange.end} ({data.count} observations)
      </div>

      {/* Explanations */}
      <div
        style={{
          marginBottom: 24,
          padding: 20,
          borderRadius: 4,
          border: "1px solid var(--card-border)",
          background: "var(--card-bg)",
        }}
      >
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, letterSpacing: "0.03em", textTransform: "uppercase", color: "var(--foreground)" }}>
          Volatility Estimators
        </h3>
        <div style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
          <p style={{ marginBottom: 8 }}>
            <strong style={{ color: "var(--foreground)" }}>Rolling Windows:</strong> Standard deviation over fixed periods. Slower to react to regime changes.
          </p>
          <p style={{ marginBottom: 8 }}>
            <strong style={{ color: "var(--foreground)" }}>EWMA:</strong> Exponentially weighted moving average. Recent data weighted more heavily. Faster shock detection.
          </p>
          <p style={{ marginBottom: 8 }}>
            <strong style={{ color: "var(--foreground)" }}>Parkinson:</strong> High-low range estimator. More efficient than close-to-close when intraday data available.
          </p>
          <p style={{ margin: 0 }}>
            <strong style={{ color: "var(--foreground)" }}>Garman-Klass:</strong> OHLC estimator. Most efficient for daily bar data.
          </p>
        </div>
      </div>

      {/* Volatility Time Series */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, letterSpacing: "0.01em", color: "var(--foreground)" }}>
          Volatility Time Series
        </h2>

        {/* Measure Toggles */}
        <div style={{ marginBottom: 16, display: "flex", flexWrap: "wrap", gap: 12 }}>
          {Object.keys(MEASURE_NAMES).map((measure) => {
            const isSelected = selectedMeasures.includes(measure);
            const color = MEASURE_COLORS[measure];
            return (
              <button
                key={measure}
                onClick={() => toggleMeasure(measure)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 20,
                  border: `2px solid ${isSelected ? color : "rgba(128,128,128,0.3)"}`,
                  background: isSelected ? `${color}22` : "transparent",
                  color: "var(--foreground)",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: "all 0.2s",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  opacity: isSelected ? 1 : 0.5,
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: color,
                    display: "inline-block",
                  }}
                />
                {MEASURE_NAMES[measure]}
              </button>
            );
          })}
        </div>

        <div
          style={{
            padding: 20,
            borderRadius: 4,
            border: "1px solid var(--card-border)",
            background: "var(--card-bg)",
          }}
        >
          <VolatilityChart data={data.series} selectedMeasures={selectedMeasures} height={400} />
        </div>
      </div>

      {/* Event Analysis */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, letterSpacing: "0.01em", color: "var(--foreground)" }}>
          Event Analysis
        </h2>
        <div
          style={{
            padding: 20,
            borderRadius: 4,
            border: "1px solid var(--card-border)",
            background: "var(--card-bg)",
          }}
        >
          <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>
            Compare realized volatility before and after specific events (earnings releases, policy announcements, macro data).
          </p>

          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <input
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              style={{
                padding: "8px 12px",
                borderRadius: 3,
                border: "1px solid var(--input-border)",
                background: "var(--input-bg)",
                color: "var(--foreground)",
                fontSize: 13,
                fontFamily: "inherit",
              }}
            />
            <input
              type="text"
              value={eventLabel}
              onChange={(e) => setEventLabel(e.target.value)}
              placeholder="Event label (optional)"
              style={{
                flex: 1,
                minWidth: 200,
                padding: "8px 12px",
                borderRadius: 3,
                border: "1px solid var(--input-border)",
                background: "var(--input-bg)",
                color: "var(--foreground)",
                fontSize: 13,
                fontFamily: "inherit",
              }}
            />
            <button
              onClick={handleAddEvent}
              disabled={!eventDate}
              style={{
                padding: "8px 20px",
                borderRadius: 3,
                border: "none",
                background: eventDate ? "var(--accent)" : "var(--muted)",
                color: "#ffffff",
                fontSize: 13,
                fontWeight: 500,
                cursor: eventDate ? "pointer" : "not-allowed",
                transition: "all 0.15s",
              }}
            >
              Add Event
            </button>
          </div>

          {events.length > 0 && (
            <div style={{ marginTop: 16 }}>
              {events.map((event) => (
                <div
                  key={event.date}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: 12,
                    marginBottom: 8,
                    background: "var(--hover-bg)",
                    borderRadius: 3,
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: "var(--foreground)" }}>{event.date}</div>
                    {event.label && <div style={{ color: "var(--muted)", fontSize: 13 }}>{event.label}</div>}
                  </div>
                  <button
                    onClick={() => handleRemoveEvent(event.date)}
                    style={{
                      padding: "4px 12px",
                      borderRadius: 3,
                      border: "1px solid var(--danger)",
                      background: "transparent",
                      color: "var(--danger)",
                      fontSize: 12,
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}