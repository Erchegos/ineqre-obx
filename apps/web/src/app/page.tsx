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
        const res = await fetch("/api/stats", { method: "GET" });
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
      `}</style>

      <main style={{
        minHeight: "100vh",
        background: "#0d1117",
        color: "#e6edf3",
        padding: "32px 16px"
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>

          {/* Hero */}
          <header style={{
            marginBottom: 48,
            borderBottom: "1px solid #21262d",
            paddingBottom: 32,
          }}>
            <div style={{
              fontSize: 11,
              fontFamily: "monospace",
              color: "#8b949e",
              marginBottom: 16,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              opacity: heroVisible ? 1 : 0,
              transform: heroVisible ? "translateY(0)" : "translateY(12px)",
              transition: "all 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
            }}>
              Ola Slettebak / InEqRe v3.0 / Oslo Børs
            </div>
            <h1 style={{
              fontSize: 28,
              fontWeight: 700,
              marginBottom: 16,
              color: "#e6edf3",
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
              color: "#8b949e",
              lineHeight: 1.7,
              maxWidth: 720,
              fontFamily: "system-ui, -apple-system, sans-serif",
              opacity: heroVisible ? 1 : 0,
              transform: heroVisible ? "translateY(0)" : "translateY(16px)",
              transition: "all 0.7s cubic-bezier(0.4, 0, 0.2, 1) 0.25s",
            }}>
              Quantitative equity research platform covering 225+ securities on Oslo Børs.
              ML price predictions with 19-factor ensemble models, GARCH/MSGARCH volatility regime detection, Monte Carlo simulations, mean-reversion channels, options analytics, portfolio optimization, and AI-summarized broker research from 6 sources.
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

          {/* Active Stock Research */}
          <section ref={modulesReveal.ref} style={{ marginBottom: 48 }}>
            <h2 style={{
              fontWeight: 600,
              marginBottom: 24,
              color: "#8b949e",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontSize: 12,
              fontFamily: "system-ui, -apple-system, sans-serif",
              opacity: modulesReveal.visible ? 1 : 0,
              transition: "opacity 0.5s ease",
            }}>
              Active Stock Research
            </h2>

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 16
            }}>
              <FeatureCard
                href="/stocks"
                title="Stock Screener & Analytics"
                description="Browse 225+ OSE securities with interactive price charts, candlestick patterns, volatility models, Monte Carlo simulations, and ML predictions. Upload Excel financial models for full-screen editing with persistent cloud storage."
                tags={[
                  { label: "Charts", color: "#3b82f6" },
                  { label: "Excel Models", color: "#10b981" },
                  { label: "ML", color: "#06b6d4" },
                ]}
                visible={modulesReveal.visible}
                delay={0}
              />
              <FeatureCard
                href="/research"
                title="Research Portal"
                description="AI-summarized broker research from Pareto Securities, DNB Carnegie, DNB Markets, Redeye, and Xtrainvestor. Full-text search across 1,500+ reports with PDF viewer. Automated email ingestion, web scraping, and Claude-powered English summaries."
                tags={[
                  { label: "AI Summaries", color: "#10b981" },
                  { label: "PDF", color: "#f59e0b" },
                  { label: "6 Sources", color: "#06b6d4" },
                ]}
                visible={modulesReveal.visible}
                delay={1}
              />
              <FeatureCard
                href="/news"
                title="Intelligence Terminal"
                description="Real-time market intelligence hub. AI-classified NewsWeb filings with sentiment analysis, Finanstilsynet short positions with sparklines, commodity prices (Brent, gas, metals) with stock sensitivity betas."
                tags={[
                  { label: "Shorts", color: "#ef4444" },
                  { label: "Commodities", color: "#f59e0b" },
                  { label: "Live", color: "#10b981" },
                ]}
                visible={modulesReveal.visible}
                delay={2}
              />
            </div>
          </section>

          {/* Quantitative Analytics */}
          <section style={{ marginBottom: 48 }}>
            <h2 style={{
              fontWeight: 600,
              marginBottom: 24,
              color: "#8b949e",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontSize: 12,
              fontFamily: "system-ui, -apple-system, sans-serif",
              opacity: modulesReveal.visible ? 1 : 0,
              transition: "opacity 0.5s ease",
            }}>
              Quantitative Analytics & Portfolio Tools
            </h2>

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 16
            }}>
              <FeatureCard
                href="/volatility/obx"
                title="OBX Volatility Dashboard"
                description="Index-level volatility intelligence with 6-regime classification (Crisis to Low & Stable). Constituent heatmap, vol cone (5th-95th percentile), systemic risk via rolling correlation, GARCH/MSGARCH models."
                tags={[
                  { label: "Regime", color: "#f59e0b" },
                  { label: "GARCH", color: "#3b82f6" },
                  { label: "Systemic", color: "#06b6d4" },
                ]}
                visible={modulesReveal.visible}
                delay={3}
              />
              <FeatureCard
                href="/correlation"
                title="Correlation Matrix"
                description="Interactive cross-sectional heatmap with configurable lookback windows (30d-2y). Rolling correlation time series, sector-level co-movement analysis, and pairwise regime-conditional correlations."
                tags={[
                  { label: "Heatmap", color: "#06b6d4" },
                  { label: "Rolling", color: "#3b82f6" },
                ]}
                visible={modulesReveal.visible}
                delay={4}
              />
              <FeatureCard
                href="/options"
                title="Options Analytics"
                description="Black-Scholes pricing with full Greeks chain for US-listed OSE stocks. IV skew visualization, open interest distribution, max pain, put/call ratios, and a multi-leg P&L strategy builder with preset strategies."
                tags={[
                  { label: "Greeks", color: "#10b981" },
                  { label: "P&L Builder", color: "#3b82f6" },
                  { label: "IV Skew", color: "#f59e0b" },
                ]}
                visible={modulesReveal.visible}
                delay={5}
              />
              <FeatureCard
                href="/portfolio"
                title="Portfolio Optimizer"
                description="Markowitz mean-variance optimization with 5 modes (EW, MinVar, MaxSharpe, RiskParity, MaxDiv). Efficient frontier, Ledoit-Wolf covariance, risk decomposition, 6-source alpha signals, and regime-aware stress scenarios."
                tags={[
                  { label: "Optimization", color: "#10b981" },
                  { label: "ML Signals", color: "#3b82f6" },
                  { label: "Risk", color: "#f59e0b" },
                ]}
                visible={modulesReveal.visible}
                delay={6}
              />
              <FeatureCard
                href="/fx"
                title="FX Terminal"
                description="Currency risk terminal for NOK portfolios. Multi-currency regression betas, forward curves via IRP, revenue/cost exposure decomposition, portfolio FX VaR, carry trade analytics, and interactive hedge calculators."
                tags={[
                  { label: "NOK/FX", color: "#f59e0b" },
                  { label: "IRP", color: "#3b82f6" },
                  { label: "Hedging", color: "#10b981" },
                ]}
                visible={modulesReveal.visible}
                delay={7}
              />
            </div>
          </section>

          {/* Sector Intelligence */}
          <section style={{ marginBottom: 48 }}>
            <h2 style={{
              fontWeight: 600,
              marginBottom: 24,
              color: "#8b949e",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontSize: 12,
              fontFamily: "system-ui, -apple-system, sans-serif",
              opacity: modulesReveal.visible ? 1 : 0,
              transition: "opacity 0.5s ease",
            }}>
              Sector Intelligence
            </h2>

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 16
            }}>
              <FeatureCard
                href="/seafood"
                title="Seafood Intelligence"
                description="Norwegian aquaculture dashboard. Salmon spot/forward prices, sea lice monitoring, production area traffic lights, disease outbreaks, company risk matrix, biomass tracking, and live wellboat harvest detection via AIS."
                tags={[
                  { label: "Salmon", color: "#f59e0b" },
                  { label: "Lice", color: "#ef4444" },
                  { label: "Harvest", color: "#10b981" },
                ]}
                visible={modulesReveal.visible}
                delay={8}
              />
              <FeatureCard
                href="/shipping"
                title="Shipping Intelligence"
                description="OSE shipping terminal. Fleet tracking on global map with vessel-level charter rates, BDI/BDTI/BCTI indices, rate exposure matrix, contract expiry tracking, and quarterly TCE comparison across 10 companies."
                tags={[
                  { label: "Fleet Map", color: "#06b6d4" },
                  { label: "Rates", color: "#f59e0b" },
                  { label: "10 Companies", color: "#10b981" },
                ]}
                visible={modulesReveal.visible}
                delay={9}
              />
            </div>
          </section>

          {/* Analytics Capabilities */}
          <section ref={capabilitiesReveal.ref} style={{ marginBottom: 56 }}>
            <h2 style={{
              fontWeight: 600,
              marginBottom: 24,
              color: "#8b949e",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontSize: 12,
              fontFamily: "system-ui, -apple-system, sans-serif",
              opacity: capabilitiesReveal.visible ? 1 : 0,
              transition: "opacity 0.5s ease",
            }}>
              Analytics Engine
            </h2>

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 16
            }}>
              {[
                { title: "Volatility Estimation", accent: "#3b82f6", text: "Yang-Zhang, Rogers-Satchell, Parkinson & Garman-Klass estimators. Rolling windows (20/60/120-day), EWMA smoothing, historical percentile ranking, and regime detection." },
                { title: "Monte Carlo Simulation", accent: "#06b6d4", text: "10,000-path GBM with configurable drift and volatility. Percentile bands (5th–95th), probability cones, and statistical scenario testing." },
                { title: "Risk Metrics", accent: "#ef4444", text: "Max drawdown with recovery tracking, Sharpe ratio, market beta vs OBX, expected daily/weekly moves (1σ), and rolling benchmark correlation." },
                { title: "Std Deviation Channels", accent: "#10b981", text: "Linear regression channels with ±1σ/±2σ bands. Auto-optimized windows (255–1530 bars) by R². Position classification and mean-reversion signals." },
                { title: "ML Price Predictions", accent: "#f59e0b", text: "GB/RF ensemble on 19 factors (momentum, volatility, fundamentals). Walk-forward validation across 200+ stocks, confidence scoring, and probability-weighted return forecasts." },
                { title: "Factor Backtesting", accent: "#3b82f6", text: "Strategy backtesting with signal thresholds and holding periods. Factor attribution, cumulative returns, hit rates, and per-ticker trade detail." },
                { title: "Time Series Analysis", accent: "#06b6d4", text: "Log-return decomposition, ACF diagnostics, monthly seasonality patterns, and 30-day rolling volatility correlation with OBX index." },
                { title: "Research Aggregation", accent: "#10b981", text: "Claude AI summarization via Anthropic API. IMAP ingestion from 6 brokers, web scraping from DNB Carnegie, DNB Markets & Redeye. PDF text extraction, document deduplication, and full-text search." },
                { title: "Options Analytics", accent: "#f59e0b", text: "Black-Scholes pricing, IV solver, multi-leg P&L with time decay. Max pain, put/call ratios, IV term structure. Editable positions with strike stepping." },
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
              fontWeight: 600,
              marginBottom: 24,
              color: "#8b949e",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontSize: 12,
              fontFamily: "system-ui, -apple-system, sans-serif",
              opacity: upcomingReveal.visible ? 1 : 0,
              transition: "opacity 0.5s ease",
            }}>
              Upcoming
            </h2>

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 16
            }}>
              {[
                { title: "DCC-GARCH Correlation", accent: "#3b82f6", text: "Dynamic conditional correlation for time-varying co-movement. Copula models (Gaussian, Student-t) for tail dependence. VaR/CVaR and systemic risk indicators." },
                { title: "Additional Research Sources", accent: "#10b981", text: "Redeye commissioned research, Arctic Securities, ABG Sundal Collier. Automated web scraping with OSE-only filtering and AI summarization." },
                { title: "CNN Signal Models", accent: "#f59e0b", text: "Convolutional neural network for pattern recognition on OHLCV data. Multi-timeframe signal generation and ensemble with existing ML predictions." },
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
            borderTop: "1px solid #21262d",
            fontSize: 11.5,
            color: "#8b949e",
            fontFamily: "system-ui, -apple-system, sans-serif"
          }}>
            <p style={{ marginBottom: 8, lineHeight: 1.6 }}>
              <strong style={{ color: "#e6edf3", fontWeight: 600 }}>Tech Stack:</strong> Next.js 15 · TypeScript · PostgreSQL 17 · Drizzle ORM · Python · scikit-learn · Interactive Brokers TWS API · Anthropic Claude API
            </p>
            <p style={{ marginBottom: 8, lineHeight: 1.6 }}>
              <strong style={{ color: "#e6edf3", fontWeight: 600 }}>Architecture:</strong> Server-side compute · Connection pooling · Transaction pooler (Supabase) · JWT authentication · Vercel edge deployment
            </p>
            <p style={{ marginBottom: 8, lineHeight: 1.6 }}>
              <strong style={{ color: "#e6edf3", fontWeight: 600 }}>Data:</strong> Real-time OHLCV ingestion via IBKR · 225+ securities · 300K+ daily data points · Supabase storage for PDF attachments
            </p>
            <p style={{ lineHeight: 1.6 }}>
              <strong style={{ color: "#e6edf3", fontWeight: 600 }}>Sources:</strong> Interactive Brokers TWS API · Yahoo Finance · Norges Bank (FX rates) · Pareto Securities · DNB Markets · DNB Carnegie · Redeye · Xtrainvestor · Finanstilsynet · BarentsWatch · Oslo Stock Exchange
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
      background: "#161b22",
      border: "1px solid #21262d",
      borderRadius: 6,
      padding: "18px 20px"
    }}>
      <div style={{
        fontSize: 10,
        color: "#8b949e",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        marginBottom: 10,
        fontWeight: 600,
        fontFamily: "system-ui, -apple-system, sans-serif",
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
            background: "#10b981",
            display: "inline-block",
            animation: "pulse 2s ease-in-out infinite",
          }} />
        )}
      </div>
      <div style={{
        fontSize: 28,
        fontWeight: 700,
        color: "#e6edf3",
        fontFamily: "system-ui, -apple-system, sans-serif",
        display: "flex",
        alignItems: "baseline",
        gap: 4
      }}>
        {value}
        {suffix && (
          <span style={{ fontSize: 12, color: "#8b949e", fontWeight: 500 }}>
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function FeatureCard({ href, title, description, tags, visible, delay, children }: {
  href: string;
  title: string;
  description: string;
  tags: { label: string; color: string }[];
  visible: boolean;
  delay: number;
  children?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="feature-card"
      style={{
        display: "block",
        background: "#161b22",
        border: "1px solid #21262d",
        borderRadius: 8,
        padding: "22px 24px",
        textDecoration: "none",
        color: "inherit",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(20px)",
        transition: `opacity 0.5s ease ${delay * 0.1}s, transform 0.5s ease ${delay * 0.1}s, border-color 0.25s ease, box-shadow 0.25s ease`,
      }}
    >
      <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap", alignItems: "center", minHeight: 16 }}>
        {tags.map(t => (
          <TagPill key={t.label} label={t.label} color={t.color} />
        ))}
      </div>
      <h3 style={{
        fontSize: 16,
        fontWeight: 600,
        marginBottom: 8,
        color: "#e6edf3",
        fontFamily: "system-ui, -apple-system, sans-serif",
        letterSpacing: "0.01em"
      }}>
        {title}
      </h3>
      <p style={{ fontSize: 13, color: "#8b949e", lineHeight: 1.65, fontFamily: "system-ui, -apple-system, sans-serif" }}>
        {description}
      </p>
      {children}
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
        background: "#161b22",
        border: "1px solid #21262d",
        borderRadius: 6,
        padding: "14px 16px",
        borderLeft: `3px solid ${accent}`,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(16px)",
        transition: `opacity 0.4s ease ${delay * 0.08}s, transform 0.4s ease ${delay * 0.08}s, border-color 0.2s ease, box-shadow 0.2s ease`,
      }}
    >
      <h4 style={{
        fontSize: 12,
        fontWeight: 600,
        marginBottom: 10,
        color: "#e6edf3",
        fontFamily: "system-ui, -apple-system, sans-serif",
        letterSpacing: "0.03em"
      }}>
        {title}
      </h4>
      <p style={{ fontSize: 12.5, color: "#8b949e", lineHeight: 1.65, fontFamily: "system-ui, -apple-system, sans-serif" }}>
        {children}
      </p>
    </div>
  );
}

// Map CSS var names to hex colors for reliable tag rendering
const COLOR_MAP: Record<string, string> = {
  "#3b82f6": "#3b82f6",
  "#10b981": "#10b981",
  "#f59e0b": "#f59e0b",
  "#ef4444": "#ef4444",
  "#06b6d4": "#06b6d4",
};

function TagPill({ label, color }: { label: string; color: string }) {
  const hex = COLOR_MAP[color] || color;
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      height: 18,
      padding: "0 7px",
      borderRadius: 10,
      fontSize: 9,
      fontFamily: "system-ui, -apple-system, sans-serif",
      fontWeight: 600,
      letterSpacing: "0.03em",
      textTransform: "uppercase" as const,
      whiteSpace: "nowrap" as const,
      background: `${hex}18`,
      color: `${hex}cc`,
    }}>
      {label}
    </span>
  );
}
