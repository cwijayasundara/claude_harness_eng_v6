# Playwright Patterns

Reference for writing and reading Playwright checks. Follow these patterns exactly.
Deviations (especially CSS selectors or arbitrary waits) are evaluation defects.

---

## Selector Patterns

### Always Use Semantic Selectors

```typescript
// By role (preferred — most resilient to DOM changes)
page.getByRole('button', { name: 'Submit Order' })
page.getByRole('textbox', { name: 'Email address' })
page.getByRole('combobox', { name: 'Country' })
page.getByRole('checkbox', { name: 'Accept terms' })
page.getByRole('link', { name: 'View details' })
page.getByRole('heading', { name: 'Order Confirmation' })

// By label (for form fields with associated <label>)
page.getByLabel('Email address')
page.getByLabel('Password')

// By text (for static content assertions)
page.getByText('Your order has been placed')
page.getByText('Error: invalid credentials')

// By test ID (last resort — only when role/label/text is not viable)
page.getByTestId('order-summary-panel')
```

### NEVER Use CSS or XPath Selectors
```typescript
// WRONG — fragile, tied to implementation details
page.locator('.btn-primary')
page.locator('#submit-btn')
page.locator('div > span.error-message')
page.locator('xpath=//button[@class="submit"]')
```

---

## Assertion Patterns

```typescript
// Visibility
await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
await expect(page.getByText('Loading...')).not.toBeVisible();

// Text content
await expect(page.getByRole('status')).toHaveText('Order placed successfully');
await expect(page.getByLabel('Total')).toHaveValue('$42.00');

// Count
await expect(page.getByRole('listitem')).toHaveCount(5);

// URL
await expect(page).toHaveURL('/dashboard');
await expect(page).toHaveURL(/\/orders\/[a-f0-9-]+/);

// Enabled/disabled state
await expect(page.getByRole('button', { name: 'Submit' })).toBeEnabled();
await expect(page.getByRole('button', { name: 'Submit' })).toBeDisabled();
```

---

## Wait Patterns

Playwright's `expect` retries automatically. Use it instead of explicit waits.

```typescript
// CORRECT — retries until visible or timeout
await expect(page.getByRole('alert')).toBeVisible();
await expect(page.getByText('Saved')).toBeVisible();

// CORRECT — wait for navigation to complete
await Promise.all([
  page.waitForURL('/confirmation'),
  page.getByRole('button', { name: 'Confirm' }).click(),
]);

// CORRECT — wait for network request
await page.waitForResponse(resp =>
  resp.url().includes('/api/orders') && resp.status() === 201
);
```

```typescript
// NEVER — arbitrary time-based wait
await page.waitForTimeout(2000);  // forbidden
await new Promise(resolve => setTimeout(resolve, 1000));  // forbidden
```

---

## Form Interaction Patterns

```typescript
// Fill a text input
await page.getByLabel('Email address').fill('jane@example.com');

// Select a dropdown option
await page.getByLabel('Country').selectOption('United States');

// Check a checkbox
await page.getByLabel('Accept terms').check();

// Click a button and wait for navigation
await page.getByRole('button', { name: 'Place Order' }).click();
await expect(page).toHaveURL('/confirmation');

// Submit a full form
await page.getByLabel('First name').fill('Jane');
await page.getByLabel('Last name').fill('Smith');
await page.getByLabel('Email').fill('jane.smith@example.com');
await page.getByRole('button', { name: 'Create Account' }).click();
await expect(page.getByRole('heading', { name: 'Welcome, Jane' })).toBeVisible();
```
