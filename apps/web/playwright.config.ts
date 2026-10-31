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
    ...(process.env.LIVEKIT_INTEGRATION === '1' ? [{
      command: 'go run ./tests/livevoice', cwd: '../server', url: 'http://127.0.0.1:18182/health', timeout: 120_000,
      env: { GOCACHE: process.env.GOCACHE || '/tmp/my-platform-go-cache' },
    }] : []),
    ...(process.env.ROOM_ASSISTANT_INTEGRATION === '1' ? [
      { command: 'node --import tsx src/tests/fixtures/room-model.ts', cwd: '../agent', url: 'http://127.0.0.1:18183/health' },
      { command: 'node --import tsx src/room-main.ts dev', cwd: '../agent', url: 'http://127.0.0.1:18184/', timeout: 120_000,
        env: { LIVEKIT_URL: process.env.LIVEKIT_TEST_URL || 'ws://127.0.0.1:7880', LIVEKIT_INTERNAL_URL: process.env.LIVEKIT_TEST_URL || 'ws://127.0.0.1:7880', LIVEKIT_API_KEY: process.env.LIVEKIT_TEST_API_KEY || 'devkey', LIVEKIT_API_SECRET: process.env.LIVEKIT_TEST_API_SECRET || 'devsecretdevsecretdevsecretdevsec', LIVEKIT_AGENT_NAME: 'room-assistant-e2e', ROOM_AGENT_PORT: '18184', ROOM_API_URL: 'http://127.0.0.1:18182', LLM_BASE_URL: 'http://127.0.0.1:18183/v1', LLM_API_KEY: 'local-fixture', LLM_MODEL: 'room-fixture' },
      },
    ] : []),
    { command: 'node tests/fixtures/api.mjs', url: 'http://127.0.0.1:18181/health' },
    {
      command: 'pnpm exec next dev --hostname 127.0.0.1 --port 3012',
      url: 'http://127.0.0.1:3012/',
      timeout: 120_000,
      env: { COMPANION_API_URL: 'http://127.0.0.1:18181', NEXT_BUILD_DIR: '.next-live-e2e' },
    },
  ],
});
