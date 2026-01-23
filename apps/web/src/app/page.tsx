"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type SystemStats = {
  securities: number;
  last_updated: string | null;
  data_points: number;
};

export default function HomePage() {
  const [stats, setStats] = useState<SystemStats | null>(null);

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch("/api/stats", {
          method: "GET",
          cache: "no-store",
        });

        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch (e) {
        console.error("Failed to fetch stats:", e);
      }
    }

    fetchStats();
  }, []);

  const lastUpdate = stats?.last_updated
    ? new Date(stats.last_updated).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    : '...';

  return (
    <main style={{
      minHeight: "100vh",
      background: "var(--background)",
      color: "var(--foreground)",
      padding: "48px 32px"
    }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        
        {/* Header */}
        <header style={{ marginBottom: 48, borderBottom: "1px solid var(--border)", paddingBottom: 32 }}>
          <div style={{
            fontSize: 11,
            fontFamily: "monospace",
            color: "var(--muted-foreground)",
            marginBottom: 16,
            letterSpacing: "0.1em",
            textTransform: "uppercase"
          }}>
            InEqRe / v2.0 / Oslo Børs
          </div>
          <h1 style={{
            fontSize: 42,
            fontWeight: 700,
            marginBottom: 16,
            color: "var(--foreground)",
            letterSpacing: "-0.03em",
            fontFamily: "system-ui, -apple-system, sans-serif"
          }}>
            Intelligence Equity Research
          </h1>
          <p style={{ fontSize: 15, color: "var(--muted-foreground)", lineHeight: 1.7, maxWidth: 720 }}>
            Institutional-grade quantitative equity research platform for Oslo Børs.
            Automated research aggregation with AI summarization, advanced volatility modeling, Monte Carlo simulation, and cross-sectional correlation analysis.
          </p>
        </header>

        {/* System Stats */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 16,
          marginBottom: 56
        }}>
          <StatBox label="Securities Covered" value={stats?.securities || '...'} suffix="" />
          <StatBox label="OHLCV Data Points" value={stats ? Number(stats.data_points).toLocaleString() : '...'} suffix={stats ? "pts" : ""} />
          <StatBox label="Last Updated" value={lastUpdate} suffix="" />
        </div>

        {/* Navigation */}
        <section style={{ marginBottom: 56 }}>
          <h2 style={{
            fontWeight: 700,
            marginBottom: 20,
            color: "var(--foreground)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontSize: 12,
            fontFamily: "monospace"
          }}>
            // Core Modules
          </h2>
          
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <NavCard
              href="/stocks"
              title="Universe Explorer"
              description="Browse covered securities with price history and fundamental filters"
            />
            <NavCard
              href="/research"
              title="Research Portal"
              description="Password-protected analyst research repository with Claude AI summaries. Automated email ingestion from Pareto Securities, DNB Markets, and manual PDF uploads"
            />
            <NavCard
              href="/correlation"
              title="Correlation Analysis"
              description="Cross-sectional correlation matrices with configurable lookback periods and rolling window analysis"
            />
          </div>
        </section>

        {/* Capabilities */}
        <section style={{ marginBottom: 56 }}>
          <h2 style={{
            fontWeight: 700,
            marginBottom: 20,
            color: "var(--foreground)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontSize: 12,
            fontFamily: "monospace"
          }}>
            // Analytics Capabilities
          </h2>
          
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16
          }}>
            <Capability title="Research Aggregation">
              Automated email processing with Claude AI summarization (Anthropic API). IMAP-based ingestion from Pareto Securities, DNB Markets with full-text search. Manual PDF analysis using pdf-parse for text extraction and AI-generated summaries. Document deduplication and merge logic.
            </Capability>
            <Capability title="Volatility Estimation">
              Yang-Zhang (gap-adjusted), Rogers-Satchell (drift-independent), Parkinson (high-low range), Garman-Klass (OHLC) estimators. Rolling windows (20/60/120-day), EWMA smoothing (λ=0.94/0.97), historical percentile ranking, and volatility regime detection.
            </Capability>
            <Capability title="Monte Carlo Simulation">
              10,000-path Geometric Brownian Motion (GBM) with configurable drift (μ), volatility (σ), and time horizons. Price distribution analysis with percentile bands (5th/25th/50th/75th/95th). Probability cone visualization and statistical scenario testing.
            </Capability>
            <Capability title="Risk Metrics">
              Maximum drawdown with recovery period tracking, annualized Sharpe ratio, market beta vs OBX index, and historical stress testing. Expected daily/weekly moves using 1σ normal distribution assumptions. Rolling correlation with benchmark indices.
            </Capability>
            <Capability title="Time Series Analysis">
              Log-return decomposition, autocorrelation function (ACF) diagnostics, monthly seasonality patterns with bar chart visualization. Rolling 30-day volatility correlation with OBX market index for co-movement analysis.
            </Capability>
            <Capability title="Data Infrastructure">
              PostgreSQL 17 with Drizzle ORM and type-safe schema definitions. Real-time OHLCV ingestion via Interactive Brokers TWS API with 160K+ daily data points. Supabase storage for PDF attachments (year/month/document_id structure) and connection pooling for serverless edge deployment.
            </Capability>
          </div>
        </section>

        {/* Upcoming Projects */}
        <section style={{ marginBottom: 56 }}>
          <h2 style={{
            fontWeight: 700,
            marginBottom: 20,
            color: "var(--foreground)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontSize: 12,
            fontFamily: "monospace"
          }}>
            // Upcoming Projects
          </h2>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16
          }}>
            <Capability title="Commodities Integration">
              Brent crude oil, natural gas (TTF/NBP), Nord Pool power prices, and base metals (copper, aluminum, zinc). Cross-asset correlation matrices with energy-exposed Oslo Børs equities (Equinor, Aker BP, subsea contractors). Sector-specific beta decomposition and hedging ratio calculations.
            </Capability>
            <Capability title="FX Hedging Analytics">
              Multi-currency exposure analysis for NOK-denominated portfolios with USD, EUR, GBP revenue streams. Forward rate pricing using interest rate parity, carry trade P&L attribution, and optimal hedge ratio determination. Currency beta estimation for export-heavy Norwegian equities.
            </Capability>
            <Capability title="Advanced Correlation Models">
              Dynamic Conditional Correlation (DCC-GARCH) for time-varying co-movement. Gaussian and Student-t copula models for tail dependence structure. VaR/CVaR calculation with historical simulation and parametric methods. Crisis period co-movement analysis and systemic risk indicators.
            </Capability>
          </div>
        </section>

        {/* Tech Stack */}
        <footer style={{
          paddingTop: 28,
          borderTop: "1px solid var(--border)",
          fontSize: 11.5,
          color: "var(--muted-foreground)",
          fontFamily: "monospace"
        }}>
          <p style={{ marginBottom: 8, lineHeight: 1.6 }}>
            <strong style={{ color: "var(--foreground)", fontWeight: 700 }}>Tech Stack:</strong> Next.js 16 · TypeScript · PostgreSQL · Drizzle ORM · Interactive Brokers API · ImapFlow
          </p>
          <p style={{ lineHeight: 1.6 }}>
            <strong style={{ color: "var(--foreground)", fontWeight: 700 }}>Architecture:</strong> Server-side compute · Connection pooling · Transaction pooler (Supabase) · JWT authentication · Local file storage · Vercel edge deployment
          </p>
        </footer>

      </div>
    </main>
  );
}

// Sub-components
function StatBox({ label, value, suffix }: { label: string; value: string | number; suffix: string }) {
  return (
    <div style={{
      background: "var(--card-bg)",
      border: "1px solid var(--border)",
      borderRadius: 2,
      padding: "18px 20px"
    }}>
      <div style={{
        fontSize: 10,
        color: "var(--muted-foreground)",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        marginBottom: 10,
        fontWeight: 700,
        fontFamily: "monospace"
      }}>
        {label}
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

function NavCard({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Link
      href={href}
      style={{
        display: "block",
        background: "var(--card-bg)",
        border: "1px solid var(--border)",
        borderRadius: 2,
        padding: "18px 20px",
        textDecoration: "none",
        color: "inherit",
        transition: "all 0.15s ease"
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--foreground)";
        e.currentTarget.style.transform = "translateX(4px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.transform = "translateX(0)";
      }}
    >
      <h3 style={{
        fontSize: 15,
        fontWeight: 700,
        marginBottom: 8,
        color: "var(--foreground)",
        fontFamily: "monospace",
        letterSpacing: "0.02em"
      }}>
        → {title}
      </h3>
      <p style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.6 }}>
        {description}
      </p>
    </Link>
  );
}

function Capability({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: "var(--card-bg)",
      border: "1px solid var(--border)",
      borderRadius: 2,
      padding: "14px 16px"
    }}>
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