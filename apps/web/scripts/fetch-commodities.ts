/**
 * Commodity Price Fetcher
 *
 * Fetches daily OHLCV for key commodities from Yahoo Finance.
 * Calculates commodity-stock sensitivity (beta, correlation) for OSE equities.
 *
 * Commodities tracked:
 *   BZ=F   Brent Crude Oil   → EQNR, AKRBP, DNO, SUBC, VAR, DOFG
 *   CL=F   WTI Crude Oil     → reference
 *   SALMON Salmon (SSB)      → MOWI, SALM, LSG, GSF, BAKKA, AUSS
 *   ALI=F  Aluminium LME     → NHY
 *   GC=F   Gold              → reference/hedge
 *   SI=F   Silver            → reference
 *   GSAL   Salmon (MH)       → MOWI, SALM, LSG, GSF, BAKKA, AUSS
 *
 * Run: pnpm run commodities:fetch
 * Options:
 *   --days=365   Days of history to fetch (default 365)
 *   --dry-run    Print but don't insert
 *   --skip-sensitivity  Skip commodity-stock sensitivity calculation
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

// ── Config ──
const DAYS_BACK = parseInt(
  process.argv.find((a) => a.startsWith("--days="))?.split("=")[1] ?? "365"
);
const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_SENSITIVITY = process.argv.includes("--skip-sensitivity");

// ── DB setup ──
const dbUrl = (process.env.DATABASE_URL || "").trim().replace(/^["']|["']$/g, "");
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const pool = new Pool({ connectionString: dbUrl });

// ── Commodities to track ──
interface CommodityDef {
  symbol: string;
  yahooSymbol: string;
  name: string;
  currency: string;
  relatedTickers: string[];
}

const COMMODITIES: CommodityDef[] = [
  {
    symbol: "BZ=F",
    yahooSymbol: "BZ=F",
    name: "Brent Crude Oil",
    currency: "USD",
    relatedTickers: ["EQNR", "AKRBP", "DNO", "SUBC", "VAR", "DOFG", "OET", "TGS"],
  },
  {
    symbol: "CL=F",
    yahooSymbol: "CL=F",
    name: "WTI Crude Oil",
    currency: "USD",
    relatedTickers: ["EQNR", "AKRBP", "DNO"],
  },
  {
    symbol: "ALI=F",
    yahooSymbol: "ALI=F",
    name: "Aluminium",
    currency: "USD",
    relatedTickers: ["NHY", "ELK"],
  },
  {
    symbol: "GC=F",
    yahooSymbol: "GC=F",
    name: "Gold",
    currency: "USD",
    relatedTickers: [],
  },
  {
    symbol: "SI=F",
    yahooSymbol: "SI=F",
    name: "Silver",
    currency: "USD",
    relatedTickers: [],
  },
];

// ── Yahoo Finance v8 chart API ──
async function fetchYahooChart(
  symbol: string,
  period1: number,
  period2: number
): Promise<any[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`;
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
    },
  });

  if (!resp.ok) {
    console.error(`  Yahoo error for ${symbol}: ${resp.status}`);
    return [];
  }

  const data = await resp.json();
  const result = data?.chart?.result?.[0];
  if (!result?.timestamp) return [];

  const { timestamp, indicators } = result;
  const quote = indicators?.quote?.[0];
  if (!quote) return [];

  const rows: any[] = [];
  for (let i = 0; i < timestamp.length; i++) {
    const d = new Date(timestamp[i] * 1000);
    const dateStr = d.toISOString().slice(0, 10);
    if (quote.close[i] == null) continue;

    rows.push({
      date: dateStr,
      open: quote.open[i],
      high: quote.high[i],
      low: quote.low[i],
      close: quote.close[i],
      volume: quote.volume?.[i] || null,
    });
  }

  return rows;
}

// ── Salmon from SSB (Statistics Norway) ──
// Table 03024: Weekly salmon export prices (NOK/kg)
const SALMON_RELATED_TICKERS = ["MOWI", "SALM", "LSG", "GSF", "BAKKA", "AUSS"];

async function fetchSalmonSSB(
  existingKeys: Set<string>,
  weeksBack: number = 52
): Promise<number> {
  console.log("Fetching Salmon prices from SSB (Statistics Norway)...");

  // Use SSB "top" filter to get most recent N weeks
  const body = {
    query: [
      {
        code: "VareGrupper2",
        selection: { filter: "item", values: ["01"] }, // Fresh salmon
      },
      {
        code: "ContentsCode",
        selection: { filter: "item", values: ["Kilopris"] },
      },
      {
        code: "Tid",
        selection: { filter: "top", values: [String(weeksBack)] },
      },
    ],
    response: { format: "json-stat2" },
  };

  const resp = await fetch("https://data.ssb.no/api/v0/en/table/03024", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    console.error(`  SSB API error: ${resp.status} ${resp.statusText}`);
    if (errBody) console.error(`  Response: ${errBody.slice(0, 500)}`);
    return 0;
  }

  const data = await resp.json();
  const timeLabels: string[] = Object.keys(data.dimension?.Tid?.category?.label || {});
  const values: (number | null)[] = data.value || [];

  if (timeLabels.length === 0) {
    console.error("  No salmon data from SSB");
    return 0;
  }

  console.log(`  ${timeLabels.length} weekly data points from SSB`);

  let inserted = 0;
  for (let i = 0; i < timeLabels.length; i++) {
    const weekCode = timeLabels[i]; // e.g., "2026U08"
    const price = values[i];
    if (price == null || price <= 0) continue;

    // Convert week code to a Friday date (end of trading week)
    const match = weekCode.match(/^(\d{4})U(\d{2})$/);
    if (!match) continue;
    const year = parseInt(match[1]);
    const week = parseInt(match[2]);
    // ISO week: week 1 contains Jan 4
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7; // 1=Mon..7=Sun
    const weekStart = new Date(jan4.getTime() + (1 - dayOfWeek) * 86400000);
    const friday = new Date(weekStart.getTime() + ((week - 1) * 7 + 4) * 86400000);
    const dateStr = friday.toISOString().slice(0, 10);

    const key = `SALMON|${dateStr}`;
    if (existingKeys.has(key)) continue;

    if (DRY_RUN) {
      console.log(`  [DRY] SALMON ${dateStr} (${weekCode}): NOK ${price.toFixed(2)}/kg`);
    } else {
      await pool.query(
        `INSERT INTO commodity_prices (symbol, date, open, high, low, close, volume, currency, source)
         VALUES ($1, $2, $3, $3, $3, $3, NULL, 'NOK', 'ssb')
         ON CONFLICT (symbol, date) DO UPDATE SET close = EXCLUDED.close`,
        ["SALMON", dateStr, price]
      );
      existingKeys.add(key);
      inserted++;
    }
  }

  console.log(`  ${inserted} new salmon price rows inserted\n`);
  return inserted;
}

// ── Sensitivity calculation ──
function computeReturns(closes: number[]): number[] {
  const ret: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) {
      ret.push(Math.log(closes[i] / closes[i - 1]));
    } else {
      ret.push(0);
    }
  }
  return ret;
}

function correlation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 10) return 0;

  const mx = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = y.slice(0, n).reduce((a, b) => a + b, 0) / n;

  let cov = 0,
    vx = 0,
    vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }

  const denom = Math.sqrt(vx * vy);
  return denom > 0 ? cov / denom : 0;
}

function olsBeta(
  x: number[],
  y: number[]
): { beta: number; rSquared: number } {
  const n = Math.min(x.length, y.length);
  if (n < 10) return { beta: 0, rSquared: 0 };

  const mx = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = y.slice(0, n).reduce((a, b) => a + b, 0) / n;

  let cov = 0,
    vx = 0;
  for (let i = 0; i < n; i++) {
    cov += (x[i] - mx) * (y[i] - my);
    vx += (x[i] - mx) ** 2;
  }

  const beta = vx > 0 ? cov / vx : 0;
  const corr = correlation(x.slice(0, n), y.slice(0, n));
  return { beta, rSquared: corr * corr };
}

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  Commodity Price Fetcher");
  console.log("═══════════════════════════════════════════════════\n");

  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - DAYS_BACK * 86400;

  // Load existing dates for dedup
  const { rows: existingRows } = await pool.query(
    `SELECT DISTINCT symbol || '|' || date::text AS key FROM commodity_prices`
  );
  const existingKeys = new Set(existingRows.map((r: any) => r.key));
  console.log(`  ${existingKeys.size} existing commodity_prices for dedup\n`);

  let totalInserted = 0;

  for (const comm of COMMODITIES) {
    console.log(`Fetching ${comm.name} (${comm.yahooSymbol})...`);
    const rows = await fetchYahooChart(comm.yahooSymbol, period1, period2);
    console.log(`  ${rows.length} data points from Yahoo`);

    let inserted = 0;
    for (const row of rows) {
      const key = `${comm.symbol}|${row.date}`;
      if (existingKeys.has(key)) continue;

      if (DRY_RUN) {
        console.log(
          `  [DRY] ${comm.symbol} ${row.date}: ${row.close.toFixed(2)}`
        );
      } else {
        await pool.query(
          `INSERT INTO commodity_prices (symbol, date, open, high, low, close, volume, currency, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'yahoo')
           ON CONFLICT (symbol, date) DO UPDATE SET
             open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
             close = EXCLUDED.close, volume = EXCLUDED.volume`,
          [
            comm.symbol,
            row.date,
            row.open,
            row.high,
            row.low,
            row.close,
            row.volume,
            comm.currency,
          ]
        );
        existingKeys.add(key);
        inserted++;
      }
    }

    console.log(`  ${inserted} new rows inserted\n`);
    totalInserted += inserted;

    // Rate limit between Yahoo requests
    await new Promise((r) => setTimeout(r, 500));
  }

  // ── Salmon from SSB ──
  const salmonInserted = await fetchSalmonSSB(existingKeys, Math.ceil(DAYS_BACK / 7));
  totalInserted += salmonInserted;

  console.log(`Total commodity prices inserted: ${totalInserted}\n`);

  // ── Commodity-Stock Sensitivity ──
  if (!SKIP_SENSITIVITY && !DRY_RUN) {
    console.log("═══════════════════════════════════════════════════");
    console.log("  Calculating Commodity-Stock Sensitivity");
    console.log("═══════════════════════════════════════════════════\n");

    const today = new Date().toISOString().slice(0, 10);
    let sensitivityCount = 0;

    // Include salmon alongside Yahoo commodities for sensitivity
    const allCommodities = [
      ...COMMODITIES,
      { symbol: "SALMON", relatedTickers: SALMON_RELATED_TICKERS },
    ];

    for (const comm of allCommodities) {
      if (comm.relatedTickers.length === 0) continue;

      // Load commodity returns (252 days)
      const { rows: commPrices } = await pool.query(
        `SELECT date::text AS date, close::float AS close FROM commodity_prices
         WHERE symbol = $1 ORDER BY date ASC`,
        [comm.symbol]
      );

      if (commPrices.length < 30) {
        console.log(
          `  Skipping ${comm.symbol}: only ${commPrices.length} data points`
        );
        continue;
      }

      const commCloses = commPrices.map((r) => r.close);
      const commReturns = computeReturns(commCloses);
      const commDates: string[] = commPrices.map((r) => r.date).slice(1);

      for (const ticker of comm.relatedTickers) {
        // Load stock returns aligned by date
        const { rows: stockPrices } = await pool.query(
          `SELECT date::text AS date, close::float AS close FROM prices_daily
           WHERE upper(ticker) = $1 AND close IS NOT NULL
           ORDER BY date ASC`,
          [ticker]
        );

        if (stockPrices.length < 60) continue;

        // Align dates (use string keys for reliable Map lookup)
        const stockMap = new Map<string, number>(
          stockPrices.map((r) => [r.date, r.close])
        );
        const alignedComm: number[] = [];
        const alignedStock: number[] = [];
        let prevComm: number | null = null;
        let prevStock: number | null = null;

        for (let i = 0; i < commDates.length; i++) {
          const d = commDates[i];
          const sc = stockMap.get(d);
          if (sc != null && prevComm != null && prevStock != null) {
            alignedComm.push(commReturns[i]);
            alignedStock.push(Math.log(sc / prevStock));
          }
          prevComm = commCloses[i + 1];
          if (sc != null) prevStock = sc;
        }

        if (alignedComm.length < 30) continue;

        // Full-period regression
        const full = olsBeta(alignedComm, alignedStock);

        // 60d correlation (most recent)
        const recent60Comm = alignedComm.slice(-60);
        const recent60Stock = alignedStock.slice(-60);
        const corr60 = correlation(recent60Comm, recent60Stock);

        // 252d correlation
        const recent252Comm = alignedComm.slice(-252);
        const recent252Stock = alignedStock.slice(-252);
        const corr252 = correlation(recent252Comm, recent252Stock);

        await pool.query(
          `INSERT INTO commodity_stock_sensitivity
             (ticker, commodity_symbol, beta, correlation_60d, correlation_252d, r_squared, as_of_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (ticker, commodity_symbol, as_of_date) DO UPDATE SET
             beta = EXCLUDED.beta,
             correlation_60d = EXCLUDED.correlation_60d,
             correlation_252d = EXCLUDED.correlation_252d,
             r_squared = EXCLUDED.r_squared`,
          [ticker, comm.symbol, full.beta, corr60, corr252, full.rSquared, today]
        );

        console.log(
          `  ${ticker} ↔ ${comm.symbol}: β=${full.beta.toFixed(3)}, ρ60=${corr60.toFixed(3)}, ρ252=${corr252.toFixed(3)}, R²=${full.rSquared.toFixed(3)}`
        );
        sensitivityCount++;
      }
    }

    console.log(`\nSensitivity rows inserted: ${sensitivityCount}`);
  }

  await pool.end();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
