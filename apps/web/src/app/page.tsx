import { pool } from "@/lib/db";
import HomeContent from "./HomeContent";

export const dynamic = "force-dynamic";

type SystemStats = {
  securities: number;
  last_updated: string | null;
  data_points: number;
};

async function getStats(): Promise<SystemStats> {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(DISTINCT ticker_summary.ticker) as securities,
        MAX(ticker_summary.max_date) as last_updated,
        SUM(ticker_summary.record_count) as data_points
      FROM (
        SELECT p.ticker, MAX(p.date) as max_date, COUNT(*) as record_count
        FROM prices_daily p
        INNER JOIN stocks s ON p.ticker = s.ticker
        WHERE p.close IS NOT NULL AND p.close > 0
        GROUP BY p.ticker
        HAVING COUNT(*) >= 100
      ) ticker_summary
    `);
    return {
      securities: Number(result.rows[0]?.securities || 0),
      last_updated: result.rows[0]?.last_updated ?? null,
      data_points: Number(result.rows[0]?.data_points || 0),
    };
  } catch {
    return { securities: 0, last_updated: null, data_points: 0 };
  }
}

export default async function Page() {
  const stats = await getStats();
  return <HomeContent stats={stats} />;
}
