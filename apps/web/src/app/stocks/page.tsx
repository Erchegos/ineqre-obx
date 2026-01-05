import Link from 'next/link';

type Stock = {
  ticker: string;
  name: string;
  sector: string | null;
  exchange: string | null;
  currency: string | null;
  is_active: boolean | null;
};

type StocksResponse = {
  count: number;
  stocks: Stock[];
};

async function getStocks(): Promise<StocksResponse> {
  const res = await fetch('http://localhost:3000/api/stocks', {
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`Failed to load stocks: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

export default async function StocksPage() {
  const { count, stocks } = await getStocks();

  return (
    <main
      style={{
        padding: 24,
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>Stocks</h1>
        <p style={{ margin: '6px 0 0', opacity: 0.75 }}>Universe coverage: {count}</p>
      </div>

      <div style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.06)', textAlign: 'left' }}>
              <th style={{ padding: '12px 14px' }}>Ticker</th>
              <th style={{ padding: '12px 14px' }}>Name</th>
              <th style={{ padding: '12px 14px' }}>Sector</th>
              <th style={{ padding: '12px 14px' }}>Exchange</th>
              <th style={{ padding: '12px 14px' }}>Currency</th>
              <th style={{ padding: '12px 14px' }}>Active</th>
            </tr>
          </thead>
          <tbody>
            {stocks.map((s) => (
              <tr key={s.ticker} style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <td style={{ padding: '12px 14px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                  <Link href={`/stocks/${encodeURIComponent(s.ticker)}`} style={{ textDecoration: 'none' }}>
                    {s.ticker}
                  </Link>
                </td>
                <td style={{ padding: '12px 14px' }}>{s.name}</td>
                <td style={{ padding: '12px 14px' }}>{s.sector ?? ''}</td>
                <td style={{ padding: '12px 14px' }}>{s.exchange ?? ''}</td>
                <td style={{ padding: '12px 14px' }}>{s.currency ?? ''}</td>
                <td style={{ padding: '12px 14px' }}>{s.is_active ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
