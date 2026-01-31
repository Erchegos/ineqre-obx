/**
 * Data Freshness Indicator Component
 *
 * Displays data staleness status to users.
 * Prevents "this data is 5 days old" embarrassment during Oslo Børs demos.
 */

'use client';

import { useEffect, useState } from 'react';

interface HealthData {
  status: 'healthy' | 'degraded' | 'unhealthy';
  data: {
    latestPriceData: {
      date: string;
      age: number;
      status: 'fresh' | 'stale' | 'critical';
    };
  };
  warnings: string[];
}

export function DataFreshnessIndicator() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkHealth() {
      try {
        const res = await fetch('/api/health');
        if (res.ok) {
          const data = await res.json();
          setHealth(data);
        }
      } catch (error) {
        console.error('Failed to fetch health status:', error);
      } finally {
        setLoading(false);
      }
    }

    checkHealth();
    // Refresh every 5 minutes
    const interval = setInterval(checkHealth, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (loading || !health) {
    return null;
  }

  const { data, warnings } = health;
  const { age, status, date } = data.latestPriceData;

  // Don't show if data is fresh and no warnings
  if (status === 'fresh' && warnings.length === 0) {
    return null;
  }

  const statusColors = {
    fresh: '#10b981', // green
    stale: '#f59e0b', // amber
    critical: '#ef4444', // red
  };

  const statusLabels = {
    fresh: 'Data is current',
    stale: 'Data may be outdated',
    critical: 'Data is stale',
  };

  const ageText =
    age === 0 ? 'Today' : age === 1 ? '1 day ago' : `${age} days ago`;

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        border: `1px solid ${statusColors[status]}`,
        borderRadius: 8,
        padding: '12px 16px',
        maxWidth: 320,
        zIndex: 1000,
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: statusColors[status],
          }}
        />
        <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>
          {statusLabels[status]}
        </div>
      </div>

      <div style={{ fontSize: 12, color: '#a0a0a0', marginLeft: 16 }}>
        Latest data: {date} ({ageText})
      </div>

      {warnings.length > 0 && (
        <div style={{ marginTop: 8, marginLeft: 16, fontSize: 11, color: '#d0d0d0' }}>
          {warnings.map((warning, idx) => (
            <div key={idx} style={{ marginTop: 2 }}>
              • {warning}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
