import Link from "next/link";
import { pool } from "@/lib/db";
import { getPriceTable } from "@/lib/price-data-adapter";

export const dynamic = "force-dynamic";

type StockData = {
  ticker: string;
  name: string;
  last_close: number;
  start_date: string;
  end_date: string;
  rows: number;
};

async function getStocksData(): Promise<StockData[]> {
  const tableName = await getPriceTable();

  const query = `
    SELECT 
      s.ticker,
      s.name,
      MAX(p.close) as last_close,
      MIN(p.date) as start_date,
      MAX(p.date) as end_date,
      COUNT(*) as rows
    FROM stocks s
    INNER JOIN ${tableName} p ON s.ticker = p.ticker
    WHERE p.source = 'ibkr'
      AND p.close IS NOT NULL
      AND p.close > 0
    GROUP BY s.ticker, s.name
    HAVING COUNT(*) >= 1000
      AND MAX(p.date) >= CURRENT_DATE - INTERVAL '30 days'
    ORDER BY s.ticker
  `;

  const result = await pool.query(query);

  return result.rows.map((row) => ({
    ticker: row.ticker,
    name: row.name || row.ticker,
    last_close: Number(row.last_close),
    start_date: row.start_date instanceof Date 
      ? row.start_date.toISOString().slice(0, 10)
      : String(row.start_date),
    end_date: row.end_date instanceof Date
      ? row.end_date.toISOString().slice(0, 10)
      : String(row.end_date),
    rows: Number(row.rows),
  }));
}

export default async function StocksPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; order?: string }>;
}) {
  const params = await searchParams;
  const sortBy = params.sort || "ticker";
  const sortOrder = params.order || "asc";

  let stocks = await getStocksData();

  // Client-side sorting
  stocks.sort((a, b) => {
    let aVal: any = a[sortBy as keyof StockData];
    let bVal: any = b[sortBy as keyof StockData];

    // Handle string vs number comparison
    if (typeof aVal === "string") {
      aVal = aVal.toLowerCase();
      bVal = (bVal as string).toLowerCase();
    }

    if (sortOrder === "asc") {
      return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
    } else {
      return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
    }
  });

  const toggleSort = (column: string) => {
    const newOrder =
      sortBy === column && sortOrder === "asc" ? "desc" : "asc";
    return `?sort=${column}&order=${newOrder}`;
  };

  const SortIcon = ({ column }: { column: string }) => {
    if (sortBy !== column) return <span className="opacity-40">↕</span>;
    return sortOrder === "asc" ? <span>↑</span> : <span>↓</span>;
  };

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold mb-2">Stocks</h1>
        <p className="text-gray-400 mb-8">
          Universe: {stocks.length} tickers
          <span className="ml-4 text-sm">Source: Interactive Brokers</span>
        </p>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left py-4 px-4">
                  <Link
                    href={toggleSort("ticker")}
                    className="hover:text-blue-400 flex items-center gap-2"
                  >
                    Ticker <SortIcon column="ticker" />
                  </Link>
                </th>
                <th className="text-left py-4 px-4">
                  <Link
                    href={toggleSort("name")}
                    className="hover:text-blue-400 flex items-center gap-2"
                  >
                    Name <SortIcon column="name" />
                  </Link>
                </th>
                <th className="text-right py-4 px-4">
                  <Link
                    href={toggleSort("last_close")}
                    className="hover:text-blue-400 flex items-center justify-end gap-2"
                  >
                    Last Close <SortIcon column="last_close" />
                  </Link>
                </th>
                <th className="text-right py-4 px-4">
                  <Link
                    href={toggleSort("start_date")}
                    className="hover:text-blue-400 flex items-center justify-end gap-2"
                  >
                    Start Date <SortIcon column="start_date" />
                  </Link>
                </th>
                <th className="text-right py-4 px-4">
                  <Link
                    href={toggleSort("end_date")}
                    className="hover:text-blue-400 flex items-center justify-end gap-2"
                  >
                    End Date <SortIcon column="end_date" />
                  </Link>
                </th>
                <th className="text-right py-4 px-4">
                  <Link
                    href={toggleSort("rows")}
                    className="hover:text-blue-400 flex items-center justify-end gap-2"
                  >
                    Rows <SortIcon column="rows" />
                  </Link>
                </th>
              </tr>
            </thead>
            <tbody>
              {stocks.map((stock) => (
                <tr
                  key={stock.ticker}
                  className="border-b border-gray-900 hover:bg-gray-900"
                >
                  <td className="py-4 px-4">
                    <Link
                      href={`/stocks/${stock.ticker}`}
                      className="text-blue-400 hover:text-blue-300 font-medium"
                    >
                      {stock.ticker}
                    </Link>
                  </td>
                  <td className="py-4 px-4 text-gray-300">
                    {stock.name}
                  </td>
                  <td className="py-4 px-4 text-right font-mono">
                    {stock.last_close.toFixed(2)}
                  </td>
                  <td className="py-4 px-4 text-right text-gray-400">
                    {stock.start_date}
                  </td>
                  <td className="py-4 px-4 text-right text-gray-400">
                    {stock.end_date}
                  </td>
                  <td className="py-4 px-4 text-right text-gray-400">
                    {stock.rows.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {stocks.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            No stocks found with sufficient IBKR data
          </div>
        )}
      </div>
    </div>
  );
}