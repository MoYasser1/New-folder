import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 2,
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'node server-dist/index.js',
      url: 'http://127.0.0.1:3101/health/ready',
      env: { API_PORT: '3101', WEB_ORIGIN: 'http://localhost:3100' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run dev:web -- --host 127.0.0.1 --port 3100 --strictPort',
      url: 'http://127.0.0.1:3100',
      env: { VITE_API_URL: 'http://localhost:3101' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
