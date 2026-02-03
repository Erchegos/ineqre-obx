"use client";

import Link from "next/link";
import { useEffect, useState, useMemo, useCallback } from "react";
import { calculateDataQualityMetrics, type DataTier } from "@/lib/dataQuality";

type AssetType = 'equity' | 'index' | 'commodity_etf' | 'index_etf';

type StockData = {
  ticker: string;
  name: string;
  asset_type: AssetType;
  sector: string | null;
  currency: string;
  last_close: number;
  last_adj_close: number;
  start_date: string;
  end_date: string;
  rows: number;
  // Data quality metrics
  expectedDays: number;
  completenessPct: number;
  dataTier: DataTier;
  dualPair?: string;
};

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  equity: 'Equities',
  index: 'Indexes',
  commodity_etf: 'Commodity ETFs',
  index_etf: 'Index ETFs',
};

export default function StocksPage() {
  const [stocks, setStocks] = useState<StockData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<keyof StockData>("completenessPct");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc"); // Default: highest completeness first
  const [selectedAssetTypes, setSelectedAssetTypes] = useState<Set<AssetType>>(
    new Set(['equity']) // Default to equities only
  );
  const [selectedSectors, setSelectedSectors] = useState<Set<string>>(new Set());
  const [tierFilter, setTierFilter] = useState<'all' | 'tierA' | 'tierAB' | 'ml'>('all');
  const [tickersWithFactors, setTickersWithFactors] = useState<Set<string>>(new Set());

  const fetchStocks = useCallback(async (assetTypes: Set<AssetType>) => {
    setLoading(true);
    try {
      const typesParam = Array.from(assetTypes).join(',');
      const res = await fetch(`/api/stocks?assetTypes=${typesParam}`, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch stocks: ${res.statusText}`);
      }

      const data = await res.json();

      // Calculate data quality metrics for each stock
      const enrichedData = data.map((stock: any) => {
        const metrics = calculateDataQualityMetrics(
          stock.start_date,
          stock.end_date,
          stock.rows,
          stock.ticker
        );

        return {
          ...stock,
          expectedDays: metrics.expectedDays,
          completenessPct: metrics.completenessPct,
          dataTier: metrics.dataTier,
          dualPair: metrics.dualPair,
        };
      });

      setStocks(enrichedData);
      setLoading(false);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStocks(selectedAssetTypes);
  }, [selectedAssetTypes, fetchStocks]);

  // Check which stocks have factor data available (single efficient query)
  useEffect(() => {
    async function checkFactorData() {
      if (stocks.length === 0) return;

      try {
        const res = await fetch("/api/factors/tickers", {
          method: "GET",
          headers: { accept: "application/json" },
          cache: "no-store",
        });

        if (res.ok) {
          const data = await res.json();
          if (data.success && data.tickers) {
            setTickersWithFactors(new Set(data.tickers));
          }
        }
      } catch (e) {
        // Silently skip on error
      }
    }

    checkFactorData();
  }, [stocks]);

  const toggleAssetType = (type: AssetType) => {
    setSelectedAssetTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        // Don't allow deselecting all types
        if (next.size > 1) {
          next.delete(type);
        }
      } else {
        next.add(type);
      }
      return next;
    });
  };

  // Get unique sectors from stocks
  const availableSectors = useMemo(() => {
    const sectors = new Set<string>();
    stocks.forEach(stock => {
      if (stock.sector) sectors.add(stock.sector);
    });
    return Array.from(sectors).sort();
  }, [stocks]);

  const filteredAndSortedStocks = useMemo(() => {
    let filtered = stocks;

    // Filter by tier
    if (tierFilter === 'tierA') {
      filtered = filtered.filter(stock => stock.dataTier === 'A');
    } else if (tierFilter === 'tierAB') {
      filtered = filtered.filter(stock => stock.dataTier === 'A' || stock.dataTier === 'B');
    } else if (tierFilter === 'ml') {
      filtered = filtered.filter(stock => tickersWithFactors.has(stock.ticker));
    }

    // Filter by sector
    if (selectedSectors.size > 0) {
      filtered = filtered.filter(stock =>
        stock.sector && selectedSectors.has(stock.sector)
      );
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
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
  }, [stocks, searchQuery, sortBy, sortOrder, selectedSectors, tierFilter, tickersWithFactors]);

  // Calculate tier counts and ML predictions count for summary panel
  const tierCounts = useMemo(() => {
    const counts = { A: 0, B: 0, C: 0, F: 0 };
    stocks.forEach(stock => {
      counts[stock.dataTier]++;
    });
    return counts;
  }, [stocks]);

  const mlCount = useMemo(() => {
    return tickersWithFactors.size;
  }, [tickersWithFactors]);

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

  const getTierColor = (tier: DataTier): string => {
    switch (tier) {
      case 'A': return '#10b981'; // Green
      case 'B': return '#f59e0b'; // Amber
      case 'C': return '#f97316'; // Orange
      case 'F': return '#ef4444'; // Red
      default: return 'var(--muted)';
    }
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
            <h1 style={{ fontSize: 32, fontWeight: 700, margin: 0 }}>Assets</h1>
            <Link
              href="/"
              style={{
                display: "inline-block",
                color: "var(--foreground)",
                textDecoration: "none",
                fontSize: 13,
                fontWeight: 500,
                padding: "8px 16px",
                border: "1px solid var(--border)",
                borderRadius: 4,
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
              Home
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
        <p style={{ color: "var(--muted)", marginBottom: 16, fontSize: 14 }}>
          Universe: {stocks.length} assets | Tier A: {tierCounts.A} | Tier B: {tierCounts.B} | Tier C: {tierCounts.C} | Tier F: {tierCounts.F} | <span style={{ color: '#10b981', fontWeight: 600 }}>ML Ready: {mlCount}</span>
          <span style={{ marginLeft: 16, fontSize: 13 }}>Source: Interactive Brokers</span>
        </p>

        {/* Tier Filters */}
        <div style={{
          display: "flex",
          gap: 8,
          marginBottom: 16,
          flexWrap: "wrap"
        }}>
          {[
            { key: 'all', label: 'All' },
            { key: 'tierA', label: 'Tier A Only' },
            { key: 'tierAB', label: 'A+B Only' },
            { key: 'ml', label: 'ML Ready' },
          ].map((filter) => {
            const isSelected = tierFilter === filter.key;
            return (
              <button
                key={filter.key}
                onClick={() => setTierFilter(filter.key as typeof tierFilter)}
                style={{
                  padding: "8px 14px",
                  fontSize: 12,
                  fontWeight: 500,
                  border: isSelected ? "1px solid var(--accent)" : "1px solid var(--border)",
                  borderRadius: 4,
                  background: isSelected ? "var(--accent)" : "var(--card-bg)",
                  color: isSelected ? "#fff" : "var(--foreground)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  whiteSpace: "nowrap",
                  transform: "scale(1)",
                  boxShadow: isSelected ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
                }}
                onMouseEnter={(e) => {
                  if (isSelected) {
                    e.currentTarget.style.filter = "brightness(0.9)";
                  } else {
                    e.currentTarget.style.borderColor = "var(--accent)";
                    e.currentTarget.style.background = "var(--hover-bg)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (isSelected) {
                    e.currentTarget.style.filter = "brightness(1)";
                  } else {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.background = "var(--card-bg)";
                  }
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = "scale(0.95)";
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = "scale(1)";
                }}
              >
                {filter.label}
              </button>
            );
          })}
        </div>

        {/* Search Bar with Asset Type Filters */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 24,
          flexWrap: "wrap"
        }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <input
              type="text"
              className="search-input"
              placeholder="Search by ticker or name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Asset Type Toggles */}
          <div style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap"
          }}>
            {(Object.keys(ASSET_TYPE_LABELS) as AssetType[]).map((type) => {
              const isSelected = selectedAssetTypes.has(type);
              return (
                <button
                  key={type}
                  onClick={() => toggleAssetType(type)}
                  style={{
                    padding: "10px 14px",
                    fontSize: 12,
                    fontWeight: 500,
                    border: isSelected ? "1px solid var(--accent)" : "1px solid var(--border)",
                    borderRadius: 4,
                    background: isSelected ? "var(--accent)" : "var(--card-bg)",
                    color: isSelected ? "#fff" : "var(--foreground)",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                    whiteSpace: "nowrap",
                    transform: "scale(1)",
                    boxShadow: isSelected ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
                  }}
                  onMouseEnter={(e) => {
                    if (isSelected) {
                      e.currentTarget.style.filter = "brightness(0.9)";
                    } else {
                      e.currentTarget.style.borderColor = "var(--accent)";
                      e.currentTarget.style.background = "var(--hover-bg)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (isSelected) {
                      e.currentTarget.style.filter = "brightness(1)";
                    } else {
                      e.currentTarget.style.borderColor = "var(--border)";
                      e.currentTarget.style.background = "var(--card-bg)";
                    }
                  }}
                  onMouseDown={(e) => {
                    e.currentTarget.style.transform = "scale(0.95)";
                  }}
                  onMouseUp={(e) => {
                    e.currentTarget.style.transform = "scale(1)";
                  }}
                >
                  {ASSET_TYPE_LABELS[type]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Sector Filters */}
        {availableSectors.length > 0 && (
          <div style={{
            marginBottom: 24,
            padding: 16,
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
            borderRadius: 4,
          }}>
            <div style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--muted-foreground)",
              marginBottom: 12,
              textTransform: "uppercase",
              letterSpacing: "0.05em"
            }}>
              Filter by Sector
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {availableSectors.map((sector) => {
                const isSelected = selectedSectors.has(sector);
                return (
                  <button
                    key={sector}
                    onClick={() => {
                      setSelectedSectors(prev => {
                        const next = new Set(prev);
                        if (next.has(sector)) {
                          next.delete(sector);
                        } else {
                          next.add(sector);
                        }
                        return next;
                      });
                    }}
                    style={{
                      padding: "6px 12px",
                      fontSize: 11.5,
                      fontWeight: 500,
                      border: isSelected ? "1px solid var(--accent)" : "1px solid var(--border)",
                      borderRadius: 3,
                      background: isSelected ? "var(--accent)" : "transparent",
                      color: isSelected ? "#fff" : "var(--foreground)",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                      whiteSpace: "nowrap",
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderColor = "var(--accent)";
                        e.currentTarget.style.background = "var(--hover-bg)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderColor = "var(--border)";
                        e.currentTarget.style.background = "transparent";
                      }
                    }}
                  >
                    {sector}
                  </button>
                );
              })}
              {selectedSectors.size > 0 && (
                <button
                  onClick={() => setSelectedSectors(new Set())}
                  style={{
                    padding: "6px 12px",
                    fontSize: 11.5,
                    fontWeight: 500,
                    border: "1px solid var(--danger)",
                    borderRadius: 3,
                    background: "transparent",
                    color: "var(--danger)",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                    whiteSpace: "nowrap",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--danger)";
                    e.currentTarget.style.color = "#fff";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "var(--danger)";
                  }}
                >
                  Clear Filters
                </button>
              )}
            </div>
          </div>
        )}

        {searchQuery && (
          <div style={{ marginTop: -16, marginBottom: 16, fontSize: 13, color: "var(--muted)" }}>
            Found {filteredAndSortedStocks.length} result{filteredAndSortedStocks.length !== 1 ? 's' : ''}
          </div>
        )}

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
                <th style={{ textAlign: "left", padding: "16px" }}>
                  <button
                    onClick={() => toggleSort("sector")}
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
                    Sector <SortIcon column="sector" />
                  </button>
                </th>
                <th style={{ textAlign: "left", padding: "16px" }}>
                  <button
                    onClick={() => toggleSort("currency")}
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
                    Currency <SortIcon column="currency" />
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
                <th style={{ textAlign: "right", padding: "16px" }}>
                  <button
                    onClick={() => toggleSort("expectedDays")}
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
                    Expected <SortIcon column="expectedDays" />
                  </button>
                </th>
                <th style={{ textAlign: "right", padding: "16px" }}>
                  <button
                    onClick={() => toggleSort("completenessPct")}
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
                    Complete <SortIcon column="completenessPct" />
                  </button>
                </th>
                <th style={{ textAlign: "center", padding: "16px" }}>
                  <button
                    onClick={() => toggleSort("dataTier")}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--foreground)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      padding: 0,
                      margin: "0 auto",
                    }}
                  >
                    Tier <SortIcon column="dataTier" />
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
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{
                        color: "var(--accent)",
                        fontWeight: 600,
                        fontSize: 14,
                      }}>
                        {stock.ticker}
                      </span>
                      {tickersWithFactors.has(stock.ticker) && (
                        <span style={{
                          fontSize: 9,
                          fontWeight: 700,
                          padding: "2px 5px",
                          borderRadius: 2,
                          background: '#10b981',
                          color: '#fff',
                          fontFamily: 'monospace',
                        }}>
                          ML
                        </span>
                      )}
                      {selectedAssetTypes.size > 1 && stock.asset_type !== 'equity' && (
                        <span style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: "2px 6px",
                          borderRadius: 3,
                          background: stock.asset_type === 'index' ? '#3b82f6' :
                                     stock.asset_type === 'commodity_etf' ? '#f59e0b' :
                                     stock.asset_type === 'index_etf' ? '#8b5cf6' : 'var(--muted)',
                          color: '#fff',
                          textTransform: 'uppercase',
                        }}>
                          {stock.asset_type === 'index' ? 'IDX' :
                           stock.asset_type === 'commodity_etf' ? 'C-ETF' :
                           stock.asset_type === 'index_etf' ? 'I-ETF' : stock.asset_type}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: "16px", color: "var(--foreground)", fontSize: 14 }}>
                    {stock.name}
                  </td>
                  <td style={{ padding: "16px", color: "var(--muted-foreground)", fontSize: 13 }}>
                    {stock.sector || '—'}
                  </td>
                  <td style={{ padding: "16px", color: "var(--foreground)", fontSize: 13, fontWeight: 500 }}>
                    {stock.currency || 'NOK'}
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
                  <td style={{
                    padding: "16px",
                    textAlign: "right",
                    fontFamily: "monospace",
                    color: "var(--muted)",
                    fontSize: 13,
                  }}>
                    {stock.expectedDays.toLocaleString()}
                  </td>
                  <td style={{
                    padding: "16px",
                    textAlign: "right",
                    fontFamily: "monospace",
                    color: "var(--foreground)",
                    fontSize: 13,
                    fontWeight: 500,
                  }}>
                    {stock.completenessPct.toFixed(1)}%
                  </td>
                  <td style={{
                    padding: "16px",
                    textAlign: "center",
                    fontFamily: "monospace",
                    color: getTierColor(stock.dataTier),
                    fontSize: 14,
                    fontWeight: 700,
                  }}>
                    {stock.dataTier}
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
