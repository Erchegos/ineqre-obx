import Link from 'next/link';

type PriceRow = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
};

type PricesResponse = {
  ticker: string;
  count: number;
  rows: PriceRow[];
};

async function getPrices(ticker: string): Promise<PricesResponse> {
  const res = await fetch(
    `http://localhost:3000/api/prices/${encodeURIComponent(ticker)}`,
    { cache: 'no-store' }
  );

  if (!res.ok) {
    throw new Error(`Failed to load prices for ${ticker}: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

export default async function TickerPage(
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;

  const { count, rows } = await getPrices(ticker);

  return (
    <main
      style={{
        padding: 24,
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <Link href="/stocks" style={{ textDecoration: 'none', opacity: 0.8 }}>
          Back to stocks
        </Link>

        <h1 style={{ margin: '10px 0 0', fontSize: 28, fontWeight: 700 }}>
          {ticker}
        </h1>

        <p style={{ margin: '6px 0 0', opacity: 0.75 }}>
          Daily rows: {count}
        </p>
      </div>

      <div style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.06)', textAlign: 'left' }}>
              <th style={{ padding: '12px 14px' }}>Date</th>
              <th style={{ padding: '12px 14px' }}>Open</th>
              <th style={{ padding: '12px 14px' }}>High</th>
              <th style={{ padding: '12px 14px' }}>Low</th>
              <th style={{ padding: '12px 14px' }}>Close</th>
              <th style={{ padding: '12px 14px' }}>Volume</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date} style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <td style={{ padding: '12px 14px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                  {r.date}
                </td>
                <td style={{ padding: '12px 14px' }}>{r.open ?? ''}</td>
                <td style={{ padding: '12px 14px' }}>{r.high ?? ''}</td>
                <td style={{ padding: '12px 14px' }}>{r.low ?? ''}</td>
                <td style={{ padding: '12px 14px' }}>{r.close ?? ''}</td>
                <td style={{ padding: '12px 14px' }}>{r.volume ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
