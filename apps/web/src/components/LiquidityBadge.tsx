/**
 * Liquidity Badge Component
 *
 * Displays liquidity regime classification for a stock.
 * Shows traders whether the stock is actually tradeable.
 */

'use client';

import { useEffect, useState } from 'react';

interface LiquidityData {
  regime: 'Highly Liquid' | 'Liquid' | 'Moderate' | 'Illiquid' | 'Very Illiquid';
  avgDailyValue: number;
  avgDailyVolume: number;
  recentTrend: 'Improving' | 'Stable' | 'Deteriorating';
  warnings: string[];
  tradingImplications: string[];
}

interface LiquidityBadgeProps {
  ticker: string;
  expanded?: boolean;
}

export function LiquidityBadge({ ticker, expanded = false }: LiquidityBadgeProps) {
  const [data, setData] = useState<LiquidityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchLiquidity() {
      try {
        const res = await fetch(`/api/liquidity/${ticker}`);
        if (!res.ok) {
          throw new Error('Failed to fetch liquidity data');
        }
        const json = await res.json();
        setData(json.liquidity);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchLiquidity();
  }, [ticker]);

  if (loading) {
    return (
      <div style={{ fontSize: 12, color: '#888' }}>
        Loading liquidity...
      </div>
    );
  }

  if (error || !data) {
    return null;
  }

  const colors = {
    'Highly Liquid': '#10b981',
    'Liquid': '#22c55e',
    'Moderate': '#f59e0b',
    'Illiquid': '#ef4444',
    'Very Illiquid': '#991b1b',
  };

  const indicators = {
    'Highly Liquid': '●●●',
    'Liquid': '●●○',
    'Moderate': '●○○',
    'Illiquid': '▲',
    'Very Illiquid': '⚠',
  };

  const color = colors[data.regime];
  const indicator = indicators[data.regime];

  const valueInMillions = (data.avgDailyValue / 1_000_000).toFixed(1);
  const volumeFormatted = data.avgDailyVolume >= 1_000_000
    ? `${(data.avgDailyVolume / 1_000_000).toFixed(1)}M`
    : `${(data.avgDailyVolume / 1_000).toFixed(0)}K`;

  if (!expanded) {
    // Compact badge
    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          backgroundColor: 'rgba(0,0,0,0.3)',
          border: `1px solid ${color}`,
          borderRadius: 4,
          fontSize: 12,
        }}
      >
        <span style={{ color }}>{indicator}</span>
        <span style={{ color: '#fff', fontWeight: 500 }}>{data.regime}</span>
      </div>
    );
  }

  // Expanded view with details
  return (
    <div
      style={{
        backgroundColor: 'rgba(0,0,0,0.3)',
        border: `1px solid ${color}`,
        borderRadius: 8,
        padding: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ color, fontSize: 18 }}>{indicator}</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>
            {data.regime}
          </div>
          <div style={{ fontSize: 11, color: '#888' }}>
            Liquidity Classification
          </div>
        </div>
      </div>

      <div style={{ fontSize: 12, color: '#ddd', marginBottom: 12 }}>
        <div style={{ marginBottom: 4 }}>
          Avg Daily Volume: <span style={{ fontFamily: 'monospace', color: '#fff' }}>{volumeFormatted}</span> shares
        </div>
        <div style={{ marginBottom: 4 }}>
          Avg Daily Value: <span style={{ fontFamily: 'monospace', color: '#fff' }}>{valueInMillions}M NOK</span>
        </div>
        <div>
          Recent Trend: <span style={{
            color: data.recentTrend === 'Improving' ? '#10b981' :
                  data.recentTrend === 'Deteriorating' ? '#ef4444' : '#888'
          }}>
            {data.recentTrend}
          </span>
        </div>
      </div>

      {data.tradingImplications.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 6 }}>
            TRADING IMPLICATIONS
          </div>
          {data.tradingImplications.map((implication, idx) => (
            <div key={idx} style={{ fontSize: 11, color: '#bbb', marginBottom: 2 }}>
              • {implication}
            </div>
          ))}
        </div>
      )}

      {data.warnings.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#f59e0b', marginBottom: 6 }}>
            WARNINGS
          </div>
          {data.warnings.map((warning, idx) => (
            <div key={idx} style={{ fontSize: 11, color: '#f59e0b', marginBottom: 2 }}>
              ⚠ {warning}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
