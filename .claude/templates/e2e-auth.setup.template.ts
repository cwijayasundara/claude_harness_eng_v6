import { test as setup, expect } from '@playwright/test';

// Authentication for the post-deploy suite.
//
// Runs once as the `setup` project; every other project reuses the saved
// storage state. Against a real identity provider, logging in per test is slow,
// rate-limited, and the most common source of "flaky E2E".
//
// This is the ONLY file that reads credentials. Adapt the middle section to
// your provider (form login, OIDC, magic link, service-account token exchange);
// the surrounding contract — read secrets from env, write .auth/user.json,
// assert you are actually signed in — stays the same.

const AUTH_FILE = '.auth/user.json';

setup('authenticate against the deployed environment', async ({ page }) => {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;

  // Fail loudly rather than proceeding as an anonymous user: an unauthenticated
  // run produces a wall of confusing assertion failures that look like product
  // bugs. Never fall back to a hardcoded default credential.
  if (!email || !password) {
    throw new Error('E2E_USER_EMAIL and E2E_USER_PASSWORD must be set for the post-deploy suite');
  }

  // ---- provider-specific: replace this block ------------------------------
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // -------------------------------------------------------------------------

  // Assert on a post-login signal, not on the URL alone — a redirect can land
  // on the right path while the session cookie was never issued, which would
  // save an empty storage state and fail every downstream test mysteriously.
  await expect(page.getByRole('button', { name: /account|profile|sign out/i })).toBeVisible({
    timeout: 30_000,
  });

  await page.context().storageState({ path: AUTH_FILE });
});
