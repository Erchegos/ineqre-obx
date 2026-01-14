// apps/web/src/lib/market.ts
export type DailyBar = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
  source: "obx_csv_db";
};

export type ReturnRow = { date: string; log_return: number };
export type VolRow = { date: string; volatility: number };

export function computeLogReturns(rowsAsc: DailyBar[]): ReturnRow[] {
  const out: ReturnRow[] = [];
  for (let i = 1; i < rowsAsc.length; i++) {
    const prev = rowsAsc[i - 1]?.close;
    const cur = rowsAsc[i]?.close;
    if (prev > 0 && cur > 0) {
      out.push({ date: rowsAsc[i].date, log_return: Math.log(cur / prev) });
    }
  }
  return out;
}

export function rollingVolatility(returns: ReturnRow[], window: number): VolRow[] {
  if (window <= 1) return [];
  const out: VolRow[] = [];
  const buf: number[] = [];

  const std = (xs: number[]) => {
    const n = xs.length;
    if (n < 2) return 0;
    let mean = 0;
    for (const x of xs) mean += x;
    mean /= n;

    let v = 0;
    for (const x of xs) v += (x - mean) * (x - mean);
    v /= n - 1;
    return Math.sqrt(v);
  };

  for (const r of returns) {
    buf.push(r.log_return);
    if (buf.length > window) buf.shift();
    if (buf.length === window) {
      out.push({ date: r.date, volatility: std(buf) });
    }
  }
  return out;
}
