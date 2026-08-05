import { defineConfig, devices } from '@playwright/test';

// Post-deploy E2E configuration.
//
// The sibling playwright.config.ts is the BUILD-LOOP config: it starts the app
// itself (`webServer: docker compose up`) and points at localhost. This one is
// its opposite and the differences are deliberate:
//
//   - No `webServer`. The environment already exists. Starting a local stack
//     here would silently test localhost while the report says "staging".
//   - `baseURL` comes from the environment at run time, never from a committed
//     value, so the same suite runs against any approved target.
//   - Nothing resets state between runs. Tests provision and clean up their own
//     data (see references/e2e-deployed.md) and must be safe to run repeatedly,
//     in parallel, against an environment that holds other people's data.
//
// The target is validated by .claude/scripts/e2e-target-guard.js before the
// suite runs — see the guard step in .github/workflows/e2e-deployed.yml, which
// runs before the browsers are installed so a misconfigured run costs seconds.

const baseURL = process.env.E2E_BASE_URL;

if (!baseURL) {
  throw new Error(
    'E2E_BASE_URL is not set. A post-deploy run must be given an explicit target; '
    + 'refusing to fall back to localhost, which would report a false green.',
  );
}

export default defineConfig({
  testDir: './e2e',
  // Shared environment: no fixture reset, so a test that leaks state breaks its
  // neighbours. Parallelism stays on because tests are self-provisioning, but
  // `@serial`-tagged specs opt out via test.describe.serial().
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // A deployed target adds real network latency, cold starts and eventual
  // consistency. Retries absorb that; they do not absorb a real defect, because
  // a test that only passes on retry is reported as flaky below.
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 4 : undefined,
  // Generous vs the build loop's 30s: cold lambdas and queue drains are normal here.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
    // Machine-readable result so the harness can gate on it rather than on a
    // human reading the HTML report.
    ['json', { outputFile: 'test-results/e2e-deployed-results.json' }],
    ...(process.env.CI ? [['github'] as const] : []),
  ],
  use: {
    baseURL,
    // Evidence a human can cheaply re-check (gap G40). Against a deployed
    // environment this is the only forensic record — there is no local stack to
    // re-run the failure on.
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ignoreHTTPSErrors: false,
    extraHTTPHeaders: {
      // Lets the environment's logs and any rate limiter distinguish synthetic
      // traffic from real users. Also the hook most test-data cleanup jobs use.
      'X-E2E-Run': process.env.E2E_RUN_ID || 'local',
    },
  },
  outputDir: './test-results',
  projects: [
    // Authenticates once and saves storage state; every other project reuses it
    // rather than logging in per test against a real identity provider.
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'smoke',
      // The subset that must pass before the deploy is considered good.
      grep: /@smoke/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: '.auth/user.json' },
    },
    {
      name: 'full',
      // Everything except tests that need fixture control the environment
      // cannot give them. Those stay in the build-loop suite.
      grepInvert: /@needs-fixture/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: '.auth/user.json' },
    },
  ],
});
