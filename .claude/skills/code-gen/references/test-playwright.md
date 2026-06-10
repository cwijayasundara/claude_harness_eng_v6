# Playwright Reference — Config and E2E Patterns

For selector and assertion patterns, see the evaluation skill's `playwright-patterns.md`.
This file covers project configuration, browser setup, and E2E structural patterns.

---

## Playwright Config

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html'], ['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'npm run start:test',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

---

## Browser Setup — Test Fixtures

```typescript
// tests/e2e/fixtures.ts
import { test as base } from '@playwright/test';
import { seedTestDatabase, clearTestDatabase } from '../helpers/db';

type TestFixtures = {
  authenticatedPage: Page;
};

export const test = base.extend<TestFixtures>({
  authenticatedPage: async ({ page }, use) => {
    await seedTestDatabase();
    // Log in via API to avoid testing auth UI in every test
    const response = await page.request.post('/api/auth/login', {
      data: { email: 'test@example.com', password: 'TestPass123!' },
    });
    const { token } = await response.json();
    await page.context().addCookies([{ name: 'auth_token', value: token, url: 'http://localhost:3000' }]);
    await use(page);
    await clearTestDatabase();
  },
});

export { expect } from '@playwright/test';
```

---

## E2E Test Structure

```typescript
// tests/e2e/orders/create-order.spec.ts
import { test, expect } from '../fixtures';

test.describe('Create Order', () => {
  test('places an order successfully and shows confirmation', async ({ authenticatedPage: page }) => {
    await page.goto('/orders/new');

    await page.getByLabel('Product').selectOption('Widget Pro');
    await page.getByLabel('Quantity').fill('3');
    await page.getByRole('button', { name: 'Add to Cart' }).click();
    await expect(page.getByRole('status')).toHaveText('Item added');

    await page.getByRole('button', { name: 'Place Order' }).click();
    await expect(page).toHaveURL(/\/orders\/[a-f0-9-]+\/confirmation/);
    await expect(page.getByRole('heading', { name: 'Order Confirmed' })).toBeVisible();
  });

  test('shows validation error when quantity is zero', async ({ authenticatedPage: page }) => {
    await page.goto('/orders/new');
    await page.getByLabel('Quantity').fill('0');
    await page.getByRole('button', { name: 'Add to Cart' }).click();
    await expect(page.getByRole('alert')).toHaveText('Quantity must be at least 1');
  });
});
```

---

## E2E Guidelines

- One `spec.ts` file per user story or feature area.
- Use the `authenticatedPage` fixture for tests that require login.
- Reset database state in fixture teardown — tests must not share state.
- Cover both the happy path and the primary error path for every story.
- Screenshots on failure are automatically captured via `screenshot: 'only-on-failure'`.
- Never use `page.waitForTimeout()` — always use `expect(...).toBeVisible()` with implicit retry.
