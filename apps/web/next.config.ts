import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@anthropic-ai/sdk'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [
      // Prices & price-derived analytics — 30 min (updates intraday)
      {
        source: '/api/prices/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=1800, stale-while-revalidate=300' }],
      },
      {
        source: '/api/analytics/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=1800, stale-while-revalidate=300' }],
      },
      {
        source: '/api/stocks',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=1800, stale-while-revalidate=300' }],
      },
      // News & intelligence — 30 min
      {
        source: '/api/news/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=1800, stale-while-revalidate=300' }],
      },
      {
        source: '/api/news',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=1800, stale-while-revalidate=300' }],
      },
      {
        source: '/api/shorts/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=1800, stale-while-revalidate=300' }],
      },
      {
        source: '/api/shorts',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=1800, stale-while-revalidate=300' }],
      },
      {
        source: '/api/intelligence/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=1800, stale-while-revalidate=300' }],
      },
      // Daily data — 2 hours (seafood, shipping, factors, volatility, options, commodities, FX)
      {
        source: '/api/seafood/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=7200, stale-while-revalidate=600' }],
      },
      {
        source: '/api/shipping/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=7200, stale-while-revalidate=600' }],
      },
      {
        source: '/api/factors/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=7200, stale-while-revalidate=600' }],
      },
      {
        source: '/api/volatility/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=7200, stale-while-revalidate=600' }],
      },
      {
        source: '/api/options/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=7200, stale-while-revalidate=600' }],
      },
      {
        source: '/api/options',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=7200, stale-while-revalidate=600' }],
      },
      {
        source: '/api/commodities/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=7200, stale-while-revalidate=600' }],
      },
      {
        source: '/api/commodities',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=7200, stale-while-revalidate=600' }],
      },
      {
        source: '/api/fx-pairs',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=7200, stale-while-revalidate=600' }],
      },
      {
        source: '/api/fx-hedging/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=7200, stale-while-revalidate=600' }],
      },
      {
        source: '/api/fundamentals/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=7200, stale-while-revalidate=600' }],
      },
      {
        source: '/api/equities/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=7200, stale-while-revalidate=600' }],
      },
      {
        source: '/api/liquidity/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=7200, stale-while-revalidate=600' }],
      },
      // Slow-changing data — 6 hours (predictions, backtests, correlation, residuals, std-channel)
      {
        source: '/api/predictions/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=21600, stale-while-revalidate=1800' }],
      },
      {
        source: '/api/backtest/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=21600, stale-while-revalidate=1800' }],
      },
      {
        source: '/api/backtest',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=21600, stale-while-revalidate=1800' }],
      },
      {
        source: '/api/correlation',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=21600, stale-while-revalidate=1800' }],
      },
      {
        source: '/api/residuals/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=21600, stale-while-revalidate=1800' }],
      },
      {
        source: '/api/std-channel/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=21600, stale-while-revalidate=1800' }],
      },
      {
        source: '/api/std-channel-optimize/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=21600, stale-while-revalidate=1800' }],
      },
      {
        source: '/api/std-channel-strategy',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=21600, stale-while-revalidate=1800' }],
      },
      {
        source: '/api/optimizer-config/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=21600, stale-while-revalidate=1800' }],
      },
      // No cache: auth, portfolio mutations, health checks, research (auth-gated)
    ];
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // pg is in Next.js's built-in server-external-packages.json,
      // causing it to be externalized. On Vercel Node 24, the externalized
      // ESM import fails resolution. Force webpack to bundle pg instead.
      if (Array.isArray(config.externals)) {
        const nextExternals = config.externals;
        config.externals = nextExternals.map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (external: any) => {
            if (typeof external !== 'function') return external;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return async (ctx: any) => {
              if (ctx.request === 'pg' || ctx.request?.startsWith('pg/')) {
                return undefined; // Bundle instead of externalizing
              }
              return external(ctx);
            };
          }
        );
      }
      // pg-native is an optional dependency that doesn't exist
      config.resolve = config.resolve || {};
      config.resolve.alias = {
        ...config.resolve.alias,
        'pg-native': false,
      };
    }
    return config;
  },
};

export default nextConfig;
