"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Workbook, WorkbookInstance } from "@fortune-sheet/react";
import "@fortune-sheet/react/dist/index.css";
import type { Sheet } from "@fortune-sheet/core";

type Props = {
  ticker: string;
  token: string | null;
  profileName: string;
  onNeedLogin: () => void;
  onLogout?: () => void;
};

export default function StockSpreadsheet({ ticker, token, profileName, onNeedLogin, onLogout }: Props) {
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [hasChanges, setHasChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [usingSavedEdits, setUsingSavedEdits] = useState(false);
  const [mountKey, setMountKey] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [hasServerFile, setHasServerFile] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const workbookRef = useRef<WorkbookInstance>(null);
  const baseSheets = useRef<Sheet[] | null>(null);

  // Convert sheets to celldata format (Fortune-Sheet needs this on mount).
  // IMPORTANT: Always prefer `data` (2D array with live edits) over `celldata`
  // (which may be stale from initial mount). Fortune-Sheet updates `data` but
  // leaves the original `celldata` unchanged internally.
  const ensureCelldata = useCallback((sheetsData: any[]): any[] => {
    return sheetsData.map((sheet: any) => {
      const s = { ...sheet };
      // If sheet has 2D data array, always convert it (it has the latest edits)
      if (s.data && Array.isArray(s.data)) {
        const celldata: { r: number; c: number; v: any }[] = [];
        for (let r = 0; r < s.data.length; r++) {
          const row = s.data[r];
          if (!Array.isArray(row)) continue;
          for (let c = 0; c < row.length; c++) {
            if (row[c] != null) {
              celldata.push({ r, c, v: row[c] });
            }
          }
        }
        s.celldata = celldata;
        delete s.data;
      }
      return s;
    });
  }, []);

  // Load sheets into state with fresh clone
  const applySheets = useCallback((data: Sheet[]) => {
    const fixed = ensureCelldata(data);
    const cloned = JSON.parse(JSON.stringify(fixed));
    setSheets(cloned);
    setMountKey((k) => k + 1);
  }, [ensureCelldata]);

  // Load spreadsheet data
  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      setSheets(null);
      setHasChanges(false);
      setSaveStatus("idle");
      setUsingSavedEdits(false);
      setHasServerFile(false);

      try {
        // 1. Fetch base Excel data from server
        const res = await fetch(`/api/valuation/excel?ticker=${ticker}`);
        const json = await res.json();

        if (json.success) {
          baseSheets.current = json.sheets;
          setFileName(json.fileName || "");
          setHasServerFile(true);

          let finalSheets = json.sheets;

          // 2. If authenticated, check for saved edits
          if (token) {
            try {
              const editsRes = await fetch(`/api/valuation/excel/edits?ticker=${ticker}`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (editsRes.ok) {
                const editsJson = await editsRes.json();
                // Only use saved edits if they actually have real cell data
                if (editsJson.edits && Array.isArray(editsJson.edits) && editsJson.edits.length > 0) {
                  const hasData = editsJson.edits.some((s: any) => {
                    // celldata format: array of {r, c, v} — non-empty means real data
                    if (s.celldata && Array.isArray(s.celldata) && s.celldata.length > 0) return true;
                    // data format: 2D array — check for at least one non-null cell
                    if (s.data && Array.isArray(s.data)) {
                      return s.data.some((row: any) =>
                        Array.isArray(row) && row.some((cell: any) => cell != null)
                      );
                    }
                    return false;
                  });
                  if (hasData) {
                    finalSheets = editsJson.edits;
                    setUsingSavedEdits(true);
                    setLastSaved(editsJson.updatedAt || null);
                  }
                }
              }
            } catch {
              // Ignore — fall back to base
            }
          }

          applySheets(finalSheets);
        } else {
          // No server file — check for user-uploaded edits
          if (token) {
            try {
              const editsRes = await fetch(`/api/valuation/excel/edits?ticker=${ticker}`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (editsRes.ok) {
                const editsJson = await editsRes.json();
                if (editsJson.edits && Array.isArray(editsJson.edits) && editsJson.edits.length > 0) {
                  const hasData = editsJson.edits.some((s: any) => {
                    if (s.celldata && Array.isArray(s.celldata) && s.celldata.length > 0) return true;
                    if (s.data && Array.isArray(s.data)) {
                      return s.data.some((row: any) =>
                        Array.isArray(row) && row.some((cell: any) => cell != null)
                      );
                    }
                    return false;
                  });
                  if (hasData) {
                    baseSheets.current = editsJson.edits;
                    setFileName("Uploaded file");
                    setUsingSavedEdits(true);
                    applySheets(editsJson.edits);
                    return;
                  }
                }
              }
            } catch { /* ignore */ }
          }
          // Show empty state for file upload
          setError("no-file");
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [ticker, token, applySheets]);

  // Handle file upload (drag-drop or click)
  const handleFileUpload = useCallback(async (file: File) => {
    if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
      alert("Only .xlsx files are supported");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/valuation/excel", { method: "POST", body: formData });
      const json = await res.json();

      if (!json.success) {
        setError(json.error || "Failed to parse file");
        return;
      }

      baseSheets.current = json.sheets;
      setFileName(json.fileName || file.name);
      setHasChanges(true);
      applySheets(json.sheets);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [applySheets]);

  // Save handler
  const handleSave = useCallback(async () => {
    if (!token || !workbookRef.current) {
      onNeedLogin();
      return;
    }

    // Commit any in-progress cell edit before reading sheets.
    // Fortune-Sheet uses a contenteditable div — pressing Enter or clicking away commits.
    // We simulate pressing Escape/Enter on the cell input, then blur.
    const cellInput = document.querySelector(".luckysheet-cell-input") as HTMLElement | null;
    if (cellInput) {
      cellInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
    }
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    // Small delay to let Fortune-Sheet commit the cell value
    await new Promise((r) => setTimeout(r, 100));

    setSaveStatus("saving");
    try {
      const allSheets = workbookRef.current.getAllSheets();

      // Fortune-Sheet internally converts celldata→data (2D array).
      // We must convert back to celldata format for reliable reload.
      const sheetsToSave = ensureCelldata(allSheets);

      console.log("[StockSpreadsheet] Saving", sheetsToSave.length, "sheets for", ticker);
      sheetsToSave.forEach((s: any, i: number) => {
        const cd = s.celldata?.length || 0;
        console.log(`  Sheet ${i} [${s.name}] celldata=${cd}`);
      });

      const res = await fetch("/api/valuation/excel/edits", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ticker, sheetData: sheetsToSave }),
      });

      if (res.ok) {
        const json = await res.json();
        console.log("[StockSpreadsheet] Save OK, version:", json.version);
        setSaveStatus("saved");
        setHasChanges(false);
        setUsingSavedEdits(true);
        const now = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
        setLastSaved(now);
        setTimeout(() => setSaveStatus("idle"), 3000);
      } else if (res.status === 401) {
        onNeedLogin();
        setSaveStatus("error");
      } else {
        const errText = await res.text();
        console.error("[StockSpreadsheet] Save failed:", res.status, errText);
        setSaveStatus("error");
        setTimeout(() => setSaveStatus("idle"), 3000);
      }
    } catch (err) {
      console.error("[StockSpreadsheet] Save error:", err);
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  }, [token, ticker, onNeedLogin, ensureCelldata]);

  // Revert to original
  const handleRevert = useCallback(async () => {
    if (baseSheets.current) {
      applySheets(baseSheets.current);
      setHasChanges(false);
      setUsingSavedEdits(false);
      setSaveStatus("idle");
    }
    if (token) {
      try {
        await fetch(`/api/valuation/excel/edits?ticker=${ticker}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch { /* best-effort */ }
    }
  }, [token, ticker, applySheets]);

  // Export to .xlsx with formatting preserved
  const handleExport = useCallback(async () => {
    if (!workbookRef.current) return;
    const ExcelJS = await import("exceljs");
    const allSheets = workbookRef.current.getAllSheets();
    const wb = new ExcelJS.Workbook();

    for (const sheet of allSheets) {
      const ws = wb.addWorksheet((sheet.name || "Sheet").slice(0, 31));

      // Build 2D cell grid from data or celldata
      let grid: any[][] = [];
      if (sheet.data && Array.isArray(sheet.data)) {
        grid = sheet.data;
      } else if ((sheet as any).celldata && Array.isArray((sheet as any).celldata)) {
        const cd = (sheet as any).celldata as { r: number; c: number; v: any }[];
        const maxR = cd.reduce((m: number, c: any) => Math.max(m, c.r), 0);
        const maxC = cd.reduce((m: number, c: any) => Math.max(m, c.c), 0);
        grid = Array.from({ length: maxR + 1 }, () => Array(maxC + 1).fill(null));
        for (const c of cd) grid[c.r][c.c] = c.v;
      }

      // Column widths from Fortune-Sheet config
      const colWidths = (sheet as any).config?.columnlen || {};
      for (const [colStr, w] of Object.entries(colWidths)) {
        const col = ws.getColumn(parseInt(colStr) + 1);
        col.width = Math.round((w as number) / 7); // px to Excel width units
      }

      for (let r = 0; r < grid.length; r++) {
        const row = grid[r];
        if (!Array.isArray(row)) continue;
        for (let c = 0; c < row.length; c++) {
          const cell = row[c];
          if (cell == null) continue;

          const exCell = ws.getCell(r + 1, c + 1);
          const isObj = typeof cell === "object" && cell !== null;
          const val = isObj ? cell.v : cell;

          // Set value
          if (val != null) exCell.value = val;

          if (!isObj) continue;

          // Font styling
          const font: any = {};
          if (cell.bl === 1) font.bold = true;
          if (cell.it === 1) font.italic = true;
          if (cell.fc) font.color = { argb: cell.fc.replace("#", "FF") };
          if (cell.fs) font.size = cell.fs;
          if (cell.ff) font.name = typeof cell.ff === "string" ? cell.ff : undefined;
          if (cell.un === 1) font.underline = true;
          if (cell.cl === 1) font.strike = true;
          if (Object.keys(font).length > 0) exCell.font = font;

          // Background
          if (cell.bg && cell.bg !== "#ffffff" && cell.bg !== "#FFFFFF") {
            exCell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: cell.bg.replace("#", "FF") },
            };
          }

          // Number format
          if (cell.fm) {
            const fmt = typeof cell.fm === "object" ? cell.fm.f : cell.fm;
            if (fmt) exCell.numFmt = fmt;
          }
          if (cell.ct?.fa) exCell.numFmt = cell.ct.fa;

          // Alignment
          const alignment: any = {};
          if (cell.ht === 0) alignment.horizontal = "center";
          else if (cell.ht === 1) alignment.horizontal = "right";
          else if (cell.ht === 2) alignment.horizontal = "left";
          if (cell.vt === 0) alignment.vertical = "middle";
          else if (cell.vt === 1) alignment.vertical = "top";
          else if (cell.vt === 2) alignment.vertical = "bottom";
          if (cell.tb === 2) alignment.wrapText = true;
          if (Object.keys(alignment).length > 0) exCell.alignment = alignment;
        }
      }

      // Merged cells
      const merges = (sheet as any).config?.merge || {};
      for (const key of Object.keys(merges)) {
        const m = merges[key];
        if (m) {
          ws.mergeCells(m.r + 1, m.c + 1, m.r + m.rs, m.c + m.cs);
        }
      }
    }

    // Write and download
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${ticker}_model.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }, [ticker]);

  // Ctrl+S / Cmd+S
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave]);

  // Drag & drop handlers
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);
  const onDragLeave = useCallback(() => setIsDragOver(false), []);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileUpload(file);
  }, [handleFileUpload]);

  // File input ref for click-to-upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sheetWrapperRef = useRef<HTMLDivElement>(null);

  // Trap wheel events: prevent page scroll, manually drive Fortune-Sheet's scrollbar
  useEffect(() => {
    const el = sheetWrapperRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Find Fortune-Sheet's vertical scrollbar and scroll it
      const scrollY = el.querySelector(".luckysheet-scrollbar-y") as HTMLElement | null;
      if (scrollY) {
        scrollY.scrollTop += e.deltaY;
      }
      const scrollX = el.querySelector(".luckysheet-scrollbar-x") as HTMLElement | null;
      if (scrollX && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        scrollX.scrollLeft += e.deltaX;
      }
      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [sheets]);

  if (loading) {
    return (
      <div style={emptyBoxStyle}>
        <span style={{ color: "#8b949e", fontSize: 12 }}>Loading model...</span>
      </div>
    );
  }

  // Empty state — show upload drop zone
  if (error === "no-file" || (!sheets && !loading)) {
    return (
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          ...emptyBoxStyle,
          border: isDragOver ? "2px dashed #58a6ff" : "2px dashed #30363d",
          background: isDragOver ? "rgba(88,166,255,0.05)" : "#0d1117",
          cursor: "pointer",
          transition: "all 0.2s",
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileUpload(f);
          }}
        />
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.3 }}>
            {isDragOver ? "+" : ""}
          </div>
          <div style={{ fontSize: 13, color: "#8b949e", marginBottom: 4 }}>
            {isDragOver ? "Drop .xlsx file here" : "No analysis model for " + ticker}
          </div>
          <div style={{ fontSize: 11, color: "#484f58" }}>
            Drop an Excel file here or click to upload your own model
          </div>
        </div>
      </div>
    );
  }

  if (error && error !== "no-file") {
    return (
      <div style={emptyBoxStyle}>
        <div style={{ color: "#f85149", fontSize: 12 }}>{error}</div>
      </div>
    );
  }

  if (!sheets || sheets.length === 0) {
    return (
      <div style={emptyBoxStyle}>
        <div style={{ color: "#8b949e", fontSize: 12 }}>No sheets found</div>
      </div>
    );
  }

  // Auth gate: show blurred teaser when not logged in
  const isLocked = !token;

  return (
    <div
      style={{ marginBottom: 24, position: "relative" }}
      onDragOver={token ? onDragOver : undefined}
      onDragLeave={token ? onDragLeave : undefined}
      onDrop={token ? onDrop : undefined}
    >
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "4px 10px",
        background: "#161b22", border: "1px solid #30363d", borderBottom: "none",
        borderRadius: "4px 4px 0 0", fontFamily: "'Geist Mono', monospace", fontSize: 11,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#58a6ff", fontWeight: 600 }}>{ticker}</span>
          {fileName && <span style={{ color: "#484f58", fontSize: 10 }}>{fileName}</span>}
          {!isLocked && hasChanges && saveStatus !== "saving" && <span style={{ color: "#d29922", fontSize: 10 }}>Modified</span>}
          {!isLocked && saveStatus === "saving" && <span style={{ color: "#58a6ff", fontSize: 10 }}>Saving...</span>}
          {!isLocked && saveStatus === "saved" && <span style={{ color: "#3fb950", fontSize: 10 }}>Saved</span>}
          {!isLocked && saveStatus === "error" && <span style={{ color: "#f85149", fontSize: 10 }}>Error</span>}
          {!isLocked && !hasChanges && lastSaved && saveStatus === "idle" && <span style={{ color: "#484f58", fontSize: 10 }}>Saved {lastSaved}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          {token ? (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                title="Upload Excel file"
                style={{ padding: "2px 6px", fontSize: 10, background: "#21262d", color: "#8b949e", border: "1px solid #30363d", borderRadius: 3, cursor: "pointer", fontFamily: "'Geist Mono', monospace" }}
              >
                UPLOAD
              </button>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }} />
              <button onClick={handleSave} disabled={saveStatus === "saving"}
                style={{ padding: "2px 6px", fontSize: 10, fontFamily: "'Geist Mono', monospace", fontWeight: 600, background: hasChanges ? "#238636" : "#21262d", color: hasChanges ? "#fff" : "#8b949e", border: "none", borderRadius: 3, cursor: "pointer" }}>
                SAVE
              </button>
              <button onClick={handleExport} title="Download as .xlsx"
                style={{ padding: "2px 6px", fontSize: 10, fontFamily: "'Geist Mono', monospace", background: "#21262d", color: "#8b949e", border: "1px solid #30363d", borderRadius: 3, cursor: "pointer" }}>
                EXPORT
              </button>
              <span style={{ width: 1, height: 14, background: "#30363d", margin: "0 2px" }} />
              <button onClick={() => setShowSettings(s => !s)} title="Spreadsheet options"
                style={{ padding: "2px 6px", fontSize: 10, fontFamily: "'Geist Mono', monospace", background: showSettings ? "#30363d" : "#21262d", color: showSettings ? "#fff" : "#8b949e", border: "1px solid #30363d", borderRadius: 3, cursor: "pointer" }}>
                OPTIONS
              </button>
              {usingSavedEdits && (
                <button onClick={handleRevert}
                  style={{ padding: "2px 6px", fontSize: 10, fontFamily: "'Geist Mono', monospace", background: "transparent", color: "#f85149", border: "1px solid #f8514933", borderRadius: 3, cursor: "pointer" }}>
                  REVERT
                </button>
              )}
              <span style={{ padding: "1px 5px", fontSize: 9, color: "#8b949e", background: "#0d1117", border: "1px solid #21262d", borderRadius: 2 }}>{profileName}</span>
              <button onClick={onLogout} title="Sign out"
                style={{ padding: "2px 6px", fontSize: 10, fontFamily: "'Geist Mono', monospace", background: "transparent", color: "#f85149", border: "1px solid #f8514933", borderRadius: 3, cursor: "pointer" }}>
                LOG OUT
              </button>
            </>
          ) : (
            <button onClick={onNeedLogin}
              style={{ padding: "2px 8px", fontSize: 11, fontFamily: "'Geist Mono', monospace", fontWeight: 600, background: "#3b82f6", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer" }}>
              SIGN IN TO VIEW
            </button>
          )}
        </div>
      </div>

      {/* Drag overlay */}
      {isDragOver && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 100,
          background: "rgba(88,166,255,0.08)", border: "2px dashed #58a6ff",
          borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}>
          <span style={{ color: "#58a6ff", fontSize: 14 }}>Drop .xlsx file</span>
        </div>
      )}

      {/* Spreadsheet — blurred teaser when locked */}
      <div ref={sheetWrapperRef} className="stock-sheet-wrapper" onContextMenu={(e) => {
        if (isLocked) return;
        e.preventDefault();
        e.stopPropagation();
        // Position relative to viewport for fixed positioning
        setCtxMenu({ x: e.clientX, y: e.clientY });
        setShowSettings(false);
      }} style={{
        width: "100%", height: 600,
        border: "1px solid #30363d", borderRadius: "0 0 4px 4px",
        position: "relative",
      }}>
        {isLocked && (
          <div style={{
            position: "absolute", inset: 0, zIndex: 50,
            background: "linear-gradient(180deg, transparent 0%, rgba(13,17,23,0.6) 30%, rgba(13,17,23,0.95) 70%)",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)",
          }}>
            <div style={{ fontSize: 14, color: "#e0e0e0", fontWeight: 600, marginBottom: 6, fontFamily: "'Geist Mono', monospace" }}>
              Sign in to access financial model
            </div>
            <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 16, fontFamily: "'Geist Mono', monospace" }}>
              Edit, save, and upload your own analysis models
            </div>
            <button
              onClick={onNeedLogin}
              style={{
                padding: "8px 24px", fontSize: 13, fontWeight: 600, fontFamily: "'Geist Mono', monospace",
                background: "#3b82f6", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer",
              }}
            >
              Sign In
            </button>
          </div>
        )}
        <Workbook
          key={`${ticker}_${mountKey}`}
          ref={workbookRef}
          data={sheets}
          showToolbar={!isLocked}
          showFormulaBar={!isLocked}
          showSheetTabs={true}
          allowEdit={!isLocked}
          onChange={() => { if (!hasChanges) setHasChanges(true); }}
        />
      </div>

      {/* Context menu (right-click OR OPTIONS button) */}
      {(() => {
        const menuOpen = (showSettings || ctxMenu) && !isLocked;
        if (!menuOpen) return null;
        const menuStyle: React.CSSProperties = ctxMenu
          ? { position: "fixed", top: ctxMenu.y, left: ctxMenu.x, zIndex: 10000 }
          : { position: "absolute", top: 34, right: 10, zIndex: 10000 };
        const close = () => { setShowSettings(false); setCtxMenu(null); };
        const wb = workbookRef.current as any;
        // Get current selection to determine row/col indices
        const sel = (() => { try { return wb?.getSelection?.(); } catch { return undefined; } })();
        const selRow = sel?.[0]?.row?.[0] ?? 0;
        const selRowEnd = sel?.[0]?.row?.[1] ?? selRow;
        const selCol = sel?.[0]?.column?.[0] ?? 0;
        const selColEnd = sel?.[0]?.column?.[1] ?? selCol;
        const menuItems: { label: string; section?: string; action: () => void }[] = [
          { label: "Insert Row Above", section: "INSERT", action: () => { try { wb?.insertRowOrColumn?.("row", selRow, 1, "lefttop"); } catch(e) { console.error(e); } if (!hasChanges) setHasChanges(true); } },
          { label: "Insert Row Below", action: () => { try { wb?.insertRowOrColumn?.("row", selRowEnd, 1, "rightbottom"); } catch(e) { console.error(e); } if (!hasChanges) setHasChanges(true); } },
          { label: "Insert Column Left", action: () => { try { wb?.insertRowOrColumn?.("column", selCol, 1, "lefttop"); } catch(e) { console.error(e); } if (!hasChanges) setHasChanges(true); } },
          { label: "Insert Column Right", action: () => { try { wb?.insertRowOrColumn?.("column", selColEnd, 1, "rightbottom"); } catch(e) { console.error(e); } if (!hasChanges) setHasChanges(true); } },
          { label: "Delete Selected Row(s)", section: "DELETE", action: () => { try { wb?.deleteRowOrColumn?.("row", selRow, selRowEnd); } catch(e) { console.error(e); } if (!hasChanges) setHasChanges(true); } },
          { label: "Delete Selected Column(s)", action: () => { try { wb?.deleteRowOrColumn?.("column", selCol, selColEnd); } catch(e) { console.error(e); } if (!hasChanges) setHasChanges(true); } },
          { label: "Undo", section: "EDIT", action: () => { try { wb?.handleUndo?.(); } catch {} } },
          { label: "Redo", action: () => { try { wb?.handleRedo?.(); } catch {} } },
        ];
        return (
          <>
            {/* Click-away overlay */}
            <div onClick={close} onContextMenu={(e) => { e.preventDefault(); close(); }}
              style={{ position: "fixed", inset: 0, zIndex: 9999, background: "transparent" }} />
            {/* Menu */}
            <div style={{
              ...menuStyle,
              background: "#1e1e1e", border: "1px solid #555", borderRadius: 6,
              boxShadow: "0 8px 32px rgba(0,0,0,0.7)", padding: "4px 0", minWidth: 210,
              fontFamily: "'Calibri', 'Segoe UI', sans-serif", fontSize: 13,
              maxHeight: "80vh", overflowY: "auto",
            }}>
              {menuItems.map((item, i) => (
                <div key={i}>
                  {item.section && (
                    <>
                      {i > 0 && <div style={{ borderTop: "1px solid #333", margin: "4px 8px" }} />}
                      <div style={{ padding: "4px 12px 2px", color: "#666", fontSize: 9, fontFamily: "'Geist Mono', monospace", textTransform: "uppercase", letterSpacing: 1 }}>
                        {item.section}
                      </div>
                    </>
                  )}
                  <button onClick={() => { item.action(); close(); }}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "5px 16px", background: "transparent", border: "none", color: "#d4d4d4", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}
                    onMouseEnter={e => { e.currentTarget.style.background = "#264f78"; e.currentTarget.style.color = "#fff"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#d4d4d4"; }}>
                    {item.label}
                  </button>
                </div>
              ))}
            </div>
          </>
        );
      })()}

      <style>{`
        /* Let the spreadsheet look like real Excel — white cells, original colors */
        /* Only dark-theme the chrome (formula bar, tabs, scrollbars) */

        .stock-sheet-wrapper .fortune-sheet-container { background: #e8e8e8 !important; border-bottom: none !important; }

        /* Fortune-Sheet toolbar — dark Excel-style ribbon */
        .stock-sheet-wrapper .fortune-sheet-toolbar {
          background: #1e1e1e !important; border-bottom: 1px solid #333 !important;
          min-height: 30px !important;
        }
        .stock-sheet-wrapper .fortune-sheet-toolbar * { color: #c9d1d9 !important; }
        .stock-sheet-wrapper .fortune-sheet-toolbar button,
        .stock-sheet-wrapper .fortune-sheet-toolbar .fortune-sheet-toolbar-button {
          background: transparent !important; border: none !important;
        }
        .stock-sheet-wrapper .fortune-sheet-toolbar button:hover,
        .stock-sheet-wrapper .fortune-sheet-toolbar .fortune-sheet-toolbar-button:hover {
          background: #30363d !important; border-radius: 3px !important;
        }
        .stock-sheet-wrapper .fortune-sheet-toolbar select,
        .stock-sheet-wrapper .fortune-sheet-toolbar input {
          background: #0d1117 !important; color: #c9d1d9 !important; border: 1px solid #30363d !important;
          border-radius: 3px !important;
        }
        .stock-sheet-wrapper .fortune-sheet-toolbar .fortune-sheet-toolbar-combo-button {
          background: transparent !important;
        }
        .stock-sheet-wrapper .fortune-sheet-toolbar .fortune-sheet-toolbar-combo-button:hover {
          background: #30363d !important;
        }
        .stock-sheet-wrapper .fortune-sheet-toolbar .fortune-sheet-icon { filter: invert(0.8) !important; }
        .stock-sheet-wrapper .fortune-sheet-toolbar-divider { background: #333 !important; }
        /* Font family/size chooser text — force light color on all inner elements */
        .stock-sheet-wrapper .fortune-sheet-toolbar .fortune-sheet-toolbar-combo-button-text,
        .stock-sheet-wrapper .fortune-sheet-toolbar .fortune-sheet-toolbar-button-text,
        .stock-sheet-wrapper .fortune-sheet-toolbar .fortune-sheet-toolbar-text-container,
        .stock-sheet-wrapper .fortune-sheet-toolbar span,
        .stock-sheet-wrapper .fortune-sheet-toolbar .fortune-sheet-font-family,
        .stock-sheet-wrapper .fortune-sheet-toolbar .fortune-sheet-font-size,
        .stock-sheet-wrapper .fortune-sheet-toolbar [class*="combo"] span,
        .stock-sheet-wrapper .fortune-sheet-toolbar [class*="select"] span,
        .stock-sheet-wrapper .fortune-sheet-toolbar [class*="text"] {
          color: #c9d1d9 !important;
        }
        /* Toolbar dropdown menus */
        .fortune-sheet-toolbar-menu, .fortune-sheet-toolbar-select-menu {
          background: #1e1e1e !important; border: 1px solid #444 !important;
          box-shadow: 0 4px 16px rgba(0,0,0,0.5) !important;
        }
        .fortune-sheet-toolbar-menu *, .fortune-sheet-toolbar-select-menu * { color: #c9d1d9 !important; }
        .fortune-sheet-toolbar-menu-item:hover, .fortune-sheet-toolbar-select-menu-item:hover {
          background: #30363d !important;
        }

        /* Hide Fortune-Sheet's broken built-in menus — we use our own */
        .luckysheet-rightclick-menu, .luckysheet-cols-menu, .luckysheet-cols-menu-sub,
        .luckysheet-sheet-list-menu { display: none !important; }

        /* Formula bar */
        .stock-sheet-wrapper .luckysheet-wa-editor { background: #f0f0f0 !important; border-color: #d0d0d0 !important; }
        .stock-sheet-wrapper .luckysheet-wa-functionbox-cell { background: #fff !important; color: #333 !important; border-color: #d0d0d0 !important; }
        .stock-sheet-wrapper .luckysheet-wa-functionbox-name { background: #f5f5f5 !important; color: #666 !important; border-color: #d0d0d0 !important; }

        /* Column/Row headers — classic Excel grey */
        .stock-sheet-wrapper .luckysheet-cols-h-cells .luckysheet-cols-h-cell {
          background: #f0f0f0 !important; color: #333 !important; border-color: #d0d0d0 !important;
        }
        .stock-sheet-wrapper .luckysheet-rows-h-cells .luckysheet-rows-h-cell {
          background: #f0f0f0 !important; color: #333 !important; border-color: #d0d0d0 !important;
        }
        .stock-sheet-wrapper .luckysheet-cols-h-cells .luckysheet-cols-h-cell-selected,
        .stock-sheet-wrapper .luckysheet-rows-h-cells .luckysheet-rows-h-cell-selected {
          background: #dae5f3 !important; color: #1a56db !important;
        }
        .stock-sheet-wrapper .luckysheet-left-top { background: #f0f0f0 !important; border-color: #d0d0d0 !important; }

        /* Grid window background (visible behind/around cells) */
        .stock-sheet-wrapper .luckysheet-grid-window,
        .stock-sheet-wrapper .luckysheet-cell-main { background: #e8e8e8 !important; }

        /* Cell grid lines */
        .stock-sheet-wrapper .luckysheet-cell-flow .luckysheet-cell { border-color: #d0d0d0 !important; }
        .stock-sheet-wrapper .fortune-sheet-overlay { background: transparent !important; }

        /* Selection */
        .stock-sheet-wrapper .luckysheet-cell-selected,
        .stock-sheet-wrapper .luckysheet-cell-selected-focus { border-color: #1a73e8 !important; }

        /* Sheet tabs — Excel-style bottom bar */
        .stock-sheet-wrapper .luckysheet-sheet-area {
          background: #252526 !important; border-top: 1px solid #444 !important;
          height: 30px !important; display: flex !important; align-items: flex-end !important;
        }
        /* Hide add-sheet (+) button and zoom controls to maximize tab space */
        .stock-sheet-wrapper .luckysheet-sheets-add { display: none !important; }
        .stock-sheet-wrapper .luckysheet-zoom-control,
        .stock-sheet-wrapper .luckysheet-sheet-area > div:last-child:not(.luckysheet-sheet-content):not([class*="luckysheet-sheets"]) {
          display: none !important;
        }
        /* Make tabs scroll area take full width */
        .stock-sheet-wrapper .luckysheet-sheet-area .luckysheet-sheets-scroll,
        .stock-sheet-wrapper .luckysheet-sheet-area .luckysheet-sheet-content {
          width: 100% !important; flex: 1 !important; max-width: 100% !important;
        }
        /* Individual tabs — high contrast Excel-like flat style */
        .stock-sheet-wrapper .luckysheet-sheets-item {
          background: #2d2d2d !important; color: #d4d4d4 !important;
          border: 1px solid #555 !important; border-bottom: 1px solid #555 !important;
          font-size: 11px !important; padding: 4px 12px !important;
          max-width: none !important; white-space: nowrap !important;
          line-height: 18px !important; height: 26px !important;
          margin: 0 -1px 0 0 !important; border-radius: 0 !important;
          font-family: 'Calibri', 'Segoe UI', sans-serif !important;
          cursor: pointer !important;
        }
        .stock-sheet-wrapper .luckysheet-sheets-item * {
          color: #d4d4d4 !important;
        }
        .stock-sheet-wrapper .luckysheet-sheets-item:hover {
          color: #fff !important; background: #3c3c3c !important;
        }
        .stock-sheet-wrapper .luckysheet-sheets-item:hover * {
          color: #fff !important;
        }
        /* Active tab — bright white text, green accent top border */
        .stock-sheet-wrapper .luckysheet-sheets-item-active,
        .stock-sheet-wrapper .luckysheet-sheets-item-active * {
          background: #1e1e1e !important; color: #fff !important;
          font-weight: 600 !important;
        }
        .stock-sheet-wrapper .luckysheet-sheets-item-active {
          border-bottom-color: #1e1e1e !important;
          border-top: 2px solid #4EC9B0 !important;
        }
        .stock-sheet-wrapper .luckysheet-sheets-scroll { background: #252526 !important; }
        /* Scroll arrows — high contrast nav buttons */
        .stock-sheet-wrapper .luckysheet-sheets-scroll-left,
        .stock-sheet-wrapper .luckysheet-sheets-scroll-right {
          color: #d4d4d4 !important; background: #333 !important; border-color: #555 !important;
          width: 22px !important; min-width: 22px !important; padding: 0 !important; font-size: 12px !important;
        }
        .stock-sheet-wrapper .luckysheet-sheets-scroll-left:hover,
        .stock-sheet-wrapper .luckysheet-sheets-scroll-right:hover {
          color: #fff !important; background: #444 !important;
        }

        /* Scrollbars */
        .stock-sheet-wrapper .luckysheet-scrollbar-x,
        .stock-sheet-wrapper .luckysheet-scrollbar-y { background: #e0e0e0 !important; }
        .stock-sheet-wrapper .luckysheet-scrollbar-x .luckysheet-scrollbar-content,
        .stock-sheet-wrapper .luckysheet-scrollbar-y .luckysheet-scrollbar-content { background: #b0b0b0 !important; border-radius: 3px !important; }

        /* Cell input */
        .stock-sheet-wrapper .luckysheet-cell-input { color: #333 !important; }

        /* Hide "Add rows" footer bar and any white line below tabs */
        .stock-sheet-wrapper .luckysheet-bottom-controll-row { display: none !important; }
        .stock-sheet-wrapper .luckysheet-sheet-area { border-bottom: none !important; border-bottom-color: #252526 !important; }
        .stock-sheet-wrapper .luckysheet-stat-area { display: none !important; }
        .stock-sheet-wrapper .luckysheet-sheet-area + div { display: none !important; }
        /* Kill ALL white lines at the very bottom of the container */
        .stock-sheet-wrapper > div { border-bottom: none !important; }
        .stock-sheet-wrapper .fortune-sheet-container > div:last-child {
          background: #252526 !important; border: none !important;
        }
        .stock-sheet-wrapper .luckysheet-sheet-area ~ * {
          display: none !important;
        }
        /* Catch any remaining bottom elements with white/light backgrounds */
        .stock-sheet-wrapper .luckysheet-bottom-area,
        .stock-sheet-wrapper .luckysheet-data-count,
        .stock-sheet-wrapper .luckysheet-bottom-controll,
        .stock-sheet-wrapper .luckysheet-bottom-statistic {
          display: none !important;
        }
        /* Force the wrapper and container bottom to match dark theme */
        .stock-sheet-wrapper, .stock-sheet-wrapper .fortune-sheet-container {
          border-bottom-color: #30363d !important;
        }
        /* Make sure no child div at the bottom has a light background */
        .stock-sheet-wrapper .fortune-sheet-container > div {
          border-bottom-color: #252526 !important;
        }

        /* Modal dialogs (Fortune-Sheet confirm/alert popups) */
        .luckysheet-modal-dialog {
          background: #161b22 !important; border: 1px solid #30363d !important; color: #c9d1d9 !important;
          border-radius: 8px !important; box-shadow: 0 16px 48px rgba(0,0,0,0.6) !important;
          font-family: 'Geist Mono', monospace !important;
        }
        .luckysheet-modal-dialog-title {
          background: #0d1117 !important; border-bottom: 1px solid #21262d !important;
          border-radius: 8px 8px 0 0 !important;
        }
        .luckysheet-modal-dialog-title-text { color: #c9d1d9 !important; font-size: 13px !important; }
        .luckysheet-modal-dialog-title-close { color: #8b949e !important; }
        .luckysheet-modal-dialog-content { color: #c9d1d9 !important; font-size: 13px !important; padding: 16px !important; }
        .luckysheet-modal-dialog-content * { color: #c9d1d9 !important; }
        .luckysheet-modal-dialog input, .luckysheet-modal-dialog select {
          background: #0d1117 !important; color: #c9d1d9 !important; border: 1px solid #30363d !important;
          border-radius: 4px !important; padding: 6px 8px !important;
        }
        .luckysheet-modal-dialog-buttons { padding: 12px 16px !important; border-top: 1px solid #21262d !important; }
        .luckysheet-modal-dialog .btn {
          background: #21262d !important; color: #c9d1d9 !important; border: 1px solid #30363d !important;
          border-radius: 4px !important; padding: 6px 16px !important; font-size: 12px !important;
          font-family: 'Geist Mono', monospace !important; cursor: pointer !important;
        }
        .luckysheet-modal-dialog .btn:hover { background: #30363d !important; }
        .luckysheet-modal-dialog .btn-primary {
          background: #3b82f6 !important; color: #fff !important; border-color: #3b82f6 !important;
        }
        .luckysheet-modal-dialog .btn-primary:hover { background: #2563eb !important; }
        .luckysheet-modal-dialog .btn-danger, .luckysheet-modal-dialog .btn-default {
          background: #21262d !important; color: #c9d1d9 !important;
        }
        /* Fortune-Sheet confirm dialog overlay */
        .luckysheet-modal-dialog-mask { background: rgba(0,0,0,0.5) !important; }

        /* Filter */
        .luckysheet-filter-menu { background: #161b22 !important; border: 1px solid #30363d !important; color: #c9d1d9 !important; }
        .luckysheet-filter-menu * { color: #c9d1d9 !important; }

        /* Sheet tab context menu */
        .luckysheet-sheet-list-menu { background: #161b22 !important; border: 1px solid #30363d !important; }
        .luckysheet-sheet-list-menu .luckysheet-cols-menuitem { color: #c9d1d9 !important; }
        .luckysheet-sheet-list-menu .luckysheet-cols-menuitem:hover { background: #21262d !important; }
      `}</style>
    </div>
  );
}

const emptyBoxStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: 300,
  background: "#0d1117",
  border: "1px solid #21262d",
  borderRadius: 4,
  fontFamily: "'Geist Mono', monospace",
  marginBottom: 24,
};
