import Link from "next/link";
import { pool } from "@/lib/db";
import { getPriceTable } from "@/lib/price-data-adapter";

export const dynamic = "force-dynamic";

async function getSystemStats() {
  try {
    const tableName = await getPriceTable();
    
    const query = `
      SELECT
        COUNT(DISTINCT s.ticker) as securities,
        MAX(p.date) as last_updated,
        COUNT(*) as data_points
      FROM stocks s
      INNER JOIN ${tableName} p ON s.ticker = p.ticker
      WHERE p.source = 'ibkr' AND p.close IS NOT NULL
    `;
    
    const result = await pool.query(query);
    return result.rows[0];
  } catch (error) {
    console.error("Failed to load stats:", error);
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
      padding: "64px 32px"
    }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        
        {/* Header */}
        <header style={{ marginBottom: 64 }}>
          <h1 style={{ 
            fontSize: 36, 
            fontWeight: 600, 
            marginBottom: 12,
            color: "var(--foreground)",
            letterSpacing: "-0.02em"
          }}>
            Intelligence Equity Research
          </h1>
          <p style={{ fontSize: 16, color: "var(--muted-foreground)", lineHeight: 1.6, maxWidth: 700 }}>
            Quantitative equity research platform for Oslo Børs. 
            Server-side analytics, historical volatility models, and cross-sectional factor analysis.
          </p>
        </header>

        {/* System Stats */}
        <div style={{ 
          display: "grid", 
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", 
          gap: 20,
          marginBottom: 64
        }}>
          <StatBox label="Securities Covered" value={stats.securities} />
          <StatBox label="OHLCV Data Points" value={Number(stats.data_points).toLocaleString()} />
          <StatBox label="Last Updated" value={lastUpdate} />
        </div>

        {/* Navigation */}
        <section style={{ marginBottom: 64 }}>
          <h2 style={{ 
            fontWeight: 600, 
            marginBottom: 24,
            color: "var(--foreground)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            fontSize: 14
          }}>
            Core Modules
          </h2>
          
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
        <section style={{ marginBottom: 64 }}>
          <h2 style={{ 
            fontWeight: 600, 
            marginBottom: 24,
            color: "var(--foreground)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            fontSize: 14
          }}>
            Analytics Capabilities
          </h2>
          
          <div style={{ 
            display: "grid", 
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", 
            gap: 16 
          }}>
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
              PostgreSQL with Drizzle ORM. Real-time ingestion via Interactive Brokers API.
            </Capability>
          </div>
        </section>

        {/* Tech Stack */}
        <footer style={{ 
          paddingTop: 32, 
          borderTop: "1px solid var(--border)",
          fontSize: 13,
          color: "var(--muted-foreground)"
        }}>
          <p style={{ marginBottom: 8 }}>
            <strong style={{ color: "var(--foreground)" }}>Technology Stack:</strong> Next.js 16 · TypeScript · PostgreSQL · Drizzle ORM · Interactive Brokers API
          </p>
          <p>
            <strong style={{ color: "var(--foreground)" }}>Architecture:</strong> Server-side compute · Connection pooling · Transaction pooler (Supabase) · Vercel edge deployment
          </p>
        </footer>

      </div>
    </main>
  );
}

// Sub-components
function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{
      background: "var(--card-bg)",
      border: "1px solid var(--border)",
      borderRadius: 4,
      padding: 20
    }}>
      <div style={{ 
        fontSize: 11, 
        color: "var(--muted-foreground)", 
        textTransform: "uppercase", 
        letterSpacing: "0.05em",
        marginBottom: 8,
        fontWeight: 600
      }}>
        {label}
      </div>
      <div style={{ 
        fontSize: 24, 
        fontWeight: 600, 
        color: "var(--foreground)",
        fontFamily: "system-ui, -apple-system, monospace"
      }}>
        {value}
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
        borderRadius: 4,
        padding: 20,
        textDecoration: "none",
        color: "inherit",
        transition: "border-color 0.2s"
      }}
    >
      <h3 style={{ 
        fontSize: 16, 
        fontWeight: 600, 
        marginBottom: 8,
        color: "var(--foreground)"
      }}>
        {title} →
      </h3>
      <p style={{ fontSize: 14, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
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
      borderRadius: 4,
      padding: 16
    }}>
      <h4 style={{ 
        fontSize: 14, 
        fontWeight: 600, 
        marginBottom: 8,
        color: "var(--foreground)"
      }}>
        {title}
      </h4>
      <p style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.6 }}>
        {children}
      </p>
    </div>
  );
}