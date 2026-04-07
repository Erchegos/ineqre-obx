/**
 * GET /api/flow/live/[ticker]
 *
 * Fetches today's intraday trades directly from Euronext Live (15-min delayed).
 * Does NOT hit the DB — always fresh from the source.
 * Applies tick rule for side classification.
 * Filters: Exchange Continuous + Trading at last + Retail Matching Facility only
 *          (no dark pool, no off-book, no auction).
 *
 * Returns: { ticker, date, count, lastTradeTime, ticks: [{ts,price,size,side}] }
 *
 * Only supported for the 5 flow page tickers.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Oslo market is UTC+2 (CEST) — 15 min delay means last trade is ~15 min old
const FLOW_ISINS: Record<string, string> = {
  EQNR: "NO0010096985",
  DNB:  "NO0010161896",
  MOWI: "NO0003054108",
  TEL:  "NO0010063308",
  YAR:  "NO0010208051",
};

const EURONEXT_BASE = "https://live.euronext.com";

function csvUrl(isin: string, date: string): string {
  return `${EURONEXT_BASE}/en/ajax/AwlIntradayPrice/getFullDownloadAjax/${isin}-XOSL?format=csv&date_form=d/m/Y&full_dl_date=${date}`;
}

// Only real on-exchange continuous trading — filter dark/off-book/auction
function isRealTrade(tradeType: string): boolean {
  const t = tradeType.toLowerCase();
  return !t.includes("dark") && !t.includes("offbook") && !t.includes("off-book") && !t.includes("auction");
}

function parseCsv(csv: string): { tradeId: string; time: string; price: number; shares: number; tradeType: string }[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];
  const trades = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(";").map(p => p.replace(/^"|"$/g, "").trim());
    if (parts.length < 5) continue;
    const [tradeId, time, priceStr, sharesStr, tradeType] = parts;
    const price = parseFloat(priceStr.replace(",", "."));
    const shares = parseInt(sharesStr.replace(/\s/g, ""), 10);
    if (isNaN(price) || isNaN(shares) || shares <= 0) continue;
    if (!isRealTrade(tradeType)) continue;
    trades.push({ tradeId, time, price, shares, tradeType });
  }
  return trades;
}

function classifyAndBuild(trades: ReturnType<typeof parseCsv>, date: string) {
  let lastDir = 0;
  return trades.map((t, i) => {
    const timePart = t.time.includes(" ") ? t.time.split(" ")[1] : t.time;
    const [hStr, mStr, sStr = "0"] = timePart.trim().split(":");
    const ts = `${date}T${hStr.padStart(2,"0")}:${mStr.padStart(2,"0")}:${sStr.padStart(2,"0")}+02:00`;

    let side = 0;
    if (i > 0) {
      const delta = t.price - trades[i - 1].price;
      if (delta > 0) { side = 1; lastDir = 1; }
      else if (delta < 0) { side = -1; lastDir = -1; }
      else { side = lastDir; }
    }

    return { ts, price: t.price, size: t.shares, side };
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const t = ticker.toUpperCase();

  const isin = FLOW_ISINS[t];
  if (!isin) {
    return NextResponse.json({ error: `Ticker ${t} not supported for live feed. Use: ${Object.keys(FLOW_ISINS).join(", ")}` }, { status: 400 });
  }

  // Oslo date (UTC+2) — what Euronext considers "today"
  const nowOslo = new Date(Date.now() + 2 * 3600 * 1000);
  const date = nowOslo.toISOString().slice(0, 10);

  try {
    const res = await fetch(csvUrl(isin, date), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": "https://live.euronext.com/en/product/equities/",
      },
      // Next.js fetch cache: revalidate every 60s (15-min delay anyway)
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Euronext returned ${res.status}` }, { status: 502 });
    }

    const csv = await res.text();
    if (csv.includes("<!DOCTYPE") || csv.includes("No data")) {
      return NextResponse.json({ ticker: t, date, count: 0, lastTradeTime: null, ticks: [] });
    }

    const raw = parseCsv(csv);
    const ticks = classifyAndBuild(raw, date);

    const lastTradeTime = ticks.length > 0 ? ticks[ticks.length - 1].ts : null;
    const totalVol = raw.reduce((s, r) => s + r.shares, 0);
    const vwap = totalVol > 0 ? raw.reduce((s, r) => s + r.price * r.shares, 0) / totalVol : 0;

    return NextResponse.json({
      ticker: t,
      date,
      count: ticks.length,
      lastTradeTime,
      totalVolume: totalVol,
      vwap: Math.round(vwap * 100) / 100,
      ticks,
    });
  } catch (e: any) {
    console.error("[flow/live] Error:", e);
    return NextResponse.json({ error: "Live fetch failed", message: e?.message ?? String(e) }, { status: 500 });
  }
}
