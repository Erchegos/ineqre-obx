export type ValuationRow = {
  ticker: string;
  name: string;
  sector: string;
  currency: string;
  price: number | null;
  priceDate: string | null;
  ep: number | null;
  bm: number | null;
  evEbitda: number | null;
  dy: number | null;
  sp: number | null;
  mktcap: number | null;
};

export async function fetchBulkValuation(): Promise<ValuationRow[]> {
  const res = await fetch("/api/valuation/bulk");
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || "Unknown error");
  return json.data;
}

export function computeMultiples(row: ValuationRow) {
  const pe = row.ep && row.ep !== 0 ? 1 / row.ep : null;
  const pb = row.bm && row.bm !== 0 ? 1 / row.bm : null;
  const ps = row.sp && row.sp !== 0 ? 1 / row.sp : null;
  const dyPct = row.dy != null ? row.dy * 100 : null;
  const mktcapB = row.mktcap != null ? row.mktcap / 1e9 : null;
  return { pe, pb, ps, dyPct, evEbitda: row.evEbitda, mktcapB };
}
