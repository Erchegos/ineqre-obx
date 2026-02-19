"use client";

import Link from "next/link";
import { useEffect, useState, useRef, useCallback } from "react";

type SystemStats = {
  securities: number;
  last_updated: string | null;
  data_points: number;
};

// Animated counter hook
function useCountUp(target: number, duration = 1500, enabled = false) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!enabled || target === 0) return;
    let start: number | null = null;
    const step = (ts: number) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setValue(Math.round(eased * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration, enabled]);
  return value;
}

// IntersectionObserver hook for scroll animations
function useScrollReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, visible };
}

export default function HomePage() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [heroVisible, setHeroVisible] = useState(false);

  useEffect(() => {
    // Trigger hero animation on mount
    requestAnimationFrame(() => setHeroVisible(true));

    async function fetchStats() {
      try {
        const res = await fetch("/api/stats", { method: "GET", cache: "no-store" });
        if (res.ok) setStats(await res.json());
      } catch (e) {
        console.error("Failed to fetch stats:", e);
      }
    }
    fetchStats();
  }, []);

  const securities = useCountUp(stats?.securities || 0, 1500, !!stats);
  const dataPoints = useCountUp(Number(stats?.data_points) || 0, 2000, !!stats);

  const lastUpdate = stats?.last_updated
    ? new Date(stats.last_updated).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
      })
    : '...';

  const modulesReveal = useScrollReveal();
  const capabilitiesReveal = useScrollReveal();
  const upcomingReveal = useScrollReveal();

  return (
    <>
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.3); }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .feature-card {
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          cursor: pointer;
        }
        .feature-card:hover {
          transform: translateY(-3px);
          border-color: var(--accent) !important;
          box-shadow: 0 8px 24px rgba(59, 130, 246, 0.12);
        }
        .cap-card {
          transition: all 0.2s ease;
        }
        .cap-card:hover {
          transform: translateY(-2px);
          border-color: var(--accent) !important;
          box-shadow: 0 4px 16px rgba(59, 130, 246, 0.08);
        }
        .tag-pill {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 3px;
          font-size: 10px;
          font-family: monospace;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
      `}</style>

      <main style={{
        minHeight: "100vh",
        background: "var(--background)",
        color: "var(--foreground)",
        padding: "48px 32px"
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>

          {/* Hero */}
          <header style={{
            marginBottom: 48,
            borderBottom: "1px solid var(--border)",
            paddingBottom: 32,
          }}>
            <div style={{
              fontSize: 11,
              fontFamily: "monospace",
              color: "var(--muted-foreground)",
              marginBottom: 16,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              opacity: heroVisible ? 1 : 0,
              transform: heroVisible ? "translateY(0)" : "translateY(12px)",
              transition: "all 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
            }}>
              Ola Slettebak / InEqRe v2.3 / Oslo Børs
            </div>
            <h1 style={{
              fontSize: 42,
              fontWeight: 700,
              marginBottom: 16,
              color: "var(--foreground)",
              letterSpacing: "-0.03em",
              fontFamily: "system-ui, -apple-system, sans-serif",
              opacity: heroVisible ? 1 : 0,
              transform: heroVisible ? "translateY(0)" : "translateY(20px)",
              transition: "all 0.7s cubic-bezier(0.4, 0, 0.2, 1) 0.1s",
            }}>
              Intelligence Equity Research
            </h1>
            <p style={{
              fontSize: 15,
              color: "var(--muted-foreground)",
              lineHeight: 1.7,
              maxWidth: 720,
              opacity: heroVisible ? 1 : 0,
              transform: heroVisible ? "translateY(0)" : "translateY(16px)",
              transition: "all 0.7s cubic-bezier(0.4, 0, 0.2, 1) 0.25s",
            }}>
              A quantitative equity research platform for Oslo Børs.
              Automated research aggregation with AI summarization, machine learning price predictions, factor-based backtesting, volatility modeling, and correlation analysis.
            </p>
          </header>

          {/* Animated Stats */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
            marginBottom: 56,
            opacity: heroVisible ? 1 : 0,
            transform: heroVisible ? "translateY(0)" : "translateY(16px)",
            transition: "all 0.7s cubic-bezier(0.4, 0, 0.2, 1) 0.4s",
          }}>
            <StatBox label="Securities Covered" value={stats ? securities : '...'} suffix="" />
            <StatBox label="OHLCV Data Points" value={stats ? dataPoints.toLocaleString() : '...'} suffix={stats ? "pts" : ""} />
            <StatBox label="Last Updated" value={lastUpdate} suffix="" live />
          </div>

          {/* Core Modules */}
          <section ref={modulesReveal.ref} style={{ marginBottom: 56 }}>
            <h2 style={{
              fontWeight: 700,
              marginBottom: 24,
              color: "var(--foreground)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontSize: 12,
              fontFamily: "monospace",
              opacity: modulesReveal.visible ? 1 : 0,
              transition: "opacity 0.5s ease",
            }}>
              // Explore
            </h2>

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 16
            }}>
              <FeatureCard
                href="/stocks"
                title="Stock Screener & Analytics"
                description="Browse 131 OSE securities with interactive price charts, candlestick patterns, and deep per-stock analytics including volatility models, Monte Carlo simulations, ML predictions, and mean-reversion channels."
                tags={[
                  { label: "Charts", color: "var(--accent)" },
                  { label: "ML", color: "var(--success)" },
                  { label: "Monte Carlo", color: "var(--info)" },
                ]}
                visible={modulesReveal.visible}
                delay={0}
              />
              <FeatureCard
                href="/research"
                title="Research Portal"
                description="AI-summarized broker research from Pareto Securities & DNB Markets. Full-text search across reports with PDF viewer. Automated email ingestion and Claude-powered summaries."
                tags={[
                  { label: "AI Summaries", color: "var(--success)" },
                  { label: "PDF", color: "var(--warning)" },
                ]}
                visible={modulesReveal.visible}
                delay={1}
              />
              <FeatureCard
                href="/correlation"
                title="Correlation Matrix"
                description="Interactive cross-sectional heatmap with configurable lookback windows (30d–2y). Rolling correlation time series and sector-level co-movement analysis."
                tags={[
                  { label: "Heatmap", color: "var(--info)" },
                  { label: "Rolling", color: "var(--accent)" },
                ]}
                visible={modulesReveal.visible}
                delay={2}
              />
              <FeatureCard
                href="/options"
                title="Options Analytics"
                description="Black-Scholes pricing with full Greeks chain. IV skew visualization, open interest distribution, and a multi-leg P&L strategy builder with time-decay payoff diagrams."
                tags={[
                  { label: "Greeks", color: "var(--success)" },
                  { label: "P&L Builder", color: "var(--accent)" },
                  { label: "IV Skew", color: "var(--warning)" },
                ]}
                visible={modulesReveal.visible}
                delay={3}
              />
            </div>
          </section>

          {/* Analytics Capabilities */}
          <section ref={capabilitiesReveal.ref} style={{ marginBottom: 56 }}>
            <h2 style={{
              fontWeight: 700,
              marginBottom: 24,
              color: "var(--foreground)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontSize: 12,
              fontFamily: "monospace",
              opacity: capabilitiesReveal.visible ? 1 : 0,
              transition: "opacity 0.5s ease",
            }}>
              // Analytics Engine
            </h2>

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 16
            }}>
              {[
                { title: "Volatility Estimation", accent: "var(--accent)", text: "Yang-Zhang, Rogers-Satchell, Parkinson & Garman-Klass estimators. Rolling windows (20/60/120-day), EWMA smoothing, historical percentile ranking, and regime detection." },
                { title: "Monte Carlo Simulation", accent: "var(--info)", text: "10,000-path GBM with configurable drift and volatility. Percentile bands (5th–95th), probability cones, and statistical scenario testing." },
                { title: "Risk Metrics", accent: "var(--danger)", text: "Max drawdown with recovery tracking, Sharpe ratio, market beta vs OBX, expected daily/weekly moves (1σ), and rolling benchmark correlation." },
                { title: "Std Deviation Channels", accent: "var(--success)", text: "Linear regression channels with ±1σ/±2σ bands. Auto-optimized windows (255–1530 bars) by R². Position classification and mean-reversion signals." },
                { title: "ML Price Predictions", accent: "var(--warning)", text: "Ridge regression on 17 factors (momentum, volatility, fundamentals). Walk-forward validation, daily signals (-1 to +1), probability-weighted forecasts." },
                { title: "Factor Backtesting", accent: "var(--accent)", text: "Strategy backtesting with signal thresholds and holding periods. Factor attribution, cumulative returns, hit rates, and per-ticker trade detail." },
                { title: "Time Series Analysis", accent: "var(--info)", text: "Log-return decomposition, ACF diagnostics, monthly seasonality patterns, and 30-day rolling volatility correlation with OBX index." },
                { title: "Research Aggregation", accent: "var(--success)", text: "Claude AI summarization via Anthropic API. IMAP ingestion from Pareto & DNB. PDF text extraction, document deduplication, and full-text search." },
                { title: "Options Analytics", accent: "var(--warning)", text: "Black-Scholes pricing, IV solver, multi-leg P&L with time decay. Max pain, put/call ratios, IV term structure. Editable positions with strike stepping." },
              ].map((cap, i) => (
                <CapabilityCard
                  key={cap.title}
                  title={cap.title}
                  accent={cap.accent}
                  visible={capabilitiesReveal.visible}
                  delay={i}
                >
                  {cap.text}
                </CapabilityCard>
              ))}
            </div>
          </section>

          {/* Upcoming Projects */}
          <section ref={upcomingReveal.ref} style={{ marginBottom: 56 }}>
            <h2 style={{
              fontWeight: 700,
              marginBottom: 24,
              color: "var(--foreground)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontSize: 12,
              fontFamily: "monospace",
              opacity: upcomingReveal.visible ? 1 : 0,
              transition: "opacity 0.5s ease",
            }}>
              // Upcoming
            </h2>

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 16
            }}>
              {[
                { title: "Commodities Integration", accent: "var(--warning)", text: "Brent crude, TTF/NBP gas, Nord Pool power, base metals. Cross-asset correlation with energy-exposed OSE equities. Sector beta decomposition and hedging ratios." },
                { title: "FX Hedging Analytics", accent: "var(--info)", text: "Multi-currency exposure for NOK portfolios. Forward rate pricing via IRP, carry trade P&L, optimal hedge ratios. Currency beta for export-heavy equities." },
                { title: "DCC-GARCH Correlation", accent: "var(--accent)", text: "Dynamic conditional correlation for time-varying co-movement. Copula models (Gaussian, Student-t) for tail dependence. VaR/CVaR and systemic risk indicators." },
                { title: "Portfolio Optimizer", accent: "var(--success)", text: "Mean-variance optimization, efficient frontier, risk parity. Sector constraints, position sizing, turnover limits. Backtesting with transaction costs." },
              ].map((cap, i) => (
                <CapabilityCard
                  key={cap.title}
                  title={cap.title}
                  accent={cap.accent}
                  visible={upcomingReveal.visible}
                  delay={i}
                >
                  {cap.text}
                </CapabilityCard>
              ))}
            </div>
          </section>

          {/* Tech Stack Footer */}
          <footer style={{
            paddingTop: 28,
            borderTop: "1px solid var(--border)",
            fontSize: 11.5,
            color: "var(--muted-foreground)",
            fontFamily: "monospace"
          }}>
            <p style={{ marginBottom: 8, lineHeight: 1.6 }}>
              <strong style={{ color: "var(--foreground)", fontWeight: 700 }}>Tech Stack:</strong> Next.js 16 · TypeScript · PostgreSQL 17 · Drizzle ORM · Python · scikit-learn · Interactive Brokers TWS API · Anthropic Claude API
            </p>
            <p style={{ marginBottom: 8, lineHeight: 1.6 }}>
              <strong style={{ color: "var(--foreground)", fontWeight: 700 }}>Architecture:</strong> Server-side compute · Connection pooling · Transaction pooler (Supabase) · JWT authentication · Vercel edge deployment
            </p>
            <p style={{ lineHeight: 1.6 }}>
              <strong style={{ color: "var(--foreground)", fontWeight: 700 }}>Data:</strong> Real-time OHLCV ingestion via IBKR · 160K+ daily data points · Supabase storage for PDF attachments
            </p>
          </footer>

        </div>
      </main>
    </>
  );
}

// ─── Sub-components ──────────────────────────────────────────────

function StatBox({ label, value, suffix, live }: { label: string; value: string | number; suffix: string; live?: boolean }) {
  return (
    <div style={{
      background: "var(--card-bg)",
      border: "1px solid var(--border)",
      borderRadius: 4,
      padding: "18px 20px"
    }}>
      <div style={{
        fontSize: 10,
        color: "var(--muted-foreground)",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        marginBottom: 10,
        fontWeight: 700,
        fontFamily: "monospace",
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}>
        {label}
        {live && (
          <span style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--success)",
            display: "inline-block",
            animation: "pulse 2s ease-in-out infinite",
          }} />
        )}
      </div>
      <div style={{
        fontSize: 28,
        fontWeight: 700,
        color: "var(--foreground)",
        fontFamily: "monospace",
        display: "flex",
        alignItems: "baseline",
        gap: 4
      }}>
        {value}
        {suffix && (
          <span style={{ fontSize: 12, color: "var(--muted-foreground)", fontWeight: 500 }}>
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function FeatureCard({ href, title, description, tags, visible, delay }: {
  href: string;
  title: string;
  description: string;
  tags: { label: string; color: string }[];
  visible: boolean;
  delay: number;
}) {
  return (
    <Link
      href={href}
      className="feature-card"
      style={{
        display: "block",
        background: "var(--card-bg)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: "22px 24px",
        textDecoration: "none",
        color: "inherit",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(20px)",
        transition: `opacity 0.5s ease ${delay * 0.1}s, transform 0.5s ease ${delay * 0.1}s, border-color 0.25s ease, box-shadow 0.25s ease`,
      }}
    >
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {tags.map(t => (
          <span key={t.label} className="tag-pill" style={{
            background: `color-mix(in srgb, ${t.color} 15%, transparent)`,
            color: t.color,
          }}>
            {t.label}
          </span>
        ))}
      </div>
      <h3 style={{
        fontSize: 16,
        fontWeight: 700,
        marginBottom: 8,
        color: "var(--foreground)",
        fontFamily: "monospace",
        letterSpacing: "0.01em"
      }}>
        {title}
      </h3>
      <p style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.65 }}>
        {description}
      </p>
    </Link>
  );
}

function CapabilityCard({ title, accent, children, visible, delay }: {
  title: string;
  accent: string;
  children: React.ReactNode;
  visible: boolean;
  delay: number;
}) {
  return (
    <div
      className="cap-card"
      style={{
        background: "var(--card-bg)",
        border: "1px solid var(--border)",
        borderRadius: 4,
        padding: "14px 16px",
        borderLeft: `3px solid ${accent}`,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(16px)",
        transition: `opacity 0.4s ease ${delay * 0.08}s, transform 0.4s ease ${delay * 0.08}s, border-color 0.2s ease, box-shadow 0.2s ease`,
      }}
    >
      <h4 style={{
        fontSize: 12,
        fontWeight: 700,
        marginBottom: 10,
        color: "var(--foreground)",
        fontFamily: "monospace",
        letterSpacing: "0.03em"
      }}>
        {title}
      </h4>
      <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.65 }}>
        {children}
      </p>
    </div>
  );
}
