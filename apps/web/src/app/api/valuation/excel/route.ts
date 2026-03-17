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
  tb?: string; // text break: "0"=clip, "1"=overflow, "2"=wrap
};

function rgbToHex(rgb: string): string {
  if (!rgb) return "";
  const clean = rgb.replace(/^#/, "");
  // 8-char AARRGGBB (xlsx ARGB format): strip the 2-char alpha prefix
  if (clean.length === 8) return "#" + clean.slice(2);
  // 6-char RRGGBB: use directly (do NOT strip "FF" prefix — it is part of the color)
  return "#" + clean;
}

/**
 * Parse each worksheet XML from the raw xlsx ZIP (via XLSX.CFB) to build
 * a map of cellAddress → xf-index. SheetJS only surfaces fill info in cell.s,
 * so we need the raw <c s="N"> attribute to resolve full font properties.
 */
function buildCellStyleMaps(buffer: Buffer, sheetPaths: string[]): Map<string, number>[] {
  try {
    const cfb = (XLSX as any).CFB.read(buffer, { type: "buffer" });
    return sheetPaths.map((sheetPath) => {
      const map = new Map<string, number>();
      const fileName = sheetPath.split("/").pop();
      const entry = cfb.FileIndex?.find((f: any) =>
        f.name === fileName || f.name?.endsWith("/" + fileName)
      );
      if (!entry) return map;
      const xml = Buffer.from(entry.content || cfb.Files?.[entry.name] || []).toString("utf8");
      // Match cells with a style attribute: <c r="B5" ... s="12" ...>
      const re = /<c\s[^>]*\br="([A-Z]+\d+)"[^>]*\bs="(\d+)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(xml)) !== null) {
        map.set(m[1], parseInt(m[2], 10));
      }
      return map;
    });
  } catch {
    return sheetPaths.map(() => new Map());
  }
}

function resolveFont(styles: any, xfIdx: number) {
  const xf = styles?.CellXf?.[xfIdx];
  if (!xf) return null;
  const fontId = parseInt(xf.fontId ?? xf.fontid ?? "0", 10);
  const font = styles?.Fonts?.[fontId];
  const align = xf.alignment;
  return { font, align };
}

function convertSheet(
  ws: any,
  idx: number,
  name: string,
  cellStyleMap: Map<string, number>,
  styles: any
) {
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

      if (cell.f) cv.f = "=" + cell.f;
      if (typeof cell.v === "number" && cell.z) {
        cv.ct = { fa: cell.z, t: "n" };
        if (cell.w) cv.m = cell.w;
      }

      // === Background color from SheetJS fill (reliable) ===
      const s = cell.s;
      if (s?.patternType === "solid" && s.fgColor?.rgb) {
        cv.bg = rgbToHex(s.fgColor.rgb);
      }

      // === Font info from raw xf index (reliable — SheetJS misses this) ===
      const xfIdx = cellStyleMap.get(addr);
      if (xfIdx !== undefined) {
        const resolved = resolveFont(styles, xfIdx);
        if (resolved) {
          const { font, align } = resolved;
          if (font?.color?.rgb) cv.fc = rgbToHex(font.color.rgb);
          if (font?.bold) cv.bl = 1;
          if (font?.italic) cv.it = 1;
          if (font?.sz) cv.fs = font.sz;
          if (align?.horizontal === "center") cv.ht = 0;
          else if (align?.horizontal === "right") cv.ht = 2;
          else if (align?.horizontal === "left") cv.ht = 1;
        }
      } else {
        // Fallback: SheetJS fill-based font info (less reliable)
        if (s?.color?.rgb) cv.fc = rgbToHex(s.color.rgb);
        if (s?.bold) cv.bl = 1;
        if (s?.italic) cv.it = 1;
        if (s?.sz) cv.fs = s.sz;
        if (s?.alignment?.horizontal === "center") cv.ht = 0;
        else if (s?.alignment?.horizontal === "right") cv.ht = 2;
        else if (s?.alignment?.horizontal === "left") cv.ht = 1;
      }
      // Always overflow (tb="1"): text flows into adjacent empty cells, matching
      // Excel's default. Using tb="2" (wrap) breaks merged cells — Fortune-Sheet
      // wraps at single-column width instead of the full merged width.
      cv.tb = "1";

      if (!cv.bg) cv.bg = "#FFFFFF";
      if (!cv.fc) cv.fc = "#000000";

      celldata.push({ r, c, v: cv });
    }
  }

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
}

function xlsxToFortuneSheets(filePath: string) {
  const buffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(buffer, { cellFormula: true, cellStyles: true, cellNF: true });
  const styles = (workbook as any).Styles;
  const sheetPaths = (workbook as any).Directory?.sheets ?? [];
  const cellStyleMaps = buildCellStyleMaps(buffer, sheetPaths);

  return workbook.SheetNames.map((name, idx) => {
    const ws = workbook.Sheets[name];
    const styleMap = cellStyleMaps[idx] ?? new Map();
    return convertSheet(ws, idx, name, styleMap, styles);
  });
}

// Parse uploaded xlsx buffer (for user uploads)
function parseUploadedXlsx(buffer: Buffer): any[] {
  const workbook = XLSX.read(buffer, { cellFormula: true, cellStyles: true, cellNF: true });
  const styles = (workbook as any).Styles;
  const sheetPaths = (workbook as any).Directory?.sheets ?? [];
  const cellStyleMaps = buildCellStyleMaps(buffer, sheetPaths);
  return workbook.SheetNames.map((name, idx) => {
    const ws = workbook.Sheets[name];
    const styleMap = cellStyleMaps[idx] ?? new Map();
    const sheet = convertSheet(ws, idx, name, styleMap, styles);
    // Uploaded files: use smaller default column widths
    for (const key of Object.keys(sheet.config.columnlen)) {
      if (sheet.config.columnlen[key] > 200 && parseInt(key) > 0) {
        sheet.config.columnlen[key] = Math.min(sheet.config.columnlen[key], 150);
      }
    }
    return sheet;
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
