import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@anthropic-ai/sdk'],
  eslint: {
    ignoreDuringBuilds: true,
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
