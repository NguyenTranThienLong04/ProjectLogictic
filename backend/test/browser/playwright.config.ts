import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '../../..');

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: /phase-(f|g3a|g3c1|g3c2|g3c3|h1|h2|h3)-.*\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 900_000,
  expect: { timeout: 35_000 },
  outputDir: resolve(repositoryRoot, 'test-results/phase-f'),
  reporter: [
    ['list'],
    ['html', { outputFolder: resolve(repositoryRoot, 'playwright-report'), open: 'never' }],
  ],
  use: {
    actionTimeout: 15_000,
    baseURL: 'http://localhost:5173',
    headless: true,
    locale: 'vi-VN',
    navigationTimeout: 30_000,
    timezoneId: 'Asia/Ho_Chi_Minh',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node backend/test/browser/support/osrm-test-server.mjs',
      cwd: repositoryRoot,
      url: 'http://127.0.0.1:5100/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'npm run start:dev --workspace backend',
      cwd: repositoryRoot,
      env: {
        ROUTE_PROVIDER: 'OSRM',
        ROUTE_PROVIDER_BASE_URL: 'http://127.0.0.1:5100',
        PAYMENT_PROVIDER: 'TEST',
        PAYMENT_TEST_WEBHOOK_SECRET: 'phase-h3-browser-test-webhook-secret-32-characters',
      },
      url: 'http://127.0.0.1:3000/api/v1/health/ready',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npm run dev --workspace frontend -- --host 127.0.0.1',
      cwd: repositoryRoot,
      env: { VITE_LOCATION_MODE: 'SIMULATION' },
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
