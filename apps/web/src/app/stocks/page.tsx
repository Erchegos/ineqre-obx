"use client";

import Link from "next/link";
import { useEffect, useState, useMemo } from "react";

type StockData = {
  ticker: string;
  name: string;
  last_close: number;
  last_adj_close: number;
  start_date: string;
  end_date: string;
  rows: number;
};

export default function StocksPage() {
  const [stocks, setStocks] = useState<StockData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<keyof StockData>("ticker");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    async function fetchStocks() {
      try {
        const res = await fetch("/api/stocks", {
          method: "GET",
          headers: { accept: "application/json" },
          cache: "no-store",
        });

        if (!res.ok) {
          throw new Error(`Failed to fetch stocks: ${res.statusText}`);
        }

        const data = await res.json();
        setStocks(data);
        setLoading(false);
      } catch (e: any) {
        setError(e?.message ?? String(e));
        setLoading(false);
      }
    }

    fetchStocks();
  }, []);

  const filteredAndSortedStocks = useMemo(() => {
    let filtered = stocks;

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = stocks.filter(
        (stock) =>
          stock.ticker.toLowerCase().includes(query) ||
          stock.name.toLowerCase().includes(query)
      );
    }

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      let aVal: any = a[sortBy];
      let bVal: any = b[sortBy];

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

    return sorted;
  }, [stocks, searchQuery, sortBy, sortOrder]);

  const toggleSort = (column: keyof StockData) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder("asc");
    }
  };

  const SortIcon = ({ column }: { column: keyof StockData }) => {
    if (sortBy !== column) return <span style={{ opacity: 0.4 }}>↕</span>;
    return sortOrder === "asc" ? <span>↑</span> : <span>↓</span>;
  };

  if (loading) {
    return (
      <div style={{
        minHeight: "100vh",
        background: "var(--background)",
        color: "var(--foreground)",
        padding: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}>
        <div>Loading stocks...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        minHeight: "100vh",
        background: "var(--background)",
        color: "var(--foreground)",
        padding: 32
      }}>
        <div style={{ maxWidth: 1400, margin: "0 auto" }}>
          <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 16 }}>Error</h1>
          <p style={{ color: "var(--danger)" }}>{error}</p>
        </div>
      </div>
    );
  }

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
        .search-input {
          width: 100%;
          padding: 12px 16px;
          font-size: 14px;
          border: 1px solid var(--border);
          border-radius: 4px;
          background: var(--card-bg);
          color: var(--foreground);
          outline: none;
          transition: border-color 0.2s;
        }
        .search-input:focus {
          border-color: var(--accent);
        }
        .search-input::placeholder {
          color: var(--muted);
        }
      `}} />

      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <h1 style={{ fontSize: 32, fontWeight: 700, margin: 0 }}>Stocks</h1>
            <Link
              href="/"
              style={{
                display: "inline-block",
                color: "var(--foreground)",
                textDecoration: "none",
                fontSize: 14,
                fontWeight: 600,
                padding: "8px 16px",
                border: "1px solid var(--border)",
                borderRadius: 2,
                background: "var(--card-bg)",
                transition: "all 0.15s ease"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--foreground)";
                e.currentTarget.style.background = "var(--hover-bg)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.background = "var(--card-bg)";
              }}
            >
              ← Home
            </Link>
          </div>
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
        <p style={{ color: "var(--muted)", marginBottom: 24, fontSize: 14 }}>
          Universe: {stocks.length} tickers <span style={{ color: "var(--muted-foreground)" }}>(more coming)</span>
          <span style={{ marginLeft: 16, fontSize: 13 }}>Source: Interactive Brokers</span>
        </p>

        {/* Search Bar */}
        <div style={{ marginBottom: 24 }}>
          <input
            type="text"
            className="search-input"
            placeholder="Search by ticker or name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <div style={{ marginTop: 8, fontSize: 13, color: "var(--muted)" }}>
              Found {filteredAndSortedStocks.length} result{filteredAndSortedStocks.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>

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
                  <button
                    onClick={() => toggleSort("ticker")}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--foreground)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      padding: 0,
                    }}
                  >
                    Ticker <SortIcon column="ticker" />
                  </button>
                </th>
                <th style={{ textAlign: "left", padding: "16px" }}>
                  <button
                    onClick={() => toggleSort("name")}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--foreground)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      padding: 0,
                    }}
                  >
                    Name <SortIcon column="name" />
                  </button>
                </th>
                <th style={{ textAlign: "right", padding: "16px" }}>
                  <button
                    onClick={() => toggleSort("last_close")}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--foreground)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-end",
                      gap: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      padding: 0,
                      marginLeft: "auto",
                    }}
                  >
                    Last Close <SortIcon column="last_close" />
                  </button>
                </th>
                <th style={{ textAlign: "right", padding: "16px" }}>
                  <button
                    onClick={() => toggleSort("last_adj_close")}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--foreground)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-end",
                      gap: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      padding: 0,
                      marginLeft: "auto",
                    }}
                  >
                    Adj Close <SortIcon column="last_adj_close" />
                  </button>
                </th>
                <th style={{ textAlign: "right", padding: "16px" }}>
                  <button
                    onClick={() => toggleSort("start_date")}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--foreground)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-end",
                      gap: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      padding: 0,
                      marginLeft: "auto",
                    }}
                  >
                    Start Date <SortIcon column="start_date" />
                  </button>
                </th>
                <th style={{ textAlign: "right", padding: "16px" }}>
                  <button
                    onClick={() => toggleSort("end_date")}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--foreground)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-end",
                      gap: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      padding: 0,
                      marginLeft: "auto",
                    }}
                  >
                    End Date <SortIcon column="end_date" />
                  </button>
                </th>
                <th style={{ textAlign: "right", padding: "16px" }}>
                  <button
                    onClick={() => toggleSort("rows")}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--foreground)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-end",
                      gap: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      padding: 0,
                      marginLeft: "auto",
                    }}
                  >
                    Rows <SortIcon column="rows" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedStocks.map((stock) => (
                <tr
                  key={stock.ticker}
                  onClick={() => window.location.href = `/stocks/${stock.ticker}`}
                  style={{ cursor: "pointer" }}
                >
                  <td style={{ padding: "16px" }}>
                    <span style={{
                      color: "var(--accent)",
                      fontWeight: 600,
                      fontSize: 14,
                    }}>
                      {stock.ticker}
                    </span>
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
                    {stock.last_close.toFixed(2)} kr
                  </td>
                  <td style={{
                    padding: "16px",
                    textAlign: "right",
                    fontFamily: "monospace",
                    color: "var(--muted)",
                    fontSize: 14,
                  }}>
                    {stock.last_adj_close.toFixed(2)} kr
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

        {filteredAndSortedStocks.length === 0 && (
          <div style={{
            textAlign: "center",
            padding: 48,
            color: "var(--muted)"
          }}>
            {searchQuery ? `No stocks found matching "${searchQuery}"` : "No stocks found with sufficient IBKR data"}
          </div>
        )}
      </div>
    </div>
  );
}
