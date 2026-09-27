import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep validation builds isolated from a running development server.
  distDir: process.env.NEXT_BUILD_DIR || ".next",
  async rewrites() {
    return [{ source: '/ws/conversations/:id', destination: `${process.env.COMPANION_API_URL ?? 'http://127.0.0.1:8080'}/api/v1/conversations/:id/socket` }];
  },
  outputFileTracingRoot: path.join(__dirname, '../..'),
};

export default nextConfig;
