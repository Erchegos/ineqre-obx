import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['pg', 'bcrypt', '@anthropic-ai/sdk'],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
