import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['pg', '@anthropic-ai/sdk'],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
