import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: ['navigation-loading.spec.ts', 'performance-resources.spec.ts', 'tab-scroll.spec.ts', 'companion-requests.spec.ts'],
  outputDir: 'test-results/production',
  reporter: [['list'], ['json', { outputFile: 'test-results/production/report.json' }]],
  use: { ...base.use, baseURL: 'http://127.0.0.1:3013' },
  webServer: [
    { command: 'node tests/fixtures/api.mjs', url: 'http://127.0.0.1:18181/health' },
    {
      command: 'pnpm exec next build && pnpm exec next start --hostname 127.0.0.1 --port 3013',
      url: 'http://127.0.0.1:3013/companion', timeout: 240_000,
      env: { COMPANION_API_URL: 'http://127.0.0.1:18181', NEXT_BUILD_DIR: '.next-production-e2e' },
    },
  ],
});
