import { defineConfig } from '@playwright/test';
import base from './playwright.production.config';

export default defineConfig({
  ...base,
  testMatch: ['companion-greeting.spec.ts'],
  grep: /keyboard entry|inherited identity guard/,
  outputDir: 'test-results/chat-entry-final',
  reporter: [['list'], ['json', { outputFile: 'test-results/chat-entry-final/report.json' }]],
  webServer: [
    { command: 'node tests/fixtures/api.mjs', url: 'http://127.0.0.1:18181/health' },
    { command: 'pnpm exec next start --hostname 127.0.0.1 --port 3013',
      url: 'http://127.0.0.1:3013/companion', timeout: 240_000,
      env: { COMPANION_API_URL: 'http://127.0.0.1:18181', NEXT_BUILD_DIR: '.next-chat-entry-production' } },
  ],
});
