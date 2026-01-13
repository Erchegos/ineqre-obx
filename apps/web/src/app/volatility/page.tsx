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
    historical: number;
    rolling20: number;
    rolling60: number;
    rolling120: number;
    ewma94: number;
    ewma97: number;
    parkinson: number;
    garmanKlass: number;
  };
  percentiles: {
    rolling20: number;
    ewma94: number;
  };
  series: Array<{
    date: string;
    historical: number;
    rolling20: number;
    rolling60: number;
    rolling120: number;
    ewma94: number;
    ewma97: number;
    parkinson: number;
    garmanKlass: number;
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

type EventInput = {
  date: string;
  label: string;
};

function fmtPct(x: number | null, digits = 2): string {
  if (x === null || !Number.isFinite(x)) return "NA";
  return (x * 100).toFixed(digits) + "%";
}

function fmtNum(x: number | null, digits = 2): string {
  if (x === null || !Number.isFinite(x)) return "NA";
  return x.toFixed(digits);
}

export default function VolatilityPage() {
  const params = useParams<{ ticker?: string }>();
  const searchParams = useSearchParams();

  const ticker = useMemo(() => {
    const t = params?.ticker;
    return typeof t === "string" && t.length ? decodeURIComponent(t).toUpperCase() : "";
  }, [params]);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<VolatilityData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Event management
  const [events, setEvents] = useState<EventInput[]>([]);
  const [newEventDate, setNewEventDate] = useState("");
  const [newEventLabel, setNewEventLabel] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      if (!ticker) {
        setLoading(false);
        setError("Missing ticker");
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const eventDatesParam = events.map(e => e.date).join(",");
        const url = `/api/volatility/${encodeURIComponent(ticker)}?limit=500${
          eventDatesParam ? `&events=${eventDatesParam}` : ""
        }`;

        const res = await fetch(url, {
          method: "GET",
          headers: { accept: "application/json" },
          cache: "no-store",
        });

        if (!res.ok) {
          const text = await res.text();
          if (!cancelled) {
            setError(`API failed: ${text}`);
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

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [ticker, events]);

  const addEvent = () => {
    if (!newEventDate) return;
    setEvents([...events, { date: newEventDate, label: newEventLabel || newEventDate }]);
    setNewEventDate("");
    setNewEventLabel("");
  };

  const removeEvent = (date: string) => {
    setEvents(events.filter(e => e.date !== date));
  };

  return (
    <main style={{ padding: 24, maxWidth: 1600, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 24 }}>
        <h1 style={{ fontSize: 36, fontWeight: 800, margin: 0 }}>
          Volatility Estimator: {ticker || "?"}
        </h1>
        <Link href="/stocks" style={{ color: "rgba(255,255,255,0.7)", textDecoration: "none" }}>
          ← Back to stocks
        </Link>
      </div>

      {loading && (
        <div
          style={{
            padding: 20,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.04)",
          }}
        >
          Loading volatility data...
        </div>
      )}

      {!loading && error && (
        <div
          style={{
            padding: 20,
            borderRadius: 12,
            border: "1px solid rgba(255,140,140,0.35)",
            background: "rgba(120,0,0,0.22)",
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Error</div>
          <div>{error}</div>
        </div>
      )}

      {!loading && data && (
        <>
          {/* Current Volatility Metrics */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 16,
              marginBottom: 32,
            }}
          >
            <MetricCard
              label="Historical (Full Sample)"
              value={fmtPct(data.current.historical)}
              subtitle="Close-to-close"
            />
            <MetricCard
              label="20-Day Rolling"
              value={fmtPct(data.current.rolling20)}
              subtitle={`${fmtNum(data.percentiles.rolling20, 0)}th percentile`}
              color={data.percentiles.rolling20 > 75 ? "rgba(239, 68, 68, 0.9)" : undefined}
            />
            <MetricCard
              label="60-Day Rolling"
              value={fmtPct(data.current.rolling60)}
              subtitle="Medium-term"
            />
            <MetricCard
              label="EWMA (λ=0.94)"
              value={fmtPct(data.current.ewma94)}
              subtitle={`${fmtNum(data.percentiles.ewma94, 0)}th percentile`}
              color={data.percentiles.ewma94 > 75 ? "rgba(239, 68, 68, 0.9)" : undefined}
            />
            <MetricCard
              label="Parkinson (H-L)"
              value={fmtPct(data.current.parkinson)}
              subtitle="Range-based"
            />
            <MetricCard
              label="Garman-Klass"
              value={fmtPct(data.current.garmanKlass)}
              subtitle="OHLC-based"
            />
          </div>

          {/* Info Box */}
          <div
            style={{
              padding: 20,
              marginBottom: 24,
              borderRadius: 12,
              border: "1px solid rgba(59, 130, 246, 0.3)",
              background: "rgba(59, 130, 246, 0.05)",
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, color: "rgba(147, 197, 253, 1)" }}>
              Understanding Volatility Measures
            </h3>
            <div style={{ fontSize: 14, lineHeight: 1.6, color: "rgba(255,255,255,0.8)" }}>
              <strong>Rolling Windows (20/60/120d):</strong> Standard deviation over fixed periods.
              Slower to react to regime changes.
              <br />
              <strong>EWMA (λ=0.94/0.97):</strong> Exponentially weighted - recent data has more impact.
              Faster to detect volatility shocks.
              <br />
              <strong>Parkinson:</strong> Uses high-low range. More efficient than close-to-close when intraday data available.
              <br />
              <strong>Garman-Klass:</strong> Uses OHLC data. Most efficient estimator for daily bars.
            </div>
          </div>

          {/* Event Comparison Tool */}
          <div
            style={{
              padding: 20,
              marginBottom: 24,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>
              Event Comparison
            </h2>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.7)", marginBottom: 16 }}>
              Compare volatility before and after specific events (e.g., earnings, CPI releases, central bank meetings).
            </p>

            {/* Add Event Form */}
            <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
              <input
                type="date"
                value={newEventDate}
                onChange={(e) => setNewEventDate(e.target.value)}
                min={data.dateRange.start}
                max={data.dateRange.end}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(0,0,0,0.25)",
                  color: "white",
                  fontSize: 14,
                }}
              />
              <input
                type="text"
                placeholder="Event label (optional)"
                value={newEventLabel}
                onChange={(e) => setNewEventLabel(e.target.value)}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(0,0,0,0.25)",
                  color: "white",
                  fontSize: 14,
                }}
              />
              <button
                onClick={addEvent}
                style={{
                  padding: "8px 20px",
                  borderRadius: 8,
                  border: "none",
                  background: "rgba(59, 130, 246, 1)",
                  color: "white",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Add Event
              </button>
            </div>

            {/* Event List */}
            {events.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                {events.map((event) => (
                  <div
                    key={event.date}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 12px",
                      borderRadius: 8,
                      background: "rgba(255,255,255,0.08)",
                      fontSize: 13,
                    }}
                  >
                    <span>{event.label}</span>
                    <button
                      onClick={() => removeEvent(event.date)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "rgba(239, 68, 68, 1)",
                        cursor: "pointer",
                        fontSize: 16,
                        padding: 0,
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Event Analysis Results */}
            {data.eventAnalysis && data.eventAnalysis.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr style={{ textAlign: "left" }}>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                        Event Date
                      </th>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                        Before (30d)
                      </th>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                        After (30d)
                      </th>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                        Change
                      </th>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                        Change %
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.eventAnalysis.map((event) => {
                      const isIncrease = event.change > 0;
                      return (
                        <tr key={event.date} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                          <td style={{ padding: "10px 12px" }}>{event.date}</td>
                          <td style={{ padding: "10px 12px" }}>{fmtPct(event.before)}</td>
                          <td style={{ padding: "10px 12px" }}>{fmtPct(event.after)}</td>
                          <td
                            style={{
                              padding: "10px 12px",
                              color: isIncrease ? "rgba(239, 68, 68, 1)" : "rgba(34, 197, 94, 1)",
                            }}
                          >
                            {isIncrease ? "+" : ""}
                            {fmtPct(event.change)}
                          </td>
                          <td
                            style={{
                              padding: "10px 12px",
                              color: isIncrease ? "rgba(239, 68, 68, 1)" : "rgba(34, 197, 94, 1)",
                            }}
                          >
                            {isIncrease ? "+" : ""}
                            {fmtNum(event.changePercent, 1)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Volatility Chart */}
          <div
            style={{
              padding: 20,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>
              Volatility Over Time
            </h2>
            <VolatilityChart data={data.series} events={events} height={500} />
          </div>

          {/* Interpretation Guide */}
          <div
            style={{
              marginTop: 24,
              padding: 20,
              borderRadius: 12,
              border: "1px solid rgba(168, 85, 247, 0.3)",
              background: "rgba(168, 85, 247, 0.05)",
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, color: "rgba(216, 180, 254, 1)" }}>
              Interpretation Guide
            </h3>
            <div style={{ fontSize: 14, lineHeight: 1.7, color: "rgba(255,255,255,0.8)" }}>
              <div style={{ marginBottom: 8 }}>
                <strong>High Percentile (&gt;75th):</strong> Current volatility is elevated compared to history.
                Consider reducing position sizes or using wider stops.
              </div>
              <div style={{ marginBottom: 8 }}>
                <strong>Divergence:</strong> When EWMA rises faster than rolling windows, it signals a recent
                volatility shock. When it falls faster, volatility is normalizing.
              </div>
              <div>
                <strong>Event Impact:</strong> Post-event volatility increase &gt;20% suggests the event was
                market-moving. Use this to calibrate expectations for similar future events.
              </div>
            </div>
          </div>
        </>
      )}
    </main>
  );
}

function MetricCard({
  label,
  value,
  subtitle,
  color,
}: {
  label: string;
  value: string;
  subtitle?: string;
  color?: string;
}) {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(255,255,255,0.03)",
      }}
    >
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginBottom: 6 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          color: color || "rgba(255,255,255,0.95)",
          marginBottom: 4,
        }}
      >
        {value}
      </div>
      {subtitle && (
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}