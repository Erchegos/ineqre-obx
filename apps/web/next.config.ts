import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@anthropic-ai/sdk'],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
