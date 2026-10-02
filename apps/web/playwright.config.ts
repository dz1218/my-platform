import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:3012',
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: 'retain-on-failure',
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  },
  webServer: [
    { command: 'node tests/fixtures/api.mjs', url: 'http://127.0.0.1:18181/health' },
    {
      command: 'pnpm exec next dev --hostname 127.0.0.1 --port 3012',
      url: 'http://127.0.0.1:3012/live',
      timeout: 120_000,
      env: { COMPANION_API_URL: 'http://127.0.0.1:18181', NEXT_BUILD_DIR: '.next-live-e2e' },
    },
  ],
});
