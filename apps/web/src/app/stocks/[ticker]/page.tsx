export const dynamic = "force-dynamic";

type EquityRow = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  vwap: number | null;
  turnover: number | null;
  numberOfTrades: number | null;
  numberOfShares: number | null;
  ticker: string;
  source: string | null;
};

type EquityResponse =
  | {
      ticker: string;
      count: number;
      rows: EquityRow[];
      source: string;
    }
  | {
      error: string;
      pg?: any;
      schema?: any;
    };

function baseUrl() {
  const env =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.VERCEL_URL ||
    "localhost:3000";
  if (env.startsWith("http")) return env;
  return `https://${env}`;
}

export default async function StockPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;

  const base = baseUrl();
  const url = `${base}/api/equities/${encodeURIComponent(ticker)}?limit=1500`;

  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return (
      <main style={{ padding: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>Stock {ticker}</h1>
        <p style={{ marginTop: 12 }}>
          Upstream failure from <code>{url}</code>
        </p>
        <pre
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 12,
            background: "rgba(255,255,255,0.06)",
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {JSON.stringify(
            { status: res.status, statusText: res.statusText, body },
            null,
            2
          )}
        </pre>
      </main>
    );
  }

  const data = (await res.json()) as EquityResponse;

  if ("error" in data) {
    return (
      <main style={{ padding: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>Stock {ticker}</h1>
        <pre
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 12,
            background: "rgba(255,255,255,0.06)",
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {JSON.stringify(data, null, 2)}
        </pre>
      </main>
    );
  }

  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>{data.ticker}</h1>
      <p style={{ marginTop: 8 }}>
        Source: {data.source} | Rows: {data.count}
      </p>

      <pre
        style={{
          marginTop: 12,
          padding: 12,
          borderRadius: 12,
          background: "rgba(255,255,255,0.06)",
          overflowX: "auto",
        }}
      >
        {JSON.stringify(data.rows.slice(0, 5), null, 2)}
      </pre>
    </main>
  );
}
