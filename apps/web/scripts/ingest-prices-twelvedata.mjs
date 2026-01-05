import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;

  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;

    const eq = t.indexOf('=');
    if (eq === -1) continue;

    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();

    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }

    if (!process.env[key]) process.env[key] = val;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJsonWithRetry(url, tries = 5) {
  let waitMs = 1000;

  for (let i = 0; i < tries; i++) {
    const res = await fetch(url);

    if (res.status === 429) {
      await sleep(waitMs);
      waitMs = Math.min(waitMs * 2, 15000);
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
    }

    return res.json();
  }

  throw new Error('Rate limited too many times');
}

function normalizePoints(values) {
  return (values ?? [])
    .map((v) => ({
      date: String(v.datetime).slice(0, 10),
      open: v.open == null ? null : Number(v.open),
      high: v.high == null ? null : Number(v.high),
      low: v.low == null ? null : Number(v.low),
      close: v.close == null ? null : Number(v.close),
      volume: v.volume == null ? null : Number(v.volume),
    }))
    .filter((p) => p.date && Number.isFinite(p.close));
}

async function fetchTwelveDataDaily(apiKey, symbol, outputsize = 5000) {
  const qs = new URLSearchParams({
    apikey: apiKey,
    symbol,
    interval: '1day',
    outputsize: String(outputsize),
    format: 'JSON',
  });

  const url = `https://api.twelvedata.com/time_series?${qs.toString()}`;
  const json = await fetchJsonWithRetry(url);

  if (json?.status === 'error') {
    throw new Error(`Twelve Data error for ${symbol}: ${json?.message ?? 'unknown'}`);
  }

  return normalizePoints(json?.values);
}

function baseTicker(ticker) {
  return String(ticker).split('.')[0].trim();
}

function pickBestSymbol(results, stock) {
  if (!Array.isArray(results) || results.length === 0) return null;

  const bt = baseTicker(stock.ticker).toUpperCase();
  const norm = (s) => String(s ?? '').toUpperCase();

  const osloOnly = results.filter((r) => {
    const ex = norm(r.exchange);
    const mic = norm(r.mic_code);
    const country = norm(r.country);
    return ex.includes('OSLO') || mic === 'XOSL' || country === 'NORWAY';
  });

  const pool = osloOnly.length ? osloOnly : results;

  const exact = pool.find((r) => norm(r.symbol) === bt);
  if (exact) return exact.symbol;

  const prefix = pool.find((r) => norm(r.symbol).startsWith(bt));
  if (prefix) return prefix.symbol;

  return pool[0]?.symbol ?? null;
}

async function resolveTwelveDataSymbol(apiKey, stock) {
  const q = baseTicker(stock.ticker);
  const qs = new URLSearchParams({ apikey: apiKey, symbol: q });
  const url = `https://api.twelvedata.com/symbol_search?${qs.toString()}`;

  const json = await fetchJsonWithRetry(url);

  if (json?.status === 'error') {
    throw new Error(`Symbol search error for ${stock.ticker}: ${json?.message ?? 'unknown'}`);
  }

  const chosen = pickBestSymbol(json?.data, stock);
  return chosen;
}

function isInvalidSymbolError(msg) {
  const m = String(msg ?? '').toLowerCase();
  return m.includes('missing or invalid') || m.includes('provide a valid symbol');
}

function isPlanGatedError(msg) {
  const m = String(msg ?? '').toLowerCase();
  return m.includes('starting with pro') || m.includes('available starting with pro');
}

async function fetchDailyWithAutoResolve(tdKey, supabase, stock) {
  try {
    return { points: await fetchTwelveDataDaily(tdKey, stock.td_symbol, 5000), updated: false };
  } catch (err) {
    const msg = err?.message ?? String(err);

    if (isPlanGatedError(msg)) {
      return { points: [], gated: true, updated: false, message: msg };
    }

    if (!isInvalidSymbolError(msg)) {
      throw err;
    }

    const resolved = await resolveTwelveDataSymbol(tdKey, stock);

    if (!resolved) {
      return { points: [], updated: false, message: `No symbol_search match for ${stock.ticker}` };
    }

    const { error: updErr } = await supabase
      .from('stocks')
      .update({ td_symbol: resolved })
      .eq('ticker', stock.ticker);

    if (updErr) {
      throw new Error(`Failed to update td_symbol for ${stock.ticker}: ${updErr.message}`);
    }

    const points = await fetchTwelveDataDaily(tdKey, resolved, 5000);

    return { points, updated: true, resolved };
  }
}

async function main() {
  loadEnvLocal();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const tdKey = process.env.TWELVEDATA_API_KEY;

  if (!supabaseUrl || !serviceKey || !tdKey) {
    throw new Error(
      'Missing env vars. Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TWELVEDATA_API_KEY in apps/web/.env.local'
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: stocks, error: stocksErr } = await supabase
    .from('stocks')
    .select('ticker, name, td_symbol')
    .eq('is_active', true);

  if (stocksErr) throw stocksErr;

  let totalRows = 0;
  let failed = 0;

  // Basic plan is 8 credits per minute, so keep to one request each ~8 seconds.
  const minDelayMs = 8000;

  for (const stock of stocks ?? []) {
    const tdSymbol = stock.td_symbol;

    if (!tdSymbol) {
      console.log(`Skip, missing td_symbol: ${stock.ticker}`);
      continue;
    }

    try {
      const t0 = Date.now();

      const result = await fetchDailyWithAutoResolve(tdKey, supabase, stock);

      if (result.gated) {
        console.log(`Skip (plan-gated): ${stock.ticker} (${tdSymbol})`);
        const elapsed = Date.now() - t0;
        if (elapsed < minDelayMs) await sleep(minDelayMs - elapsed);
        continue;
      }

      if (result.updated) {
        console.log(`Resolved symbol: ${stock.ticker} ${tdSymbol} -> ${result.resolved}`);
      }

      const points = result.points ?? [];

      if (!points.length) {
        console.log(`No data returned: ${stock.ticker} (${tdSymbol})`);
      } else {
        const payload = points.map((p) => ({
          ticker: stock.ticker,
          date: p.date,
          open: p.open,
          high: p.high,
          low: p.low,
          close: p.close,
          volume: p.volume ?? 0,
          source: 'twelvedata',
        }));

        const { error: upsertErr } = await supabase
          .from('prices_daily')
          .upsert(payload, { onConflict: 'ticker,date' });

        if (upsertErr) throw upsertErr;

        totalRows += payload.length;
        console.log(`Upserted ${payload.length}: ${stock.ticker} (${tdSymbol})`);
      }

      const elapsed = Date.now() - t0;
      if (elapsed < minDelayMs) await sleep(minDelayMs - elapsed);
    } catch (err) {
      failed += 1;
      console.log(`Failed: ${stock.ticker} (${tdSymbol})`);
      console.log(err?.message ?? JSON.stringify(err, null, 2));
      await sleep(minDelayMs);
    }
  }

  console.log(`Done. Rows upserted: ${totalRows}. Tickers failed: ${failed}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
