import Link from "next/link";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getSystemStats() {
  try {
    // Check if DATABASE_URL is configured
    if (!process.env.DATABASE_URL) {
      console.log("[getSystemStats] DATABASE_URL not configured, returning empty stats");
      return { securities: 0, last_updated: null, data_points: 0 };
    }

    // Lazy load database modules to avoid initialization errors
    const { pool } = await import("@/lib/db");
    const { getPriceTable } = await import("@/lib/price-data-adapter");

    const tableName = await getPriceTable();

    // Count securities that meet the same criteria as stocks list page:
    // - At least 510 data points (2 years of trading data)
    // - Updated within last 30 days
    const query = `
      WITH stock_stats AS (
        SELECT
          s.ticker,
          COUNT(*) as row_count,
          MAX(p.date) as last_date
        FROM stocks s
        INNER JOIN ${tableName} p ON s.ticker = p.ticker
        WHERE p.source = 'ibkr'
          AND p.close IS NOT NULL
          AND p.close > 0
        GROUP BY s.ticker
        HAVING COUNT(*) >= 510
          AND MAX(p.date) >= CURRENT_DATE - INTERVAL '30 days'
      )
      SELECT
        COUNT(*) as securities,
        MAX(last_date) as last_updated,
        (SELECT COUNT(*) FROM ${tableName} WHERE source = 'ibkr' AND close IS NOT NULL) as data_points
      FROM stock_stats
    `;

    const result = await pool.query(query);
    return result.rows[0];
  } catch (error) {
    console.error("[getSystemStats] Failed to load stats:", error);
    // Return empty stats instead of throwing
    return { securities: 0, last_updated: null, data_points: 0 };
  }
}

export default async function HomePage() {
  const stats = await getSystemStats();
  
  const lastUpdate = stats.last_updated 
    ? new Date(stats.last_updated).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      })
    : 'N/A';

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
            Automated research aggregation, server-side analytics, volatility modeling, and cross-sectional factor analysis.
          </p>
        </header>

        {/* System Stats */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 16,
          marginBottom: 56
        }}>
          <StatBox label="Securities Covered" value={stats.securities} suffix="" />
          <StatBox label="OHLCV Data Points" value={Number(stats.data_points).toLocaleString()} suffix="pts" />
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
              href="/research"
              title="Research Portal"
              description="Password-protected analyst research repository. Automated email ingestion from Pareto Securities and other brokers"
            />
            <NavCard
              href="/stocks"
              title="Universe Explorer"
              description="Browse covered securities with price history and fundamental filters"
            />
            <NavCard
              href="/correlation"
              title="Correlation Analysis"
              description="Cross-sectional correlation matrices with configurable lookback periods"
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
              Automated email processing and document management. IMAP-based ingestion from Pareto Securities with full-text search and ticker mapping.
            </Capability>
            <Capability title="Volatility Estimation">
              Yang-Zhang, Rogers-Satchell, Parkinson high-low estimators. Rolling windows and EWMA smoothing.
            </Capability>
            <Capability title="Risk Metrics">
              Maximum drawdown, Sharpe ratio, beta calculation, and historical stress scenarios.
            </Capability>
            <Capability title="Time Series Analysis">
              Returns decomposition, autocorrelation diagnostics, and stationarity tests.
            </Capability>
            <Capability title="Data Infrastructure">
              PostgreSQL with Drizzle ORM. Real-time ingestion via Interactive Brokers API. Supabase transaction pooler.
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