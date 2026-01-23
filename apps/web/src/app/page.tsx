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
              Automated email processing with Claude AI summarization. IMAP-based ingestion from Pareto Securities, DNB Markets. Manual PDF analysis with text extraction and AI-generated summaries.
            </Capability>
            <Capability title="Volatility Estimation">
              Yang-Zhang, Rogers-Satchell, Parkinson, Garman-Klass high-low estimators. Rolling windows, EWMA smoothing, and historical percentile ranking.
            </Capability>
            <Capability title="Monte Carlo Simulation">
              Geometric Brownian Motion (GBM) path generation with configurable drift, volatility, and time horizons. Statistical analysis of price distributions and probability scenarios.
            </Capability>
            <Capability title="Risk Metrics">
              Maximum drawdown, Sharpe ratio, beta calculation, and historical stress scenarios. Expected daily/weekly moves with standard deviation bands.
            </Capability>
            <Capability title="Time Series Analysis">
              Returns decomposition, autocorrelation diagnostics, seasonality patterns, and volatility correlation with market indices.
            </Capability>
            <Capability title="Data Infrastructure">
              PostgreSQL with Drizzle ORM. Real-time ingestion via Interactive Brokers API. Supabase storage for PDF attachments and transaction pooling.
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
              Oil, gas, power, and metals pricing data. Cross-asset correlation analysis with energy-exposed equities and sector-specific hedging strategies.
            </Capability>
            <Capability title="FX Hedging Analytics">
              Currency exposure analysis for NOK-based portfolios. Forward rate calculations, carry trade metrics, and multi-currency hedging optimization.
            </Capability>
            <Capability title="Advanced Correlation Models">
              Dynamic conditional correlation (DCC-GARCH), copula-based dependence structures, and tail risk co-movement analysis across asset classes.
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