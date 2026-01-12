import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

type CsvRow = Record<string, string>;

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsv(content: string): CsvRow[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const row: CsvRow = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = (cols[j] ?? "").trim();
    rows.push(row);
  }
  return rows;
}

function toNum(v: string): number | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function normDate(v: string): string {
  const s = (v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split(".");
    return `${yyyy}-${mm}-${dd}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`Bad date: ${v}`);
  return d.toISOString().slice(0, 10);
}

async function upsertStage(client: Client, rows: any[]) {
  if (rows.length === 0) return;

  const cols = [
    "ticker",
    "date",
    "open",
    "high",
    "low",
    "close",
    "adj_close",
    "number_of_shares",
    "number_of_trades",
    "turnover",
    "vwap",
  ];

  const chunkSize = 2000;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);

    const values: any[] = [];
    const placeholders: string[] = [];
    let p = 1;

    for (const r of chunk) {
      placeholders.push(
        `($${p++}, $${p++}::date, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`
      );
      values.push(
        String(r.ticker).toUpperCase(),
        r.date,
        r.open,
        r.high,
        r.low,
        r.close,
        r.adj_close,
        r.number_of_shares,
        r.number_of_trades,
        r.turnover,
        r.vwap
      );
    }

    const q = `
      insert into public.prices_daily_stage_euronext
        (${cols.join(",")})
      values
        ${placeholders.join(",")}
      on conflict (ticker, date) do update set
        open = excluded.open,
        high = excluded.high,
        low = excluded.low,
        close = excluded.close,
        adj_close = excluded.adj_close,
        number_of_shares = excluded.number_of_shares,
        number_of_trades = excluded.number_of_trades,
        turnover = excluded.turnover,
        vwap = excluded.vwap
    `;

    await client.query(q, values);
  }
}

async function promoteToPricesDaily(client: Client) {
  const q = `
    insert into public.prices_daily
      (ticker, date, open, high, low, close, adj_close, volume, source)
    select
      upper(s.ticker) as ticker,
      s.date::date as date,
      s.open,
      s.high,
      s.low,
      s.close,
      s.adj_close,
      coalesce(s.number_of_shares, 0)::bigint as volume,
      'euronext' as source
    from public.prices_daily_stage_euronext s
    where s.ticker is not null and s.date is not null
    on conflict (ticker, date) do update set
      open = excluded.open,
      high = excluded.high,
      low = excluded.low,
      close = excluded.close,
      adj_close = excluded.adj_close,
      volume = excluded.volume,
      source = excluded.source
  `;
  await client.query(q);
}

async function main() {
  const databaseUrl = process.env.SUPABASE_DATABASE_URL;
  if (!databaseUrl) throw new Error("SUPABASE_DATABASE_URL missing");

  const baseDir =
    "/Users/olaslettebak/Documents/Intelligence Equity Research /CSV_OBX_Equity_CLEAN";

  const equityFile = path.join(baseDir, "obx_equities.clean.csv");
  if (!fs.existsSync(equityFile)) throw new Error(`Missing: ${equityFile}`);

  const csv = fs.readFileSync(equityFile, "utf8");
  const parsed = parseCsv(csv);

  const rows = parsed
    .map((r) => {
      const ticker = r["ticker"] || r["Ticker"] || r["symbol"] || r["Symbol"];
      const date = r["date"] || r["Date"];

      if (!ticker || !date) return null;

      const open = toNum(r["open"] || r["Open"] || "");
      const high = toNum(r["high"] || r["High"] || "");
      const low = toNum(r["low"] || r["Low"] || "");
      const close = toNum(r["close"] || r["Close"] || "");
      const adjClose =
        toNum(r["adj_close"] || r["Adj Close"] || r["adjClose"] || "") ?? close;

      const shares = toNum(r["number_of_shares"] || r["Number of shares"] || "");
      const trades = toNum(r["number_of_trades"] || r["Number of trades"] || "");
      const turnover = toNum(r["turnover"] || r["Turnover"] || "");
      const vwap = toNum(r["vwap"] || r["VWAP"] || "");

      return {
        ticker: String(ticker).trim(),
        date: normDate(String(date)),
        open,
        high,
        low,
        close,
        adj_close: adjClose,
        number_of_shares: shares,
        number_of_trades: trades,
        turnover,
        vwap,
      };
    })
    .filter(Boolean) as any[];

  const client = new Client({
    connectionString: databaseUrl,
    // Supabase pooler uses TLS; Node sometimes rejects the chain on macOS.
    // This is acceptable for a controlled ingestion job.
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  await client.query("truncate table public.prices_daily_stage_euronext");
  await upsertStage(client, rows);
  await promoteToPricesDaily(client);

  const stats = await client.query(`
    select
      count(*) as rows,
      count(distinct ticker) as tickers,
      min(date)::date as min_date,
      max(date)::date as max_date
    from public.prices_daily
    where source = 'euronext'
  `);

  console.log(stats.rows[0]);

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
