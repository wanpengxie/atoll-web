import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:15173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: [
    {
      command: 'ATOLL_MOCK_PORT=18832 ATOLL_MOCK_SCENARIO=multi-channel ATOLL_MOCK_LIVE_INTERVAL_MS=0 npm run mock',
      url: 'http://127.0.0.1:18832/healthz',
      reuseExistingServer: false,
      timeout: 15_000,
    },
    {
      command: 'ATOLL_SERVER_URL=http://127.0.0.1:18832 npm run dev -- --host 127.0.0.1 --port 15173',
      url: 'http://127.0.0.1:15173',
      reuseExistingServer: false,
      timeout: 15_000,
    },
  ],
});
