/**
 * IBKR Oslo Børs Universe Scanner - PARALLEL VERSION
 *
 * Uses multiple IBKR connections for maximum speed.
 * Validates tickers against data quality requirements.
 */

import { config } from "dotenv";
import { resolve } from "path";
import { writeFileSync } from "fs";
import {
  IBApi,
  EventName,
  Contract,
  SecType,
  WhatToShow,
  BarSizeSetting,
} from "@stoqey/ib";
import { Client } from "pg";

config({ path: resolve(__dirname, "../.env.local") });

const IBKR_HOST = process.env.IBKR_HOST || "127.0.0.1";
const IBKR_PORT = parseInt(process.env.IBKR_PORT || "4002", 10);
const DATABASE_URL = process.env.DATABASE_URL;

// Number of parallel IBKR connections
const NUM_CLIENTS = 5;

// Thresholds
const MIN_MCAP_NOK = 1_000_000_000; // 1B NOK
const MIN_HISTORY_YEARS = 3;
const MAX_GAP_DAYS = 5;
const MIN_TRADING_DAYS_PER_YEAR = 200;
const MIN_AVG_VOLUME_NOK = 10_000_000; // 10M NOK/day

// Oslo Børs tickers with MCap
const OSE_UNIVERSE: Array<{ ticker: string; mcapM: number | null }> = [
  { ticker: "2020", mcapM: 3212 },
  { ticker: "5PG", mcapM: 250 },
  { ticker: "AASB", mcapM: 246 },
  { ticker: "ABG", mcapM: 4327 },
  { ticker: "ABL", mcapM: 1286 },
  { ticker: "ABS", mcapM: 93 },
  { ticker: "ABTEC", mcapM: 24 },
  { ticker: "ACED", mcapM: 53 },
  { ticker: "ACR", mcapM: 2544 },
  { ticker: "ADS", mcapM: 185 },
  { ticker: "AFG", mcapM: 20691 },
  { ticker: "AFISH", mcapM: 1332 },
  { ticker: "AFK", mcapM: 8483 },
  { ticker: "AGLX", mcapM: 1898 },
  { ticker: "AIRX", mcapM: 194 },
  { ticker: "AIX", mcapM: 107 },
  { ticker: "AKAST", mcapM: 3628 },
  { ticker: "AKBM", mcapM: 8056 },
  { ticker: "AKER", mcapM: 66072 },
  { ticker: "AKH", mcapM: 31 },
  { ticker: "AKOBO", mcapM: 526 },
  { ticker: "AKRBP", mcapM: 167612 },
  { ticker: "AKSO", mcapM: 17344 },
  { ticker: "AKVA", mcapM: 3278 },
  { ticker: "ALNG", mcapM: 379 },
  { ticker: "ANDF", mcapM: 3023 },
  { ticker: "APR", mcapM: 2872 },
  { ticker: "ARCH", mcapM: 2403 },
  { ticker: "ARR", mcapM: 676 },
  { ticker: "ASA", mcapM: 226 },
  { ticker: "ASAS", mcapM: null },
  { ticker: "ATEA", mcapM: 16453 },
  { ticker: "AURG", mcapM: 1161 },
  { ticker: "AUSS", mcapM: 18974 },
  { ticker: "AUTO", mcapM: 37474 },
  { ticker: "AZT", mcapM: 1103 },
  { ticker: "B2I", mcapM: 7468 },
  { ticker: "BAKKA", mcapM: 28091 },
  { ticker: "BALT", mcapM: 435 },
  { ticker: "BARRA", mcapM: 98 },
  { ticker: "BCS", mcapM: 160 },
  { ticker: "BEWI", mcapM: 3903 },
  { ticker: "BIEN", mcapM: 829 },
  { ticker: "BMA", mcapM: 971 },
  { ticker: "BNOR", mcapM: 11991 },
  { ticker: "BONHR", mcapM: 11037 },
  { ticker: "BOR", mcapM: 633 },
  { ticker: "BORR", mcapM: 16066 },
  { ticker: "BOUV", mcapM: 5792 },
  { ticker: "BRG", mcapM: 17520 },
  { ticker: "BRUT", mcapM: 3375 },
  { ticker: "BSP", mcapM: 19 },
  { ticker: "BWE", mcapM: 11607 },
  { ticker: "BWLPG", mcapM: 24498 },
  { ticker: "BWO", mcapM: 8610 },
  { ticker: "CADLR", mcapM: 19917 },
  { ticker: "CAMBI", mcapM: 2833 },
  { ticker: "CAPSL", mcapM: 381 },
  { ticker: "CAVEN", mcapM: 242 },
  { ticker: "CLCO", mcapM: 5120 },
  { ticker: "CLOUD", mcapM: 3779 },
  { ticker: "CMBTO", mcapM: 37601 },
  { ticker: "CODE", mcapM: 36 },
  { ticker: "CONTX", mcapM: 286 },
  { ticker: "COSH", mcapM: 10133 },
  { ticker: "CRNA", mcapM: 155 },
  { ticker: "CRNAT", mcapM: null },
  { ticker: "CYVIZ", mcapM: 506 },
  { ticker: "DDRIL", mcapM: 401 },
  { ticker: "DELIA", mcapM: 2157 },
  { ticker: "DFENS", mcapM: 865 },
  { ticker: "DNB", mcapM: 426141 },
  { ticker: "DNO", mcapM: 15454 },
  { ticker: "DOFG", mcapM: 27731 },
  { ticker: "DSRT", mcapM: 221 },
  { ticker: "DVD", mcapM: 2020 },
  { ticker: "EAM", mcapM: 42 },
  { ticker: "EIOF", mcapM: 934 },
  { ticker: "ELABS", mcapM: 457 },
  { ticker: "ELIMP", mcapM: 823 },
  { ticker: "ELK", mcapM: 18007 },
  { ticker: "ELMRA", mcapM: 4517 },
  { ticker: "ELO", mcapM: 12936 },
  { ticker: "EMGS", mcapM: 43 },
  { ticker: "ENDUR", mcapM: 5054 },
  { ticker: "ENERG", mcapM: 71 },
  { ticker: "ENH", mcapM: 5128 },
  { ticker: "ENSU", mcapM: 746 },
  { ticker: "ENTRA", mcapM: 20472 },
  { ticker: "ENVIP", mcapM: 3238 },
  { ticker: "EPR", mcapM: 14167 },
  { ticker: "EQNR", mcapM: 658889 },
  { ticker: "EQVA", mcapM: 246 },
  { ticker: "EXTX", mcapM: 120 },
  { ticker: "FFSB", mcapM: 183 },
  { ticker: "FRO", mcapM: 60910 },
  { ticker: "GEM", mcapM: 26 },
  { ticker: "GENT", mcapM: 864 },
  { ticker: "GEOS", mcapM: 542 },
  { ticker: "GIGA", mcapM: 1439 },
  { ticker: "GJF", mcapM: 138400 },
  { ticker: "GOD", mcapM: 276 },
  { ticker: "GRONG", mcapM: 679 },
  { ticker: "GSF", mcapM: 8372 },
  { ticker: "GYL", mcapM: 1054 },
  { ticker: "HAFNI", mcapM: 29985 },
  { ticker: "HAUTO", mcapM: 20298 },
  { ticker: "HAV", mcapM: 352 },
  { ticker: "HAVI", mcapM: 283 },
  { ticker: "HBC", mcapM: 561 },
  { ticker: "HDLY", mcapM: 634 },
  { ticker: "HELG", mcapM: 4590 },
  { ticker: "HERMA", mcapM: 241 },
  { ticker: "HEX", mcapM: 2034 },
  { ticker: "HGSB", mcapM: 851 },
  { ticker: "HKY", mcapM: 907 },
  { ticker: "HPUR", mcapM: 617 },
  { ticker: "HSHP", mcapM: 4604 },
  { ticker: "HSPG", mcapM: 101 },
  { ticker: "HUDL", mcapM: 179 },
  { ticker: "HUNT", mcapM: 365 },
  { ticker: "HYN", mcapM: 15 },
  { ticker: "HYPRO", mcapM: 181 },
  { ticker: "IDEX", mcapM: 384 },
  { ticker: "INDCT", mcapM: 137 },
  { ticker: "INIFY", mcapM: 301 },
  { ticker: "ININ", mcapM: 418 },
  { ticker: "INSTA", mcapM: 1743 },
  { ticker: "IOX", mcapM: 17 },
  { ticker: "ISLAX", mcapM: 2384 },
  { ticker: "ITERA", mcapM: 616 },
  { ticker: "IWS", mcapM: 2074 },
  { ticker: "JAREN", mcapM: 1741 },
  { ticker: "JIN", mcapM: 623 },
  { ticker: "KCC", mcapM: 5189 },
  { ticker: "KID", mcapM: 4934 },
  { ticker: "KING", mcapM: 537 },
  { ticker: "KIT", mcapM: 17693 },
  { ticker: "KLDVK", mcapM: 1119 },
  { ticker: "KMCP", mcapM: 31 },
  { ticker: "KOA", mcapM: 2017 },
  { ticker: "KOG", mcapM: 284905 },
  { ticker: "KOMPL", mcapM: 2437 },
  { ticker: "KRAB", mcapM: 592 },
  { ticker: "LIFE", mcapM: 82 },
  { ticker: "LIFEJ", mcapM: null },
  { ticker: "LIFES", mcapM: null },
  { ticker: "LINK", mcapM: 7800 },
  { ticker: "LOKO", mcapM: 449 },
  { ticker: "LOKOS", mcapM: 16 },
  { ticker: "LSG", mcapM: 28895 },
  { ticker: "LUMI", mcapM: 1103 },
  { ticker: "LYTIX", mcapM: 692 },
  { ticker: "MAS", mcapM: 2940 },
  { ticker: "MEDI", mcapM: 4016 },
  { ticker: "MELG", mcapM: 533 },
  { ticker: "MGN", mcapM: 1335 },
  { ticker: "MING", mcapM: 28258 },
  { ticker: "MORG", mcapM: 5507 },
  { ticker: "MORLD", mcapM: 3078 },
  { ticker: "MOWI", mcapM: 119484 },
  { ticker: "MPCC", mcapM: 8029 },
  { ticker: "MPCES", mcapM: 304 },
  { ticker: "MULTI", mcapM: 4705 },
  { ticker: "MVE", mcapM: 253 },
  { ticker: "MVW", mcapM: 237 },
  { ticker: "NAPA", mcapM: 3425 },
  { ticker: "NAS", mcapM: 17179 },
  { ticker: "NAVA", mcapM: 537 },
  { ticker: "NBX", mcapM: 112 },
  { ticker: "NCOD", mcapM: 848 },
  { ticker: "NEL", mcapM: 3875 },
  { ticker: "NEXT", mcapM: 132 },
  { ticker: "NHY", mcapM: 170585 },
  { ticker: "NISB", mcapM: 124 },
  { ticker: "NKR", mcapM: 1300 },
  { ticker: "NOAP", mcapM: 1655 },
  { ticker: "NOD", mcapM: 29967 },
  { ticker: "NOFIN", mcapM: 34 },
  { ticker: "NOHAL", mcapM: 1090 },
  { ticker: "NOL", mcapM: 2674 },
  { ticker: "NOM", mcapM: 1317 },
  { ticker: "NONG", mcapM: 14897 },
  { ticker: "NORAM", mcapM: 1466 },
  { ticker: "NORBT", mcapM: 11664 },
  { ticker: "NORCO", mcapM: 14075 },
  { ticker: "NORDH", mcapM: 1537 },
  { ticker: "NORSE", mcapM: 894 },
  { ticker: "NORTH", mcapM: 315 },
  { ticker: "NOSN", mcapM: 55 },
  { ticker: "NRC", mcapM: 1503 },
  { ticker: "NSKOG", mcapM: 1510 },
  { ticker: "NTG", mcapM: 253 },
  { ticker: "NTI", mcapM: 1387 },
  { ticker: "NYKD", mcapM: 942 },
  { ticker: "OBSRV", mcapM: 89 },
  { ticker: "OCEAN", mcapM: 99 },
  { ticker: "ODF", mcapM: 7872 },
  { ticker: "ODFB", mcapM: 2388 },
  { ticker: "ODL", mcapM: 22662 },
  { ticker: "OET", mcapM: 15141 },
  { ticker: "OKEA", mcapM: 2665 },
  { ticker: "OLT", mcapM: 33995 },
  { ticker: "OMDA", mcapM: 870 },
  { ticker: "ONCIN", mcapM: 193 },
  { ticker: "ORK", mcapM: 117568 },
  { ticker: "OSUN", mcapM: 70 },
  { ticker: "OTEC", mcapM: 1317 },
  { ticker: "OTL", mcapM: 2319 },
  { ticker: "OTOVO", mcapM: 755 },
  { ticker: "PARB", mcapM: 6135 },
  { ticker: "PCIB", mcapM: null },
  { ticker: "PEN", mcapM: 2518 },
  { ticker: "PEXIP", mcapM: 7707 },
  { ticker: "PHO", mcapM: 1812 },
  { ticker: "PLSV", mcapM: 8108 },
  { ticker: "PLT", mcapM: 1389 },
  { ticker: "PNOR", mcapM: 1429 },
  { ticker: "POL", mcapM: 2720 },
  { ticker: "PPG", mcapM: 448 },
  { ticker: "PROT", mcapM: 42653 },
  { ticker: "PROXI", mcapM: 340 },
  { ticker: "PRS", mcapM: 1236 },
  { ticker: "PRYME", mcapM: 261 },
  { ticker: "PSE", mcapM: 288 },
  { ticker: "PUBLI", mcapM: 13377 },
  { ticker: "PYRUM", mcapM: 1262 },
  { ticker: "QEC", mcapM: 780 },
  { ticker: "RANA", mcapM: 2885 },
  { ticker: "REACH", mcapM: 2262 },
  { ticker: "RECSI", mcapM: 444 },
  { ticker: "REFL", mcapM: 858 },
  { ticker: "RING", mcapM: 6647 },
  { ticker: "RIVER", mcapM: 81 },
  { ticker: "ROGS", mcapM: 3555 },
  { ticker: "ROM", mcapM: 103 },
  { ticker: "ROMER", mcapM: 397 },
  { ticker: "SAGA", mcapM: 862 },
  { ticker: "SALM", mcapM: 79392 },
  { ticker: "SALME", mcapM: 2246 },
  { ticker: "SATS", mcapM: 7995 },
  { ticker: "SB1NO", mcapM: 74566 },
  { ticker: "SB68", mcapM: 611 },
  { ticker: "SBNOR", mcapM: 33826 },
  { ticker: "SBO", mcapM: 3188 },
  { ticker: "SCANA", mcapM: 681 },
  { ticker: "SCATC", mcapM: 18101 },
  { ticker: "SDSD", mcapM: 986 },
  { ticker: "SEA1", mcapM: 3892 },
  { ticker: "SKAND", mcapM: 204 },
  { ticker: "SKUE", mcapM: 1947 },
  { ticker: "SMCRT", mcapM: 3276 },
  { ticker: "SMOP", mcapM: 2755 },
  { ticker: "SNI", mcapM: 17294 },
  { ticker: "SNOR", mcapM: 1613 },
  { ticker: "SNTIA", mcapM: 6303 },
  { ticker: "SOAG", mcapM: 5512 },
  { ticker: "SOFF", mcapM: 4072 },
  { ticker: "SOFTX", mcapM: 142 },
  { ticker: "SOGN", mcapM: 173 },
  { ticker: "SOMA", mcapM: 10191 },
  { ticker: "SPIR", mcapM: 1133 },
  { ticker: "SPOG", mcapM: 1628 },
  { ticker: "SPOL", mcapM: 27288 },
  { ticker: "STB", mcapM: 74642 },
  { ticker: "STECH", mcapM: 711 },
  { ticker: "STRO", mcapM: 483 },
  { ticker: "STST", mcapM: 545 },
  { ticker: "SUBC", mcapM: 72264 },
  { ticker: "SWON", mcapM: 19811 },
  { ticker: "TECH", mcapM: 403 },
  { ticker: "TEKNA", mcapM: 910 },
  { ticker: "TEL", mcapM: 218115 },
  { ticker: "TGS", mcapM: 19739 },
  { ticker: "TIETO", mcapM: 23799 },
  { ticker: "TINDE", mcapM: 654 },
  { ticker: "TOM", mcapM: 37508 },
  { ticker: "TRMED", mcapM: 1689 },
  { ticker: "TRSB", mcapM: 545 },
  { ticker: "VAR", mcapM: 85452 },
  { ticker: "VDI", mcapM: 2659 },
  { ticker: "VEI", mcapM: 24184 },
  { ticker: "VEND", mcapM: 55906 },
  { ticker: "VISTN", mcapM: 927 },
  { ticker: "VOW", mcapM: 755 },
  { ticker: "VTURA", mcapM: 2357 },
  { ticker: "VVL", mcapM: 875 },
  { ticker: "WAWI", mcapM: 47959 },
  { ticker: "WEST", mcapM: 583 },
  { ticker: "WSTEP", mcapM: 516 },
  { ticker: "WWI", mcapM: 22089 },
  { ticker: "WWIB", mcapM: 5862 },
  { ticker: "XPLRA", mcapM: 2422 },
  { ticker: "YAR", mcapM: 114244 },
  { ticker: "ZAL", mcapM: 1873 },
  { ticker: "ZAP", mcapM: 1998 },
  { ticker: "ZENA", mcapM: 299 },
  { ticker: "ZLNA", mcapM: 391 },
];

interface TickerResult {
  ticker: string;
  mcapM: number | null;
  status: "PASS" | "FAIL" | "SKIPPED";
  isNew: boolean;
  failReasons: string[];
  headTimestamp?: string;
  historyYears?: number;
  maxGapDays?: number;
  avgTradingDaysPerYear?: number;
  avgVolumeNOK?: number;
  hasAdjustedClose?: boolean;
}

interface HistoricalBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function getExistingTickersFromDB(): Promise<Set<string>> {
  if (!DATABASE_URL) {
    console.warn("WARNING: DATABASE_URL not set");
    return new Set();
  }
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    const result = await client.query(
      "SELECT DISTINCT ticker FROM prices_daily ORDER BY ticker"
    );
    return new Set(result.rows.map((r: { ticker: string }) => r.ticker.toUpperCase()));
  } finally {
    await client.end();
  }
}

class ScannerClient {
  private ib: IBApi;
  private connected = false;
  private reqIdCounter = 1;
  private pendingRequests = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
    data: any[];
  }>();
  public id: number;

  constructor(clientId: number) {
    this.id = clientId;
    this.ib = new IBApi({ clientId, host: IBKR_HOST, port: IBKR_PORT });
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.ib.on(EventName.connected, () => { this.connected = true; });
    this.ib.on(EventName.disconnected, () => { this.connected = false; });

    this.ib.on(EventName.error, (err, code, reqId) => {
      if (reqId !== undefined && reqId !== -1) {
        const pending = this.pendingRequests.get(reqId);
        if (pending) {
          clearTimeout(pending.timeout);
          pending.reject(new Error(`TWS ${code}: ${err}`));
          this.pendingRequests.delete(reqId);
        }
      }
    });

    this.ib.on(EventName.headTimestamp, (reqId: number, ts: string) => {
      const pending = this.pendingRequests.get(reqId);
      if (pending) {
        clearTimeout(pending.timeout);
        pending.resolve(ts);
        this.pendingRequests.delete(reqId);
      }
    });

    (this.ib as any).on(EventName.historicalData, (reqId: number, time: string, o: number, h: number, l: number, c: number, v: number) => {
      const pending = this.pendingRequests.get(reqId);
      if (!pending) return;
      if (time.startsWith("finished")) {
        clearTimeout(pending.timeout);
        pending.resolve(pending.data);
        this.pendingRequests.delete(reqId);
        return;
      }
      const ds = time.trim().split(" ")[0];
      pending.data.push({ date: `${ds.substring(0,4)}-${ds.substring(4,6)}-${ds.substring(6,8)}`, open: o, high: h, low: l, close: c, volume: v });
    });
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    this.ib.connect();
    const start = Date.now();
    while (!this.connected && Date.now() - start < 5000) await this.sleep(50);
    if (!this.connected) throw new Error(`Client ${this.id} connect timeout`);
  }

  async disconnect(): Promise<void> {
    if (this.connected) { this.ib.disconnect(); await this.sleep(200); }
  }

  sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  private contract(ticker: string): Contract {
    return { symbol: ticker.toUpperCase(), secType: SecType.STK, exchange: "OSE", currency: "NOK" };
  }

  async getHeadTimestamp(ticker: string): Promise<string> {
    const reqId = this.reqIdCounter++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pendingRequests.delete(reqId); reject(new Error("timeout")); }, 15000);
      this.pendingRequests.set(reqId, { resolve, reject, timeout, data: [] });
      this.ib.reqHeadTimestamp(reqId, this.contract(ticker), WhatToShow.TRADES, true, 1);
    });
  }

  async getHistoricalData(ticker: string, whatToShow: WhatToShow): Promise<HistoricalBar[]> {
    const reqId = this.reqIdCounter++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pendingRequests.delete(reqId); reject(new Error("timeout")); }, 30000);
      this.pendingRequests.set(reqId, { resolve, reject, timeout, data: [] });
      this.ib.reqHistoricalData(reqId, this.contract(ticker), "", "3 Y", BarSizeSetting.DAYS_ONE, whatToShow, 1, 1, false);
    });
  }
}

function analyzeGaps(bars: HistoricalBar[]): number {
  if (bars.length < 2) return 0;
  const sorted = [...bars].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  let maxGap = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1].date);
    const curr = new Date(sorted[i].date);
    let biz = 0;
    const check = new Date(prev);
    check.setDate(check.getDate() + 1);
    while (check < curr) {
      if (check.getDay() !== 0 && check.getDay() !== 6) biz++;
      check.setDate(check.getDate() + 1);
    }
    if (biz > maxGap) maxGap = biz;
  }
  return maxGap;
}

function analyzeTradingDays(bars: HistoricalBar[]): number {
  if (bars.length === 0) return 0;
  const byYear = new Map<number, number>();
  for (const bar of bars) {
    const y = new Date(bar.date).getFullYear();
    byYear.set(y, (byYear.get(y) || 0) + 1);
  }
  const years = Array.from(byYear.keys()).filter(y => y !== new Date().getFullYear()).sort();
  if (years.length <= 1) return byYear.get(years[0]) || 0;
  const full = years.slice(1);
  return Math.round(full.reduce((s, y) => s + (byYear.get(y) || 0), 0) / full.length);
}

function analyzeVolume(bars: HistoricalBar[]): number {
  if (bars.length === 0) return 0;
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const recent = bars.filter(b => new Date(b.date) >= oneYearAgo);
  if (recent.length === 0) return 0;
  return Math.round(recent.reduce((s, b) => s + b.close * b.volume, 0) / recent.length);
}

async function validateTicker(client: ScannerClient, ticker: string, mcapM: number | null, isNew: boolean): Promise<TickerResult> {
  const result: TickerResult = { ticker, mcapM, status: "PASS", isNew, failReasons: [] };

  try {
    // Head timestamp check
    const headTs = await client.getHeadTimestamp(ticker);
    result.headTimestamp = headTs;
    let headDate: Date;
    if (headTs.length === 8) {
      headDate = new Date(`${headTs.substring(0,4)}-${headTs.substring(4,6)}-${headTs.substring(6,8)}`);
    } else {
      headDate = new Date(parseInt(headTs) * 1000);
    }
    const histYears = (Date.now() - headDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    result.historyYears = Math.round(histYears * 10) / 10;
    if (histYears < MIN_HISTORY_YEARS) {
      result.status = "FAIL";
      result.failReasons.push(`History ${result.historyYears}y < ${MIN_HISTORY_YEARS}y`);
      return result;
    }

    await client.sleep(500);

    // Get adjusted data
    let adjBars: HistoricalBar[] = [];
    try { adjBars = await client.getHistoricalData(ticker, WhatToShow.ADJUSTED_LAST); result.hasAdjustedClose = adjBars.length > 0; }
    catch { result.hasAdjustedClose = false; }
    if (!result.hasAdjustedClose) { result.status = "FAIL"; result.failReasons.push("No adj close"); }

    await client.sleep(500);

    // Get raw data
    let rawBars: HistoricalBar[] = [];
    try { rawBars = await client.getHistoricalData(ticker, WhatToShow.TRADES); } catch {}

    const bars = adjBars.length > rawBars.length ? adjBars : rawBars;
    if (bars.length === 0) { result.status = "FAIL"; result.failReasons.push("No data"); return result; }

    // Gap analysis
    result.maxGapDays = analyzeGaps(bars);
    if (result.maxGapDays > MAX_GAP_DAYS) { result.status = "FAIL"; result.failReasons.push(`Gap ${result.maxGapDays}d > ${MAX_GAP_DAYS}`); }

    // Trading days
    result.avgTradingDaysPerYear = analyzeTradingDays(bars);
    if (result.avgTradingDaysPerYear < MIN_TRADING_DAYS_PER_YEAR) { result.status = "FAIL"; result.failReasons.push(`${result.avgTradingDaysPerYear} days/y < ${MIN_TRADING_DAYS_PER_YEAR}`); }

    // Volume
    if (rawBars.length > 0) {
      result.avgVolumeNOK = analyzeVolume(rawBars);
      if (result.avgVolumeNOK < MIN_AVG_VOLUME_NOK) { result.status = "FAIL"; result.failReasons.push(`Vol ${Math.round(result.avgVolumeNOK/1e6)}M < ${MIN_AVG_VOLUME_NOK/1e6}M`); }
    }
  } catch (e: any) {
    result.status = "FAIL";
    result.failReasons.push(e?.message || String(e));
  }

  return result;
}

async function main() {
  console.log("=== IBKR Universe Scanner (PARALLEL) ===");
  console.log(`Clients: ${NUM_CLIENTS} | Thresholds: MCap>=${MIN_MCAP_NOK/1e9}B, Vol>=${MIN_AVG_VOLUME_NOK/1e6}M, Hist>=${MIN_HISTORY_YEARS}y\n`);

  // MCap pre-filter
  const mcapThresholdM = MIN_MCAP_NOK / 1e6;
  const passMcap = OSE_UNIVERSE.filter(t => t.mcapM !== null && t.mcapM >= mcapThresholdM);
  const failMcap = OSE_UNIVERSE.filter(t => t.mcapM === null || t.mcapM < mcapThresholdM);
  console.log(`MCap filter: ${passMcap.length} pass, ${failMcap.length} fail\n`);

  // Get existing tickers
  console.log("Querying database...");
  const existingTickers = await getExistingTickersFromDB();
  console.log(`Found ${existingTickers.size} tickers in DB\n`);

  const results: TickerResult[] = [];

  // Add skipped
  for (const t of failMcap) {
    results.push({ ticker: t.ticker, mcapM: t.mcapM, status: "SKIPPED", isNew: !existingTickers.has(t.ticker.toUpperCase()), failReasons: [t.mcapM === null ? "No MCap" : `MCap ${t.mcapM}M < ${mcapThresholdM}M`] });
  }

  // Create clients
  console.log(`Creating ${NUM_CLIENTS} IBKR clients...`);
  const clients: ScannerClient[] = [];
  for (let i = 0; i < NUM_CLIENTS; i++) {
    const c = new ScannerClient(20 + i);
    await c.connect();
    clients.push(c);
    console.log(`  Client ${20 + i} connected`);
    await clients[0].sleep(300);
  }
  console.log("");

  // Process in parallel batches with retry
  const queue = [...passMcap];
  const retryQueue: typeof passMcap = [];
  let completed = 0;
  const total = queue.length;

  async function processNext(client: ScannerClient): Promise<void> {
    while (queue.length > 0) {
      const item = queue.shift()!;
      const isNew = !existingTickers.has(item.ticker.toUpperCase());
      const result = await validateTicker(client, item.ticker, item.mcapM, isNew);

      // If timeout, add to retry queue
      if (result.failReasons.some(r => r.includes("timeout"))) {
        retryQueue.push(item);
      } else {
        results.push(result);
      }

      completed++;
      const status = result.status === "PASS" ? (isNew ? "PASS [NEW]" : "PASS") : `FAIL (${result.failReasons.join(", ")})`;
      console.log(`[${completed}/${total}] ${item.ticker}: ${status}`);
      await client.sleep(800);
    }
  }

  // Run all clients in parallel
  await Promise.all(clients.map(c => processNext(c)));

  // Retry timed-out tickers with reconnected clients
  if (retryQueue.length > 0) {
    console.log(`\n=== RETRYING ${retryQueue.length} timed-out tickers ===`);

    // Disconnect and reconnect all clients
    for (const c of clients) await c.disconnect();
    await clients[0].sleep(2000);
    for (const c of clients) {
      await c.connect();
      console.log(`  Client ${c.id} reconnected`);
      await clients[0].sleep(300);
    }

    const retryTotal = retryQueue.length;
    let retryCompleted = 0;

    async function retryProcess(client: ScannerClient): Promise<void> {
      while (retryQueue.length > 0) {
        const item = retryQueue.shift()!;
        const isNew = !existingTickers.has(item.ticker.toUpperCase());
        const result = await validateTicker(client, item.ticker, item.mcapM, isNew);
        results.push(result);
        retryCompleted++;
        const status = result.status === "PASS" ? (isNew ? "PASS [NEW]" : "PASS") : `FAIL (${result.failReasons.join(", ")})`;
        console.log(`[RETRY ${retryCompleted}/${retryTotal}] ${item.ticker}: ${status}`);
        await client.sleep(1200);
      }
    }

    await Promise.all(clients.map(c => retryProcess(c)));
  }

  // Disconnect
  for (const c of clients) await c.disconnect();

  // Summary
  const passed = results.filter(r => r.status === "PASS");
  const failed = results.filter(r => r.status === "FAIL");
  const skipped = results.filter(r => r.status === "SKIPPED");

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total: ${results.length} | Passed: ${passed.length} | Failed: ${failed.length} | Skipped: ${skipped.length}`);

  const newPassed = passed.filter(r => r.isNew);
  if (newPassed.length > 0) {
    console.log(`\n=== NEW Tickers (not in DB) ===`);
    for (const r of newPassed) console.log(`  ${r.ticker} (MCap: ${r.mcapM}M)`);
  }

  const existingFailed = failed.filter(r => !r.isNew);
  if (existingFailed.length > 0) {
    console.log(`\n=== EXISTING that FAILED ===`);
    for (const r of existingFailed) console.log(`  ${r.ticker}: ${r.failReasons.join(", ")}`);
  }

  console.log(`\n=== All Passing (${passed.length}) ===`);
  console.log(passed.map(r => r.ticker).join(", "));

  const outputPath = resolve(__dirname, `../scan-results-${new Date().toISOString().split("T")[0]}.json`);
  writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\nResults: ${outputPath}`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
