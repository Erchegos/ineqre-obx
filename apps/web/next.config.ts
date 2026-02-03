import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['pg'],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
