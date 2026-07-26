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
    // Runtime evidence artifacts (gap G40). A verdict a human cannot cheaply
    // re-check gets rubber-stamped, so a failing run must leave something
    // watchable behind. `retain-on-failure` rather than `on-first-retry`
    // deliberately: retries are 0 locally, so on-first-retry captures nothing
    // on the very runs an engineer is debugging.
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Artifacts land here; the evaluator cites the paths in its failure report and
  // the quality card links them. Keep it gitignored.
  outputDir: './test-results',
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
