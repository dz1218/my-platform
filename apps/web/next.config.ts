import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
import path from 'path';

const nextConfig = (phase: string): NextConfig => ({
  reactStrictMode: true,
  // A build must not remove chunks still referenced by the running dev server.
  distDir: process.env.NEXT_BUILD_DIR || (phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next'),
  async rewrites() {
    const api = process.env.COMPANION_API_URL ?? 'http://127.0.0.1:8080';
    return [
      { source: '/ws/conversations/:id', destination: `${api}/api/v1/conversations/:id/socket` },
      { source: '/ws/matches', destination: `${api}/api/v1/matches/socket` },
    ];
  },
  outputFileTracingRoot: path.join(__dirname, '../..'),
});

export default nextConfig;
