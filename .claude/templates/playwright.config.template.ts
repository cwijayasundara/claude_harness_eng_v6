import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 30_000,
  reporter: 'html',
  use: {
    baseURL: '{{UI_BASE_URL}}',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'docker compose up -d --build',
    // Wait for the UI server (not the API) since baseURL points to UI_BASE_URL.
    // The API health check is handled by the evaluator agent separately.
    url: '{{UI_BASE_URL}}',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
