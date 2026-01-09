// apps/web/src/lib/stocks-server.ts
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export type StockRow = {
  ticker: string;
  name: string | null;
  sector: string | null;
  exchange: string | null;
  currency: string | null;
  isActive: boolean | null;
  lastDate: string | null;
  lastClose: number | null;
  startDate: string | null;
  endDate: string | null;
  rows: number;
};

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function getStocks(limit = 5000): Promise<{ count: number; rows: StockRow[] }> {
  const q = sql`
    with px as (
      select
        upper(ticker) as ticker,
        min(date::date) as "startDate",
        max(date::date) as "endDate",
        count(*)::int as rows
      from public.prices_daily
      group by upper(ticker)
    )
    select
      upper(s.ticker) as ticker,
      s.name as name,
      s.sector as sector,
      s.exchange as exchange,
      s.currency as currency,
      s.is_active as "isActive",
      s.last_date::date as "lastDate",
      s.last_close as "lastClose",
      p."startDate" as "startDate",
      p."endDate" as "endDate",
      coalesce(p.rows, 0) as rows
    from public.stocks_latest s
    left join px p on p.ticker = upper(s.ticker)
    order by upper(s.ticker) asc
    limit ${limit}
  `;

  const res = await db.execute(q);
  const raw = ((res as any)?.rows ?? []) as any[];

  const rows: StockRow[] = raw.map((r) => ({
    ticker: String(r.ticker ?? ""),
    name: r.name ?? null,
    sector: r.sector ?? null,
    exchange: r.exchange ?? null,
    currency: r.currency ?? null,
    isActive: r.isActive ?? null,
    lastDate: r.lastDate ? String(r.lastDate).slice(0, 10) : null,
    lastClose: toNum(r.lastClose),
    startDate: r.startDate ? String(r.startDate).slice(0, 10) : null,
    endDate: r.endDate ? String(r.endDate).slice(0, 10) : null,
    rows: typeof r.rows === "number" ? r.rows : Number(r.rows ?? 0),
  }));

  return { count: rows.length, rows };
}
