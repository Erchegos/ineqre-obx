// apps/web/src/app/api/prices/[ticker]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

type Row = {
  date: string;
  close: number;
  adj_close: number | null;
  volume: number | null;
  source: string;
};

function pct(a: number, b: number) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return (a / b) - 1;
}

function rollingStd(values: Array<number | null>, window: number) {
  const out: Array<number | null> = new Array(values.length).fill(null);
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  const q: number[] = [];

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) {
      q.push(NaN);
    } else {
      q.push(v);
      sum += v;
      sumSq += v * v;
      n += 1;
    }

    if (q.length > window) {
      const old = q.shift()!;
      if (Number.isFinite(old)) {
        sum -= old;
        sumSq -= old * old;
        n -= 1;
      }
    }

    if (q.length === window && n === window) {
      const mean = sum / n;
      const varPop = (sumSq / n) - mean * mean;
      const varSafe = varPop > 0 ? varPop : 0;
      out[i] = Math.sqrt(varSafe);
    }
  }
  return out;
}

function drawdown(series: number[]) {
  const out: number[] = new Array(series.length).fill(0);
  let peak = -Infinity;
  for (let i = 0; i < series.length; i++) {
    const v = series[i];
    if (v > peak) peak = v;
    out[i] = peak > 0 ? (v / peak) - 1 : 0;
  }
  return out;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "1500"), 5000);

  const source = searchParams.get("source"); // optional, ex "euronext"

  // Fetch ticker rows
  const rows = await db.execute<Row>(sql`
    select
      to_char(date, 'YYYY-MM-DD') as date,
      close::float8 as close,
      adj_close::float8 as adj_close,
      volume::float8 as volume,
      source
    from prices_daily
    where ticker = ${ticker}
      ${source ? sql`and source = ${source}` : sql``}
    order by date asc
    limit ${limit}
  `);

  // Fetch OBX rows (used as benchmark spine)
  const obx = await db.execute<Row>(sql`
    select
      to_char(date, 'YYYY-MM-DD') as date,
      close::float8 as close,
      adj_close::float8 as adj_close,
      volume::float8 as volume,
      source
    from prices_daily
    where ticker = 'OBX'
    order by date asc
    limit ${limit}
  `);

  const px = rows.rows ?? [];
  const bx = obx.rows ?? [];

  // Map OBX by date for alignment
  const obxByDate = new Map<string, Row>();
  for (const r of bx) obxByDate.set(r.date, r);

  const dates: string[] = [];
  const close: number[] = [];
  const priceRet: Array<number | null> = [];
  const totalRet: Array<number | null> = [];
  const excessRet: Array<number | null> = [];

  const obxClose: Array<number | null> = [];
  const obxPriceRet: Array<number | null> = [];

  for (let i = 0; i < px.length; i++) {
    const r = px[i];
    dates.push(r.date);
    close.push(r.close);

    const prev = i > 0 ? px[i - 1] : null;
    const pr = prev ? pct(r.close, prev.close) : null;
    priceRet.push(pr);

    const rAdj = r.adj_close ?? null;
    const prevAdj = prev?.adj_close ?? null;
    const tr = rAdj != null && prevAdj != null ? pct(rAdj, prevAdj) : pr;
    totalRet.push(tr);

    const obxRow = obxByDate.get(r.date) ?? null;
    obxClose.push(obxRow?.close ?? null);

    const prevDate = i > 0 ? px[i - 1].date : null;
    const obxPrev = prevDate ? (obxByDate.get(prevDate) ?? null) : null;
    const obxPr = obxRow && obxPrev ? pct(obxRow.close, obxPrev.close) : null;
    obxPriceRet.push(obxPr);

    excessRet.push(tr != null && obxPr != null ? tr - obxPr : null);
  }

  const vol20 = rollingStd(priceRet, 20).map((x) => (x == null ? null : x * Math.sqrt(252)));
  const vol63 = rollingStd(priceRet, 63).map((x) => (x == null ? null : x * Math.sqrt(252)));
  const vol252 = rollingStd(priceRet, 252).map((x) => (x == null ? null : x * Math.sqrt(252)));

  const dd = drawdown(close);

  return NextResponse.json({
    ticker,
    limit,
    source: source ?? "all",
    rows: px,
    series: dates.map((d, i) => ({
      date: d,
      close: close[i],
      price_return: priceRet[i],
      total_return: totalRet[i],
      excess_return_obx: excessRet[i],
      vol_20: vol20[i],
      vol_63: vol63[i],
      vol_252: vol252[i],
      drawdown: dd[i],
      obx_close: obxClose[i],
      obx_price_return: obxPriceRet[i],
    })),
    stats: {
      count: px.length,
      last_date: dates.at(-1) ?? null,
      last_close: close.at(-1) ?? null,
      last_vol_20: vol20.at(-1) ?? null,
      last_drawdown: dd.at(-1) ?? null,
    },
  });
}
