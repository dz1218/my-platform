import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: ['companion-memory.spec.ts', 'companion-permissions.spec.ts', 'chat-send.spec.ts'], fullyParallel: false, workers: 1, timeout: 40_000,
  outputDir: 'test-results/companion-memory',
  use: { baseURL: 'http://127.0.0.1:3016', channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', trace: 'retain-on-failure' },
  webServer: [
    { command: 'node tests/fixtures/api.mjs', url: 'http://127.0.0.1:18185/health', env: { FIXTURE_API_PORT: '18185' } },
    { command: 'pnpm exec next dev --hostname 127.0.0.1 --port 3016', url: 'http://127.0.0.1:3016', timeout: 120_000, env: { COMPANION_API_URL: 'http://127.0.0.1:18185', NEXT_BUILD_DIR: '.next-memory-e2e' } },
  ],
});
