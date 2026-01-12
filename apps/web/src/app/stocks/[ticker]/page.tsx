// apps/web/src/app/stocks/[ticker]/page.tsx
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

type Point = {
  date: string;
  close: number;
  price_return: number | null;
  total_return: number | null;
  excess_return_obx: number | null;
  vol_20: number | null;
  vol_63: number | null;
  vol_252: number | null;
  drawdown: number;
  obx_close: number | null;
  obx_price_return: number | null;
};

function fmtPct(x: number | null) {
  if (x == null || !Number.isFinite(x)) return "NA";
  return `${(x * 100).toFixed(2)}%`;
}

function fmtNum(x: number | null, dp = 2) {
  if (x == null || !Number.isFinite(x)) return "NA";
  return x.toFixed(dp);
}

async function getData(ticker: string, limit: number) {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://www.ineqre.no";
  const url = `${base}/api/prices/${encodeURIComponent(ticker)}?limit=${limit}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load prices for ${ticker}`);
  return (await res.json()) as {
    ticker: string;
    series: Point[];
    stats: {
      count: number;
      last_date: string | null;
      last_close: number | null;
      last_vol_20: number | null;
      last_drawdown: number | null;
    };
  };
}

export default async function StockPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<{ limit?: string }>;
}) {
  const { ticker } = await params;
  const sp = await searchParams;
  const limit = Math.min(Number(sp.limit ?? "1500"), 5000);

  const data = await getData(ticker, limit);
  const s = data.series;

  const last = s.at(-1) ?? null;
  const prev = s.length > 1 ? s.at(-2) : null;

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <div className="flex items-baseline gap-4">
        <h1 className="text-4xl font-semibold">Stock {ticker}</h1>
        <Link className="text-sm text-muted-foreground hover:underline" href="/stocks">
          Back to stocks
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Risk and performance parameters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-xs text-muted-foreground">Last close</div>
            <div className="text-xl font-medium">{fmtNum(last?.close ?? null, 2)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">1D total return</div>
            <div className="text-xl font-medium">{fmtPct(last?.total_return ?? null)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Excess return vs OBX</div>
            <div className="text-xl font-medium">{fmtPct(last?.excess_return_obx ?? null)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Drawdown</div>
            <div className="text-xl font-medium">{fmtPct(last?.drawdown ?? null)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Ann vol 20D</div>
            <div className="text-xl font-medium">{fmtPct(last?.vol_20 ?? null)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Ann vol 63D</div>
            <div className="text-xl font-medium">{fmtPct(last?.vol_63 ?? null)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Ann vol 252D</div>
            <div className="text-xl font-medium">{fmtPct(last?.vol_252 ?? null)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Rows</div>
            <div className="text-xl font-medium">{data.stats.count}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Price chart</CardTitle>
        </CardHeader>
        <CardContent style={{ height: 360 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={s} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" hide />
              <YAxis domain={["auto", "auto"]} />
              <Tooltip />
              <Line type="monotone" dataKey="close" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>OBX benchmark chart</CardTitle>
        </CardHeader>
        <CardContent style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={s} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" hide />
              <YAxis domain={["auto", "auto"]} />
              <Tooltip />
              <Line type="monotone" dataKey="obx_close" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
