import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

export const dynamic = "force-dynamic";

const BASE_DIR = "/Users/olaslettebak/Documents/HIO Invest AS/Analyser OSE";

function findExcelFile(ticker: string): string | null {
  const tickerDir = path.join(BASE_DIR, ticker);
  if (!fs.existsSync(tickerDir) || !fs.statSync(tickerDir).isDirectory()) return null;

  const files = fs.readdirSync(tickerDir).filter(
    (f) => f.endsWith(".xlsx") && !f.startsWith("~$") && !f.startsWith(".")
  );

  const copyFile = files.find((f) => f.toLowerCase().includes("copy"));
  if (copyFile) return path.join(tickerDir, copyFile);

  const analyseFile = files.find((f) => f.toLowerCase().includes("analyse") || f.toLowerCase().includes("analysis"));
  if (analyseFile) return path.join(tickerDir, analyseFile);

  return files.length > 0 ? path.join(tickerDir, files[0]) : null;
}

function listAvailableTickers(): string[] {
  if (!fs.existsSync(BASE_DIR)) return [];
  return fs
    .readdirSync(BASE_DIR)
    .filter((name) => {
      const full = path.join(BASE_DIR, name);
      if (!fs.statSync(full).isDirectory()) return false;
      return fs.readdirSync(full).some((f) => f.endsWith(".xlsx") && !f.startsWith("~$"));
    })
    .sort();
}

type CellValue = {
  v?: string | number | boolean;
  m?: string;
  f?: string;
  bl?: number;
  it?: number;
  fc?: string;
  bg?: string;
  ct?: { fa?: string; t?: string };
  ht?: number;
  fs?: number;
};

function rgbToHex(rgb: string): string {
  if (!rgb) return "";
  // SheetJS gives RGB as "RRGGBB" or "AARRGGBB"
  const clean = rgb.replace(/^FF/, "").replace(/^#/, "");
  return "#" + (clean.length === 6 ? clean : clean.slice(-6));
}

function xlsxToFortuneSheets(filePath: string) {
  const buffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(buffer, { cellFormula: true, cellStyles: true, cellNF: true });

  return workbook.SheetNames.map((name, idx) => {
    const ws = workbook.Sheets[name];
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    const celldata: { r: number; c: number; v: CellValue }[] = [];

    // Column widths
    const columnlen: Record<string, number> = {};
    if (ws["!cols"]) {
      ws["!cols"].forEach((col: any, i: number) => {
        if (col?.wpx) columnlen[String(i)] = col.wpx;
        else if (col?.wch) columnlen[String(i)] = col.wch * 8;
      });
    }

    // Row heights
    const rowlen: Record<string, number> = {};
    if (ws["!rows"]) {
      ws["!rows"].forEach((row: any, i: number) => {
        if (row?.hpx) rowlen[String(i)] = row.hpx;
      });
    }

    // Merged cells
    const merge: Record<string, { r: number; c: number; rs: number; cs: number }> = {};
    if (ws["!merges"]) {
      ws["!merges"].forEach((m: any) => {
        merge[`${m.s.r}_${m.s.c}`] = {
          r: m.s.r, c: m.s.c,
          rs: m.e.r - m.s.r + 1,
          cs: m.e.c - m.s.c + 1,
        };
      });
    }

    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (!cell) continue;

        const cv: CellValue = {
          v: cell.v,
          m: cell.w || (cell.v != null ? String(cell.v) : ""),
        };

        // Formula
        if (cell.f) cv.f = "=" + cell.f;

        // Number formatting — use Excel's pre-formatted string (cell.w)
        if (typeof cell.v === "number" && cell.z) {
          cv.ct = { fa: cell.z, t: "n" };
          // Use Excel's formatted output if available
          if (cell.w) cv.m = cell.w;
        }

        // === Preserve original Excel styles ===
        const s = cell.s;
        if (s) {
          // Background color
          if (s.patternType === "solid" && s.fgColor?.rgb) {
            cv.bg = rgbToHex(s.fgColor.rgb);
          }

          // Font color
          if (s.color?.rgb) {
            cv.fc = rgbToHex(s.color.rgb);
          }

          // Bold / Italic
          if (s.bold) cv.bl = 1;
          if (s.italic) cv.it = 1;

          // Font size
          if (s.sz) cv.fs = s.sz;

          // Alignment
          if (s.alignment?.horizontal === "center") cv.ht = 0;
          else if (s.alignment?.horizontal === "right") cv.ht = 2;
          else if (s.alignment?.horizontal === "left") cv.ht = 1;
        }

        // If no background from styles, give data cells white bg
        if (!cv.bg) {
          cv.bg = "#FFFFFF";
        }

        // Default font color to black if not set
        if (!cv.fc) {
          cv.fc = "#000000";
        }

        celldata.push({ r, c, v: cv });
      }
    }

    // Default column widths for columns within data range
    for (let c = range.s.c; c <= range.e.c; c++) {
      if (!columnlen[String(c)]) {
        columnlen[String(c)] = c === 0 ? 260 : 120;
      }
    }

    return {
      name,
      id: `sheet_${idx}`,
      celldata,
      row: range.e.r + 1,
      column: range.e.c + 1,
      order: idx,
      status: idx === 0 ? 1 : 0,
      config: {
        columnlen,
        rowlen,
        merge: Object.keys(merge).length > 0 ? merge : undefined,
      },
    };
  });
}

// Parse uploaded xlsx buffer (for user uploads)
function parseUploadedXlsx(buffer: Buffer): any[] {
  const workbook = XLSX.read(buffer, { cellFormula: true, cellStyles: true, cellNF: true });
  // Same conversion as local files
  return workbook.SheetNames.map((name, idx) => {
    const ws = workbook.Sheets[name];
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    const celldata: { r: number; c: number; v: CellValue }[] = [];
    const columnlen: Record<string, number> = {};
    const rowlen: Record<string, number> = {};
    const merge: Record<string, { r: number; c: number; rs: number; cs: number }> = {};

    if (ws["!cols"]) ws["!cols"].forEach((col: any, i: number) => {
      if (col?.wpx) columnlen[String(i)] = col.wpx;
      else if (col?.wch) columnlen[String(i)] = col.wch * 8;
    });
    if (ws["!rows"]) ws["!rows"].forEach((row: any, i: number) => {
      if (row?.hpx) rowlen[String(i)] = row.hpx;
    });
    if (ws["!merges"]) ws["!merges"].forEach((m: any) => {
      merge[`${m.s.r}_${m.s.c}`] = { r: m.s.r, c: m.s.c, rs: m.e.r - m.s.r + 1, cs: m.e.c - m.s.c + 1 };
    });

    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (!cell) continue;
        const cv: CellValue = { v: cell.v, m: cell.w || (cell.v != null ? String(cell.v) : "") };
        if (cell.f) cv.f = "=" + cell.f;
        if (typeof cell.v === "number" && cell.z) { cv.ct = { fa: cell.z, t: "n" }; if (cell.w) cv.m = cell.w; }
        const s = cell.s;
        if (s) {
          if (s.patternType === "solid" && s.fgColor?.rgb) cv.bg = rgbToHex(s.fgColor.rgb);
          if (s.color?.rgb) cv.fc = rgbToHex(s.color.rgb);
          if (s.bold) cv.bl = 1;
          if (s.italic) cv.it = 1;
          if (s.sz) cv.fs = s.sz;
        }
        if (!cv.bg) cv.bg = "#FFFFFF";
        if (!cv.fc) cv.fc = "#000000";
        celldata.push({ r, c, v: cv });
      }
    }

    for (let c = range.s.c; c <= range.e.c; c++) {
      if (!columnlen[String(c)]) columnlen[String(c)] = c === 0 ? 200 : 100;
    }

    return {
      name, id: `sheet_${idx}`, celldata,
      row: range.e.r + 1, column: range.e.c + 1,
      order: idx, status: idx === 0 ? 1 : 0,
      config: { columnlen, rowlen, merge: Object.keys(merge).length > 0 ? merge : undefined },
    };
  });
}

export async function GET(request: NextRequest) {
  try {
    const ticker = request.nextUrl.searchParams.get("ticker")?.toUpperCase();
    const listMode = request.nextUrl.searchParams.get("list");

    if (listMode === "true") {
      return NextResponse.json({ success: true, tickers: listAvailableTickers() });
    }

    if (!ticker) {
      return NextResponse.json({ success: false, error: "Missing ticker" }, { status: 400 });
    }

    const filePath = findExcelFile(ticker);
    if (!filePath) {
      return NextResponse.json({
        success: false,
        error: `No analysis file for ${ticker}`,
        available: listAvailableTickers(),
      }, { status: 404 });
    }

    const sheets = xlsxToFortuneSheets(filePath);
    return NextResponse.json({
      success: true, ticker,
      fileName: path.basename(filePath),
      sheetCount: sheets.length,
      sheetNames: sheets.map((s) => s.name),
      sheets,
    }, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (error: any) {
    console.error("Error parsing Excel:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ success: false, error: "No file uploaded" }, { status: 400 });
    }
    if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
      return NextResponse.json({ success: false, error: "Only .xlsx files supported" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const sheets = parseUploadedXlsx(buffer);

    return NextResponse.json({
      success: true,
      fileName: file.name,
      sheetCount: sheets.length,
      sheetNames: sheets.map((s: any) => s.name),
      sheets,
    });
  } catch (error: any) {
    console.error("Error parsing uploaded Excel:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
