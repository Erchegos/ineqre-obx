import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

// Load repo root .env regardless of current working directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const SOURCE = "mock";

function iso(d) {
  return d.toISOString().slice(0, 10);
}

function makeSeries(ticker, days = 250) {
  const out = [];
  const start = new Date();
  start.setDate(start.getDate() - days);

  let px = 100 + (ticker.charCodeAt(0) % 20);

  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);

    // skip weekends
    const wd = d.getDay();
    if (wd === 0 || wd === 6) continue;

    // deterministic drift + wobble
    const wobble = ((i % 17) - 8) * 0.08;
    px = Math.max(5, px * (1 + 0.0006 + wobble / 100));

    const close = Number(px.toFixed(4));
    const open = Number((close * 0.998).toFixed(4));
    const high = Number((close * 1.006).toFixed(4));
    const low = Number((close * 0.994).toFixed(4));
    const volume = 100000 + (i % 50) * 1000;

    out.push({
      ticker,
      date: iso(d),
      open,
      high,
      low,
      close,
      adj_close: close,
      volume,
      source: SOURCE,
    });
  }

  return out;
}

async function fetchUniverse() {
  const { data, error } = await supabase.from("stocks").select("ticker").eq("is_active", true);
  if (error) throw error;
  return (data ?? []).map((r) => r.ticker);
}

async function hasAnyRows(ticker) {
  const { data, error } = await supabase
    .from("prices_daily")
    .select("id")
    .eq("ticker", ticker)
    .limit(1);

  if (error) throw error;
  return (data ?? []).length > 0;
}

async function upsertBatch(rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await supabase.from("prices_daily").upsert(batch);
    if (error) throw error;
  }
}

async function main() {
  const tickers = await fetchUniverse();

  let filled = 0;
  for (const t of tickers) {
    const exists = await hasAnyRows(t);
    if (exists) {
      console.log(`Skip: ${t} already has data`);
      continue;
    }

    const rows = makeSeries(t);
    await upsertBatch(rows);
    console.log(`Mock upserted: ${rows.length} rows for ${t}`);
    filled += 1;
  }

  console.log(`Done. Filled tickers: ${filled}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
