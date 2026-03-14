"use client";

import { useState, useCallback, useEffect, useRef } from "react";

interface StockInfo {
  name: string;
  lastPrice: number;
  sector: string;
}

interface ManualWeight {
  ticker: string;
  weight: number;
  amount: number;
  shares: number;
}

interface ManualWeightEditorProps {
  tickers: string[];
  stockInfo: Record<string, StockInfo>;
  portfolioValueNOK: number;
  onWeightsChange: (weights: { ticker: string; weight: number }[]) => void;
}

const SECTOR_COLORS: Record<string, string> = {
  Energy: "#f97316",
  Financials: "#3b82f6",
  Materials: "#a855f7",
  Industrials: "#6b7280",
  "Consumer Staples": "#22c55e",
  "Consumer Discretionary": "#ec4899",
  Technology: "#06b6d4",
  "Communication Services": "#eab308",
  Utilities: "#14b8a6",
  "Real Estate": "#8b5cf6",
  Healthcare: "#ef4444",
  Shipping: "#0ea5e9",
  Seafood: "#10b981",
  Unknown: "#6b7280",
};

export default function ManualWeightEditor({
  tickers,
  stockInfo,
  portfolioValueNOK,
  onWeightsChange,
}: ManualWeightEditorProps) {
  const [rows, setRows] = useState<ManualWeight[]>([]);
  // Track editing state per cell — when editing, show raw string; when not, show formatted value
  const [editingCell, setEditingCell] = useState<{ idx: number; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const prevPortfolioValue = useRef(portfolioValueNOK);

  // Initialize rows when tickers change
  useEffect(() => {
    setRows(prev => {
      const existing = new Map(prev.map(r => [r.ticker, r]));
      const equalWeight = 1 / tickers.length;
      return tickers.map(t => {
        if (existing.has(t)) return existing.get(t)!;
        const price = stockInfo[t]?.lastPrice || 0;
        const amount = equalWeight * portfolioValueNOK;
        return {
          ticker: t,
          weight: equalWeight,
          amount,
          shares: price > 0 ? Math.floor(amount / price) : 0,
        };
      });
    });
  }, [tickers, stockInfo, portfolioValueNOK]);

  // Auto-recalculate amounts/shares when portfolio value changes
  useEffect(() => {
    if (prevPortfolioValue.current !== portfolioValueNOK && rows.length > 0) {
      prevPortfolioValue.current = portfolioValueNOK;
      setRows(prev => prev.map(r => {
        const price = stockInfo[r.ticker]?.lastPrice || 0;
        const amount = r.weight * portfolioValueNOK;
        return {
          ...r,
          amount,
          shares: price > 0 ? Math.floor(amount / price) : 0,
        };
      }));
    }
  }, [portfolioValueNOK, stockInfo, rows.length]);

  // Notify parent on change
  useEffect(() => {
    onWeightsChange(rows.map(r => ({ ticker: r.ticker, weight: r.weight })));
  }, [rows, onWeightsChange]);

  const updateRow = useCallback((index: number, field: "weight" | "amount" | "shares", value: number) => {
    setRows(prev => {
      const next = [...prev];
      const row = { ...next[index] };
      const price = stockInfo[row.ticker]?.lastPrice || 0;

      if (field === "weight") {
        row.weight = value;
        row.amount = value * portfolioValueNOK;
        row.shares = price > 0 ? Math.floor(row.amount / price) : 0;
      } else if (field === "amount") {
        row.amount = value;
        row.weight = portfolioValueNOK > 0 ? value / portfolioValueNOK : 0;
        row.shares = price > 0 ? Math.floor(value / price) : 0;
      } else if (field === "shares") {
        row.shares = value;
        row.amount = price * value;
        row.weight = portfolioValueNOK > 0 ? row.amount / portfolioValueNOK : 0;
      }

      next[index] = row;
      return next;
    });
  }, [stockInfo, portfolioValueNOK]);

  // Apply a specific set of weights (used by parent for suggested weights)
  const applyWeights = useCallback((newWeights: Record<string, number>) => {
    setRows(prev => prev.map(r => {
      const w = newWeights[r.ticker] ?? r.weight;
      const price = stockInfo[r.ticker]?.lastPrice || 0;
      const amount = w * portfolioValueNOK;
      return {
        ...r,
        weight: w,
        amount,
        shares: price > 0 ? Math.floor(amount / price) : 0,
      };
    }));
  }, [stockInfo, portfolioValueNOK]);

  // Expose applyWeights to parent via ref-like pattern through onWeightsChange
  // We'll use a different approach - expose via a prop callback
  // Actually, let's use the imperative handle pattern but simpler:
  // The parent will call setManualWeights which triggers re-render with new weights

  const normalize = useCallback(() => {
    setRows(prev => {
      const total = prev.reduce((s, r) => s + r.weight, 0);
      if (total <= 0) return prev;
      return prev.map(r => {
        const w = r.weight / total;
        const amount = w * portfolioValueNOK;
        const price = stockInfo[r.ticker]?.lastPrice || 0;
        return {
          ...r,
          weight: w,
          amount,
          shares: price > 0 ? Math.floor(amount / price) : 0,
        };
      });
    });
  }, [portfolioValueNOK, stockInfo]);

  const equalWeight = useCallback(() => {
    setRows(prev => {
      const w = 1 / prev.length;
      return prev.map(r => {
        const amount = w * portfolioValueNOK;
        const price = stockInfo[r.ticker]?.lastPrice || 0;
        return {
          ...r,
          weight: w,
          amount,
          shares: price > 0 ? Math.floor(amount / price) : 0,
        };
      });
    });
  }, [portfolioValueNOK, stockInfo]);

  // Handle starting to edit a cell
  const startEdit = (idx: number, field: "weight" | "amount" | "shares") => {
    setEditingCell({ idx, field });
    const row = rows[idx];
    if (field === "weight") {
      setEditValue(parseFloat((row.weight * 100).toFixed(1)).toString());
    } else if (field === "amount") {
      setEditValue(Math.round(row.amount).toString());
    } else {
      setEditValue(row.shares.toString());
    }
  };

  // Commit edit value
  const commitEdit = () => {
    if (!editingCell) return;
    const { idx, field } = editingCell;
    const num = parseFloat(editValue) || 0;
    if (field === "weight") {
      updateRow(idx, "weight", num / 100);
    } else if (field === "amount") {
      updateRow(idx, "amount", num);
    } else {
      updateRow(idx, "shares" as "shares", Math.floor(num));
    }
    setEditingCell(null);
    setEditValue("");
  };

  // Cancel edit
  const cancelEdit = () => {
    setEditingCell(null);
    setEditValue("");
  };

  const totalWeight = rows.reduce((s, r) => s + r.weight, 0);
  const totalAmount = rows.reduce((s, r) => s + r.amount, 0);
  const isNormalized = Math.abs(totalWeight - 1) < 0.001;

  const cellStyle: React.CSSProperties = {
    padding: "6px 8px",
    fontFamily: "monospace",
    fontSize: 12,
    borderBottom: "1px solid #21262d",
    whiteSpace: "nowrap",
  };

  const inputStyle: React.CSSProperties = {
    width: 90,
    padding: "4px 6px",
    background: "#0d1117",
    border: "1px solid #30363d",
    borderRadius: 3,
    color: "#fff",
    fontSize: 12,
    fontFamily: "monospace",
    textAlign: "right",
    outline: "none",
  };

  const renderInput = (idx: number, field: "weight" | "amount" | "shares", row: ManualWeight) => {
    const isEditing = editingCell?.idx === idx && editingCell?.field === field;

    if (isEditing) {
      return (
        <input
          autoFocus
          type="text"
          inputMode="decimal"
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => {
            if (e.key === "Enter") {
              commitEdit();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === "Escape") {
              cancelEdit();
            }
          }}
          style={{ ...inputStyle, borderColor: "#3b82f6" }}
        />
      );
    }

    // Display mode — click to edit
    let displayValue: string;
    if (field === "weight") {
      displayValue = parseFloat((row.weight * 100).toFixed(1)).toString();
    } else if (field === "amount") {
      displayValue = Math.round(row.amount).toLocaleString("no-NO");
    } else {
      displayValue = row.shares.toString();
    }

    return (
      <input
        type="text"
        readOnly
        value={displayValue}
        onFocus={() => startEdit(idx, field)}
        onClick={() => startEdit(idx, field)}
        style={inputStyle}
      />
    );
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
        <button
          onClick={normalize}
          style={{
            padding: "5px 12px",
            background: isNormalized ? "#21262d" : "#1f6feb",
            border: "1px solid #30363d",
            borderRadius: 4,
            color: isNormalized ? "rgba(255,255,255,0.4)" : "#fff",
            fontSize: 11,
            fontFamily: "monospace",
            fontWeight: 700,
            cursor: "pointer",
            letterSpacing: "0.05em",
          }}
        >
          NORMALIZE TO 100%
        </button>
        <button
          onClick={equalWeight}
          style={{
            padding: "5px 12px",
            background: "#21262d",
            border: "1px solid #30363d",
            borderRadius: 4,
            color: "rgba(255,255,255,0.7)",
            fontSize: 11,
            fontFamily: "monospace",
            fontWeight: 700,
            cursor: "pointer",
            letterSpacing: "0.05em",
          }}
        >
          EQUAL WEIGHT
        </button>
        <div style={{
          marginLeft: "auto",
          fontSize: 11,
          fontFamily: "monospace",
          color: isNormalized ? "#10b981" : "#ef4444",
          fontWeight: 700,
        }}>
          TOTAL: {(totalWeight * 100).toFixed(1)}%
          {!isNormalized && " (not normalized)"}
        </div>
      </div>

      <div style={{ overflowX: "auto", border: "1px solid #30363d", borderRadius: 4 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 650 }}>
          <thead>
            <tr style={{ background: "#161b22" }}>
              <th style={{ ...cellStyle, textAlign: "left", fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 600, letterSpacing: "0.1em" }}>TICKER</th>
              <th style={{ ...cellStyle, textAlign: "left", fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 600, letterSpacing: "0.1em" }}>NAME</th>
              <th style={{ ...cellStyle, textAlign: "right", fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 600, letterSpacing: "0.1em" }}>PRICE</th>
              <th style={{ ...cellStyle, textAlign: "right", fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 600, letterSpacing: "0.1em" }}>WEIGHT %</th>
              <th style={{ ...cellStyle, textAlign: "right", fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 600, letterSpacing: "0.1em" }}>AMOUNT (NOK)</th>
              <th style={{ ...cellStyle, textAlign: "right", fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 600, letterSpacing: "0.1em" }}>SHARES</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const info = stockInfo[row.ticker];
              const sectorColor = SECTOR_COLORS[info?.sector || "Unknown"] || "#6b7280";
              return (
                <tr key={row.ticker} style={{ background: idx % 2 === 0 ? "#0d1117" : "#161b22" }}>
                  <td style={{ ...cellStyle, textAlign: "left" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{
                        width: 6, height: 6, borderRadius: "50%",
                        background: sectorColor, display: "inline-block", flexShrink: 0,
                      }} />
                      <span style={{ fontWeight: 700, color: "#fff" }}>{row.ticker}</span>
                    </div>
                  </td>
                  <td style={{ ...cellStyle, textAlign: "left", color: "rgba(255,255,255,0.5)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {info?.name || row.ticker}
                  </td>
                  <td style={{ ...cellStyle, textAlign: "right", color: "rgba(255,255,255,0.6)" }}>
                    {info?.lastPrice ? info.lastPrice.toFixed(2) : "—"}
                  </td>
                  <td style={{ ...cellStyle, textAlign: "right" }}>
                    {renderInput(idx, "weight", row)}
                  </td>
                  <td style={{ ...cellStyle, textAlign: "right" }}>
                    {renderInput(idx, "amount", row)}
                  </td>
                  <td style={{ ...cellStyle, textAlign: "right" }}>
                    {renderInput(idx, "shares", row)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: "#161b22", borderTop: "2px solid #30363d" }}>
              <td colSpan={3} style={{ ...cellStyle, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>TOTAL</td>
              <td style={{ ...cellStyle, textAlign: "right", fontWeight: 700, color: isNormalized ? "#10b981" : "#ef4444" }}>
                {(totalWeight * 100).toFixed(1)}%
              </td>
              <td style={{ ...cellStyle, textAlign: "right", fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>
                {totalAmount.toLocaleString("no-NO", { maximumFractionDigits: 0 })}
              </td>
              <td style={cellStyle} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// Export applyWeights helper type for parent usage
export type { ManualWeightEditorProps };
