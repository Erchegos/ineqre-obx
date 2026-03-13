"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { Workbook, WorkbookInstance } from "@fortune-sheet/react";
import "@fortune-sheet/react/dist/index.css";
import type { Sheet, CellWithRowAndCol } from "@fortune-sheet/core";
import {
  ValuationRow,
  fetchBulkValuation,
  computeMultiples,
} from "@/lib/valuationData";
import {
  loadValuationEdits,
  saveValuationEdits,
  clearValuationEdits,
  ValuationEdits,
} from "@/lib/valuationStorage";

// Column definitions
const COLUMNS = [
  { key: "ticker", label: "Ticker", width: 80 },
  { key: "name", label: "Name", width: 160 },
  { key: "sector", label: "Sector", width: 120 },
  { key: "price", label: "Price", width: 80 },
  { key: "pe", label: "P/E", width: 70 },
  { key: "pb", label: "P/B", width: 70 },
  { key: "evEbitda", label: "EV/EBITDA", width: 85 },
  { key: "dyPct", label: "DY%", width: 65 },
  { key: "ps", label: "P/S", width: 65 },
  { key: "mktcapB", label: "MCap(B)", width: 80 },
  { key: "targetPrice", label: "Target", width: 80 },
  { key: "customEps", label: "Cust.EPS", width: 80 },
  { key: "impliedUpside", label: "Upside%", width: 80 },
  { key: "notes", label: "Notes", width: 200 },
];

const EDITABLE_COLS = new Set([10, 11, 13]); // targetPrice, customEps, notes
const HEADER_ROW = 0;

function fmt(val: number | null, decimals = 1): string {
  if (val == null || !isFinite(val)) return "";
  return val.toFixed(decimals);
}

function buildCellData(
  rows: ValuationRow[],
  edits: ValuationEdits
): CellWithRowAndCol[] {
  const cells: CellWithRowAndCol[] = [];

  // Header row
  COLUMNS.forEach((col, c) => {
    cells.push({
      r: HEADER_ROW,
      c,
      v: {
        v: col.label,
        m: col.label,
        bl: 1,
        fc: "#ffffff",
        bg: "#1a1a2e",
        ht: 0,
      },
    });
  });

  // Data rows
  rows.forEach((row, i) => {
    const r = i + 1;
    const m = computeMultiples(row);
    const edit = edits[row.ticker] || {};

    const values: (string | number | null)[] = [
      row.ticker,
      row.name,
      row.sector,
      row.price,
      m.pe != null ? parseFloat(fmt(m.pe)) : null,
      m.pb != null ? parseFloat(fmt(m.pb)) : null,
      m.evEbitda != null ? parseFloat(fmt(m.evEbitda)) : null,
      m.dyPct != null ? parseFloat(fmt(m.dyPct)) : null,
      m.ps != null ? parseFloat(fmt(m.ps)) : null,
      m.mktcapB != null ? parseFloat(fmt(m.mktcapB, 2)) : null,
      edit.targetPrice ?? null,
      edit.customEps ?? null,
      // Implied upside: (target / price) - 1
      edit.targetPrice && row.price
        ? parseFloat(
            ((edit.targetPrice / row.price - 1) * 100).toFixed(1)
          )
        : null,
      edit.notes ?? null,
    ];

    values.forEach((val, c) => {
      const cell: CellWithRowAndCol = {
        r,
        c,
        v: {
          v: val ?? "",
          m: val != null ? String(val) : "",
        },
      };

      // Style editable cells differently
      if (EDITABLE_COLS.has(c)) {
        cell.v = {
          ...cell.v!,
          bg: "#1a1a3a",
        };
      }

      // Color implied upside
      if (c === 12 && typeof val === "number") {
        cell.v = {
          ...cell.v!,
          fc: val > 0 ? "#4CAF50" : val < 0 ? "#F44336" : "#9E9E9E",
          bl: 1,
        };
      }

      // Style ticker column
      if (c === 0) {
        cell.v = { ...cell.v!, bl: 1, fc: "#64B5F6" };
      }

      cells.push(cell);
    });
  });

  return cells;
}

type Props = {
  sectorFilter?: string;
  tickerFilter?: string[];
};

export default function ValuationSpreadsheet({
  sectorFilter,
  tickerFilter,
}: Props) {
  const [rows, setRows] = useState<ValuationRow[]>([]);
  const [edits, setEdits] = useState<ValuationEdits>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const workbookRef = useRef<WorkbookInstance>(null);

  // Load data
  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const data = await fetchBulkValuation();
        setRows(data);
        setEdits(loadValuationEdits());
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Filter rows
  const filteredRows = useMemo(() => {
    let result = rows;
    if (sectorFilter && sectorFilter !== "All") {
      result = result.filter((r) => r.sector === sectorFilter);
    }
    if (tickerFilter && tickerFilter.length > 0) {
      const set = new Set(tickerFilter);
      result = result.filter((r) => set.has(r.ticker));
    }
    return result;
  }, [rows, sectorFilter, tickerFilter]);

  // Build sheet data
  const sheetData = useMemo((): Sheet[] => {
    if (filteredRows.length === 0) return [{ name: "Valuation", celldata: [] }];

    const celldata = buildCellData(filteredRows, edits);
    const colWidths: Record<string, number> = {};
    COLUMNS.forEach((col, i) => {
      colWidths[String(i)] = col.width;
    });

    return [
      {
        name: "Valuation",
        celldata,
        id: "valuation",
        row: filteredRows.length + 1,
        column: COLUMNS.length,
        config: {
          columnlen: colWidths,
          rowlen: { "0": 30 },
        },
        frozen: {
          type: "rangeColumn" as const,
          range: { row_focus: 0, column_focus: 2 },
        },
      },
    ];
  }, [filteredRows, edits]);

  // Handle cell changes
  const handleChange = useCallback(
    (data: Sheet[]) => {
      if (!data[0]?.data || filteredRows.length === 0) return;

      const sheetMatrix = data[0].data;
      const newEdits = { ...edits };
      let changed = false;

      filteredRows.forEach((row, i) => {
        const r = i + 1;
        if (!sheetMatrix[r]) return;

        const targetCell = sheetMatrix[r][10];
        const epsCell = sheetMatrix[r][11];
        const notesCell = sheetMatrix[r][13];

        const targetVal = targetCell?.v;
        const epsVal = epsCell?.v;
        const notesVal = notesCell?.v;

        const current = newEdits[row.ticker] || {};
        const newEdit = { ...current };

        // Target price
        if (targetVal != null && targetVal !== "" && !isNaN(Number(targetVal))) {
          if (newEdit.targetPrice !== Number(targetVal)) {
            newEdit.targetPrice = Number(targetVal);
            changed = true;
          }
        } else if (targetVal === "" || targetVal == null) {
          if (newEdit.targetPrice !== undefined) {
            delete newEdit.targetPrice;
            changed = true;
          }
        }

        // Custom EPS
        if (epsVal != null && epsVal !== "" && !isNaN(Number(epsVal))) {
          if (newEdit.customEps !== Number(epsVal)) {
            newEdit.customEps = Number(epsVal);
            changed = true;
          }
        } else if (epsVal === "" || epsVal == null) {
          if (newEdit.customEps !== undefined) {
            delete newEdit.customEps;
            changed = true;
          }
        }

        // Notes
        if (notesVal != null && String(notesVal) !== "") {
          if (newEdit.notes !== String(notesVal)) {
            newEdit.notes = String(notesVal);
            changed = true;
          }
        } else if (notesVal === "" || notesVal == null) {
          if (newEdit.notes !== undefined) {
            delete newEdit.notes;
            changed = true;
          }
        }

        if (Object.keys(newEdit).length > 0) {
          newEdits[row.ticker] = newEdit;
        } else {
          delete newEdits[row.ticker];
        }
      });

      if (changed) {
        setEdits(newEdits);
        saveValuationEdits(newEdits);
      }
    },
    [filteredRows, edits]
  );

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "400px", color: "#9E9E9E" }}>
        Loading valuation data...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "400px", color: "#F44336" }}>
        Error: {error}
      </div>
    );
  }

  if (filteredRows.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "400px", color: "#9E9E9E" }}>
        No stocks match the current filters.
      </div>
    );
  }

  return (
    <div className="valuation-sheet-wrapper" style={{ width: "100%", height: "calc(100vh - 160px)" }}>
      <Workbook
        ref={workbookRef}
        data={sheetData}
        onChange={handleChange}
        showToolbar={false}
        showFormulaBar={false}
        showSheetTabs={false}
        allowEdit={true}
        column={COLUMNS.length}
        row={filteredRows.length + 1}
      />
      <style>{`
        .valuation-sheet-wrapper {
          border: 1px solid #333;
          border-radius: 4px;
          overflow: hidden;
        }
        /* Dark mode overrides for Fortune-Sheet */
        .valuation-sheet-wrapper .fortune-sheet-container {
          background: #0d1117 !important;
        }
        .valuation-sheet-wrapper .luckysheet-cell-input {
          background: #1a1a2e !important;
          color: #e0e0e0 !important;
        }
        .valuation-sheet-wrapper .luckysheet-sheet-area {
          background: #0d1117 !important;
        }
        .valuation-sheet-wrapper .luckysheet-cols-h-cells .luckysheet-cols-h-cell {
          background: #161b22 !important;
          color: #9E9E9E !important;
          border-color: #333 !important;
        }
        .valuation-sheet-wrapper .luckysheet-rows-h-cells .luckysheet-rows-h-cell {
          background: #161b22 !important;
          color: #9E9E9E !important;
          border-color: #333 !important;
        }
        .valuation-sheet-wrapper .luckysheet-cell-flow .luckysheet-cell {
          border-color: #2a2a3e !important;
        }
        .valuation-sheet-wrapper .fortune-sheet-overlay {
          background: transparent !important;
        }
        .valuation-sheet-wrapper .luckysheet-scrollbar-x,
        .valuation-sheet-wrapper .luckysheet-scrollbar-y {
          background: #1a1a2e !important;
        }
        .valuation-sheet-wrapper .luckysheet-scrollbar-x .luckysheet-scrollbar-content,
        .valuation-sheet-wrapper .luckysheet-scrollbar-y .luckysheet-scrollbar-content {
          background: #444 !important;
          border-radius: 3px !important;
        }
      `}</style>
    </div>
  );
}
