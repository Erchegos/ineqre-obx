import Link from "next/link";
import { pool } from "@/lib/db";
import { getPriceTable } from "@/lib/price-data-adapter";

export const dynamic = "force-dynamic";

type StockData = {
  ticker: string;
  name: string;
  last_close: number;
  last_adj_close: number;
  start_date: string;
  end_date: string;
  rows: number;
};

async function getStocksData(): Promise<StockData[]> {
  const tableName = await getPriceTable();

  /* FIX EXPLAINED:
    - Old: MAX(p.close) -> Gets the highest price ever (wrong for "current").
    - New: (ARRAY_AGG(p.close ORDER BY p.date DESC))[1] -> Gets the price from the most recent date.
  */
  const query = `
    SELECT
      s.ticker,
      s.name,
      (ARRAY_AGG(p.close ORDER BY p.date DESC))[1] as last_close,
      (ARRAY_AGG(p.adj_close ORDER BY p.date DESC))[1] as last_adj_close,
      MIN(p.date) as start_date,
      MAX(p.date) as end_date,
      COUNT(*) as rows
    FROM stocks s
    INNER JOIN ${tableName} p ON s.ticker = p.ticker
    WHERE p.source = 'ibkr'
      AND p.close IS NOT NULL
      AND p.close > 0
    GROUP BY s.ticker, s.name
    HAVING COUNT(*) >= 1000
      AND MAX(p.date) >= CURRENT_DATE - INTERVAL '30 days'
    ORDER BY s.ticker
  `;

  const result = await pool.query(query);

  return result.rows.map((row) => ({
    ticker: row.ticker,
    name: row.name || row.ticker,
    last_close: Number(row.last_close),
    last_adj_close: Number(row.last_adj_close || row.last_close),
    start_date: row.start_date instanceof Date 
      ? row.start_date.toISOString().slice(0, 10)
      : String(row.start_date),
    end_date: row.end_date instanceof Date
      ? row.end_date.toISOString().slice(0, 10)
      : String(row.end_date),
    rows: Number(row.rows),
  }));
}

export default async function StocksPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; order?: string }>;
}) {
  const params = await searchParams;
  const sortBy = params.sort || "ticker";
  const sortOrder = params.order || "asc";

  let stocks = await getStocksData();

  stocks.sort((a, b) => {
    let aVal: any = a[sortBy as keyof StockData];
    let bVal: any = b[sortBy as keyof StockData];

    if (typeof aVal === "string") {
      aVal = aVal.toLowerCase();
      bVal = (bVal as string).toLowerCase();
    }

    if (sortOrder === "asc") {
      return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
    } else {
      return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
    }
  });

  const toggleSort = (column: string) => {
    const newOrder =
      sortBy === column && sortOrder === "asc" ? "desc" : "asc";
    return `?sort=${column}&order=${newOrder}`;
  };

  const SortIcon = ({ column }: { column: string }) => {
    if (sortBy !== column) return <span style={{ opacity: 0.4 }}>↕</span>;
    return sortOrder === "asc" ? <span>↑</span> : <span>↓</span>;
  };

  return (
    <div style={{ 
      minHeight: "100vh", 
      background: "var(--background)", 
      color: "var(--foreground)", 
      padding: 32 
    }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .stock-table tbody tr {
          border-bottom: 1px solid var(--table-border);
          transition: background 0.15s;
        }
        .stock-table tbody tr:hover {
          background: var(--hover-bg) !important;
        }
      `}} />
      
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <h1 style={{ fontSize: 32, fontWeight: 700, margin: 0 }}>Stocks</h1>
          <Link 
            href="/correlation" 
            style={{ 
              color: "var(--accent)", 
              textDecoration: "none", 
              fontSize: 14,
              fontWeight: 500,
              padding: "8px 16px",
              borderRadius: 4,
              border: "1px solid var(--accent)",
              transition: "all 0.15s",
            }}
          >
            → Correlation Matrix
          </Link>
        </div>
        <p style={{ color: "var(--muted)", marginBottom: 32, fontSize: 14 }}>
          Universe: {stocks.length} tickers
          <span style={{ marginLeft: 16, fontSize: 13 }}>Source: Interactive Brokers</span>
        </p>

        <div style={{ overflowX: "auto" }}>
          <table className="stock-table" style={{ 
            width: "100%", 
            borderCollapse: "collapse",
            background: "var(--card-bg)",
            border: "1px solid var(--card-border)",
            borderRadius: 4,
          }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th style={{ textAlign: "left", padding: "16px" }}>
                  <Link
                    href={toggleSort("ticker")}
                    style={{ 
                      color: "var(--foreground)", 
                      textDecoration: "none", 
                      display: "flex", 
                      alignItems: "center", 
                      gap: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Ticker <SortIcon column="ticker" />
                  </Link>
                </th>
                <th style={{ textAlign: "left", padding: "16px" }}>
                  <Link
                    href={toggleSort("name")}
                    style={{ 
                      color: "var(--foreground)", 
                      textDecoration: "none", 
                      display: "flex", 
                      alignItems: "center", 
                      gap: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Name <SortIcon column="name" />
                  </Link>
                </th>
                <th style={{ textAlign: "right", padding: "16px" }}>
                  <Link
                    href={toggleSort("last_close")}
                    style={{ 
                      color: "var(--foreground)", 
                      textDecoration: "none", 
                      display: "flex", 
                      alignItems: "center", 
                      justifyContent: "flex-end", 
                      gap: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Last Close <SortIcon column="last_close" />
                  </Link>
                </th>
                <th style={{ textAlign: "right", padding: "16px" }}>
                  <Link
                    href={toggleSort("last_adj_close")}
                    style={{ 
                      color: "var(--foreground)", 
                      textDecoration: "none", 
                      display: "flex", 
                      alignItems: "center", 
                      justifyContent: "flex-end", 
                      gap: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Adj Close <SortIcon column="last_adj_close" />
                  </Link>
                </th>
                <th style={{ textAlign: "right", padding: "16px" }}>
                  <Link
                    href={toggleSort("start_date")}
                    style={{ 
                      color: "var(--foreground)", 
                      textDecoration: "none", 
                      display: "flex", 
                      alignItems: "center", 
                      justifyContent: "flex-end", 
                      gap: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Start Date <SortIcon column="start_date" />
                  </Link>
                </th>
                <th style={{ textAlign: "right", padding: "16px" }}>
                  <Link
                    href={toggleSort("end_date")}
                    style={{ 
                      color: "var(--foreground)", 
                      textDecoration: "none", 
                      display: "flex", 
                      alignItems: "center", 
                      justifyContent: "flex-end", 
                      gap: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    End Date <SortIcon column="end_date" />
                  </Link>
                </th>
                <th style={{ textAlign: "right", padding: "16px" }}>
                  <Link
                    href={toggleSort("rows")}
                    style={{ 
                      color: "var(--foreground)", 
                      textDecoration: "none", 
                      display: "flex", 
                      alignItems: "center", 
                      justifyContent: "flex-end", 
                      gap: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Rows <SortIcon column="rows" />
                  </Link>
                </th>
              </tr>
            </thead>
            <tbody>
              {stocks.map((stock) => (
                <tr key={stock.ticker}>
                  <td style={{ padding: "16px" }}>
                    <Link
                      href={`/stocks/${stock.ticker}`}
                      style={{ 
                        color: "var(--accent)", 
                        textDecoration: "none", 
                        fontWeight: 600,
                        fontSize: 14,
                      }}
                    >
                      {stock.ticker}
                    </Link>
                  </td>
                  <td style={{ padding: "16px", color: "var(--foreground)", fontSize: 14 }}>
                    {stock.name}
                  </td>
                  <td style={{ 
                    padding: "16px", 
                    textAlign: "right", 
                    fontFamily: "monospace",
                    color: "var(--foreground)",
                    fontSize: 14,
                  }}>
                    {stock.last_close.toFixed(2)}
                  </td>
                  <td style={{ 
                    padding: "16px", 
                    textAlign: "right", 
                    fontFamily: "monospace",
                    color: "var(--muted)",
                    fontSize: 14,
                  }}>
                    {stock.last_adj_close.toFixed(2)}
                  </td>
                  <td style={{ padding: "16px", textAlign: "right", color: "var(--muted)", fontSize: 13 }}>
                    {stock.start_date}
                  </td>
                  <td style={{ padding: "16px", textAlign: "right", color: "var(--muted)", fontSize: 13 }}>
                    {stock.end_date}
                  </td>
                  <td style={{ padding: "16px", textAlign: "right", color: "var(--muted)", fontSize: 13 }}>
                    {stock.rows.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {stocks.length === 0 && (
          <div style={{ 
            textAlign: "center", 
            padding: 48, 
            color: "var(--muted)" 
          }}>
            No stocks found with sufficient IBKR data
          </div>
        )}
      </div>
    </div>
  );
}