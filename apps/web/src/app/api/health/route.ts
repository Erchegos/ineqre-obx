/**
 * Health Check and Data Staleness Monitor
 * GET /api/health
 *
 * Returns system health status and data freshness metrics.
 * CRITICAL for operational credibility - prevents "this data is 5 days old" embarrassment.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { secureJsonResponse, safeErrorResponse } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  data: {
    latestPriceData: {
      date: string;
      age: number; // days
      status: 'fresh' | 'stale' | 'critical';
    };
    totalTickers: number;
    tickersWithRecentData: number;
    tickersWithStaleData: number;
  };
  database: {
    connected: boolean;
    responseTime: number; // ms
  };
  warnings: string[];
}

/**
 * Get data staleness status based on age
 */
function getDataStatus(ageDays: number): 'fresh' | 'stale' | 'critical' {
  if (ageDays <= 1) return 'fresh';
  if (ageDays <= 3) return 'stale';
  return 'critical';
}

export async function GET(req: NextRequest) {
  const startTime = Date.now();
  const warnings: string[] = [];

  try {
    // Check database connectivity
    const dbCheckStart = Date.now();
    const dbCheck = await pool.query('SELECT NOW() as server_time');
    const dbResponseTime = Date.now() - dbCheckStart;

    if (!dbCheck.rows[0]) {
      throw new Error('Database health check failed');
    }

    // Get latest price data date
    const latestDataQuery = await pool.query(`
      SELECT MAX(date) as latest_date
      FROM prices_daily
    `);

    const latestDate = latestDataQuery.rows[0]?.latest_date;

    if (!latestDate) {
      warnings.push('No price data found in database');
      return secureJsonResponse({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        data: {
          latestPriceData: {
            date: 'N/A',
            age: -1,
            status: 'critical',
          },
          totalTickers: 0,
          tickersWithRecentData: 0,
          tickersWithStaleData: 0,
        },
        database: {
          connected: true,
          responseTime: dbResponseTime,
        },
        warnings: ['No price data found'],
      });
    }

    // Calculate age of latest data
    const latestDateObj = new Date(latestDate);
    const now = new Date();
    const ageDays = Math.floor(
      (now.getTime() - latestDateObj.getTime()) / (1000 * 60 * 60 * 24)
    );

    const dataStatus = getDataStatus(ageDays);

    // Get ticker-level freshness stats
    const freshnessStats = await pool.query(`
      SELECT
        COUNT(DISTINCT ticker) as total_tickers,
        COUNT(DISTINCT CASE WHEN age_days <= 1 THEN ticker END) as fresh_tickers,
        COUNT(DISTINCT CASE WHEN age_days > 3 THEN ticker END) as stale_tickers
      FROM (
        SELECT
          ticker,
          EXTRACT(DAY FROM NOW() - MAX(date))::integer as age_days
        FROM prices_daily
        GROUP BY ticker
      ) ticker_ages
    `);

    const stats = freshnessStats.rows[0];
    const totalTickers = parseInt(stats.total_tickers || '0');
    const freshTickers = parseInt(stats.fresh_tickers || '0');
    const staleTickers = parseInt(stats.stale_tickers || '0');

    // Generate warnings
    if (ageDays > 3) {
      warnings.push(`Latest price data is ${ageDays} days old - CRITICAL`);
    } else if (ageDays > 1) {
      warnings.push(`Latest price data is ${ageDays} days old - consider updating`);
    }

    if (staleTickers > 0) {
      warnings.push(`${staleTickers}/${totalTickers} tickers have stale data (>3 days old)`);
    }

    // Determine overall health status
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
    if (dataStatus === 'critical' || staleTickers > totalTickers * 0.5) {
      overallStatus = 'unhealthy';
    } else if (dataStatus === 'stale' || staleTickers > totalTickers * 0.2) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'healthy';
    }

    const response: HealthStatus = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      data: {
        latestPriceData: {
          date: latestDateObj.toISOString().split('T')[0],
          age: ageDays,
          status: dataStatus,
        },
        totalTickers,
        tickersWithRecentData: freshTickers,
        tickersWithStaleData: staleTickers,
      },
      database: {
        connected: true,
        responseTime: dbResponseTime,
      },
      warnings,
    };

    return secureJsonResponse(response);
  } catch (error) {
    return safeErrorResponse(error, 'Health check failed');
  }
}
