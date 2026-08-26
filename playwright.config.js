import { defineConfig } from '@playwright/test';

const webPort = Number(process.env.ATOLL_TEST_WEB_PORT || 5173);
const mockPort = Number(process.env.ATOLL_TEST_MOCK_PORT || 8832);
const baseURL = `http://127.0.0.1:${webPort}`;
const mockURL = `http://127.0.0.1:${mockPort}`;

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: `ATOLL_MOCK_PORT=${mockPort} ATOLL_MOCK_SCENARIO=multi-channel ATOLL_MOCK_LIVE_INTERVAL_MS=0 npm run mock`,
      url: `${mockURL}/healthz`,
      reuseExistingServer: true,
      timeout: 15_000,
    },
    {
      command: `ATOLL_SERVER_URL=${mockURL} npm run dev -- --host 127.0.0.1 --port ${webPort} --strictPort`,
      url: baseURL,
      reuseExistingServer: true,
      timeout: 15_000,
    },
  ],
});
