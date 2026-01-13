"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
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

  const ticker = useMemo(() => {
    const t = params?.ticker;
    return typeof t === "string" && t.length ? decodeURIComponent(t).toUpperCase() : "";
  }, [params]);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<VolatilityData | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 24 }}>
        <h1 style={{ fontSize: 32, fontWeight: 600, margin: 0, letterSpacing: "-0.02em" }}>
          Volatility Analysis: {ticker || "?"}
        </h1>
        <Link href="/stocks" style={{ color: "rgba(255,255,255,0.6)", textDecoration: "none", fontSize: 14 }}>
          ← Back to stocks
        </Link>
      </div>

      {loading && (
        <div
          style={{
            padding: 20,
            borderRadius: 4,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.02)",
            color: "rgba(255,255,255,0.6)",
            fontSize: 14,
          }}
        >
          Loading volatility data...
        </div>
      )}

      {!loading && error && (
        <div
          style={{
            padding: 20,
            borderRadius: 4,
            border: "1px solid rgba(220, 80, 80, 0.3)",
            background: "rgba(120, 0, 0, 0.15)",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6, color: "rgba(255, 150, 150, 1)" }}>
            Error
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>{error}</div>
        </div>
      )}

      {!loading && data && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
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
              highlight={data.percentiles.rolling20 > 75}
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
              highlight={data.percentiles.ewma94 > 75}
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

          <div
            style={{
              padding: 18,
              marginBottom: 24,
              borderRadius: 4,
              border: "1px solid rgba(100, 150, 200, 0.2)",
              background: "rgba(50, 80, 120, 0.08)",
            }}
          >
            <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "rgba(180, 210, 240, 1)", letterSpacing: "0.02em", textTransform: "uppercase" }}>
              Volatility Estimators
            </h3>
            <div style={{ fontSize: 13, lineHeight: 1.7, color: "rgba(255,255,255,0.7)" }}>
              <strong>Rolling Windows:</strong> Standard deviation over fixed periods. Slower to react to regime changes.
              <br />
              <strong>EWMA:</strong> Exponentially weighted moving average. Recent data weighted more heavily. Faster shock detection.
              <br />
              <strong>Parkinson:</strong> High-low range estimator. More efficient than close-to-close when intraday data available.
              <br />
              <strong>Garman-Klass:</strong> OHLC estimator. Most efficient for daily bar data.
            </div>
          </div>

          <div
            style={{
              padding: 20,
              marginBottom: 24,
              borderRadius: 4,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.02)",
            }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, letterSpacing: "0.01em" }}>
              Event Analysis
            </h2>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", marginBottom: 16 }}>
              Compare realized volatility before and after specific events (earnings releases, policy announcements, macro data).
            </p>

            <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
              <input
                type="date"
                value={newEventDate}
                onChange={(e) => setNewEventDate(e.target.value)}
                min={data.dateRange.start}
                max={data.dateRange.end}
                style={{
                  padding: "8px 12px",
                  borderRadius: 3,
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "rgba(0,0,0,0.3)",
                  color: "white",
                  fontSize: 13,
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
                  borderRadius: 3,
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "rgba(0,0,0,0.3)",
                  color: "white",
                  fontSize: 13,
                }}
              />
              <button
                onClick={addEvent}
                style={{
                  padding: "8px 20px",
                  borderRadius: 3,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(100,100,100,0.3)",
                  color: "white",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Add Event
              </button>
            </div>

            {events.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                {events.map((event) => (
                  <div
                    key={event.date}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "5px 10px",
                      borderRadius: 3,
                      background: "rgba(255,255,255,0.08)",
                      fontSize: 12,
                    }}
                  >
                    <span>{event.label}</span>
                    <button
                      onClick={() => removeEvent(event.date)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "rgba(200, 100, 100, 1)",
                        cursor: "pointer",
                        fontSize: 14,
                        padding: 0,
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {data.eventAnalysis && data.eventAnalysis.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: "left" }}>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.6)", fontWeight: 500, fontSize: 12, letterSpacing: "0.03em", textTransform: "uppercase" }}>
                        Event Date
                      </th>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.6)", fontWeight: 500, fontSize: 12, letterSpacing: "0.03em", textTransform: "uppercase" }}>
                        Before (30d)
                      </th>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.6)", fontWeight: 500, fontSize: 12, letterSpacing: "0.03em", textTransform: "uppercase" }}>
                        After (30d)
                      </th>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.6)", fontWeight: 500, fontSize: 12, letterSpacing: "0.03em", textTransform: "uppercase" }}>
                        Change
                      </th>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.6)", fontWeight: 500, fontSize: 12, letterSpacing: "0.03em", textTransform: "uppercase" }}>
                        Change %
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.eventAnalysis.map((event) => {
                      const isIncrease = event.change > 0;
                      return (
                        <tr key={event.date} style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                          <td style={{ padding: "10px 12px", color: "rgba(255,255,255,0.7)" }}>{event.date}</td>
                          <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "rgba(255,255,255,0.8)" }}>{fmtPct(event.before)}</td>
                          <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "rgba(255,255,255,0.8)" }}>{fmtPct(event.after)}</td>
                          <td
                            style={{
                              padding: "10px 12px",
                              fontFamily: "monospace",
                              color: isIncrease ? "rgba(200, 100, 100, 1)" : "rgba(80, 180, 80, 1)",
                            }}
                          >
                            {isIncrease ? "+" : ""}
                            {fmtPct(event.change)}
                          </td>
                          <td
                            style={{
                              padding: "10px 12px",
                              fontFamily: "monospace",
                              color: isIncrease ? "rgba(200, 100, 100, 1)" : "rgba(80, 180, 80, 1)",
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

          <div
            style={{
              padding: 20,
              borderRadius: 4,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.02)",
            }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, letterSpacing: "0.01em" }}>
              Volatility Time Series
            </h2>
            <VolatilityChart data={data.series} events={events} height={500} />
          </div>

          <div
            style={{
              marginTop: 24,
              padding: 18,
              borderRadius: 4,
              border: "1px solid rgba(150, 100, 200, 0.2)",
              background: "rgba(80, 50, 120, 0.08)",
            }}
          >
            <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "rgba(200, 180, 240, 1)", letterSpacing: "0.02em", textTransform: "uppercase" }}>
              Interpretation Notes
            </h3>
            <div style={{ fontSize: 13, lineHeight: 1.7, color: "rgba(255,255,255,0.7)" }}>
              <div style={{ marginBottom: 8 }}>
                <strong>High Percentile (&gt;75th):</strong> Current volatility elevated relative to historical distribution.
                Consider position sizing adjustments or wider risk controls.
              </div>
              <div style={{ marginBottom: 8 }}>
                <strong>EWMA Divergence:</strong> When EWMA rises faster than rolling windows, indicates recent volatility shock.
                Declining EWMA suggests volatility normalization.
              </div>
              <div>
                <strong>Event Impact:</strong> Post-event volatility increase &gt;20% suggests market-moving event.
                Calibrate expectations for similar future events accordingly.
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
  highlight,
}: {
  label: string;
  value: string;
  subtitle?: string;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 3,
        border: `1px solid ${highlight ? "rgba(200, 100, 100, 0.3)" : "rgba(255,255,255,0.08)"}`,
        background: highlight ? "rgba(120, 60, 60, 0.1)" : "rgba(255,255,255,0.02)",
      }}
    >
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 6, letterSpacing: "0.03em", textTransform: "uppercase" }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 600,
          color: highlight ? "rgba(220, 120, 120, 1)" : "rgba(255,255,255,0.95)",
          marginBottom: 4,
          fontFamily: "monospace",
        }}
      >
        {value}
      </div>
      {subtitle && (
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}