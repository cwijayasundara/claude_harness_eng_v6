# Test Data Reference

Patterns for creating realistic, maintainable test data across unit, integration, and E2E tests.

---

## Core Rule

Never use placeholder values. Every test datum must be domain-representative:

| Bad | Good |
|-----|------|
| `"test"` | `"jane.smith@example.com"` |
| `0` | `42.99` (a plausible price) |
| `"foo"` | `"Widget Pro 500ml"` |
| `null` as a stand-in | explicit `None`/`null` only when testing null paths |

---

## Factory Functions

Define one factory per domain entity. Factories produce valid objects by default.
Override only the fields relevant to the test.

```typescript
// tests/factories/order.ts
import { faker } from '@faker-js/faker';

faker.seed(parseInt(process.env.FAKER_SEED ?? '12345'));

export function buildOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: faker.string.uuid(),
    customerId: faker.string.uuid(),
    status: 'pending',
    items: [buildOrderItem()],
    totalAmount: faker.number.float({ min: 1, max: 999, fractionDigits: 2 }),
    createdAt: faker.date.recent().toISOString(),
    updatedAt: faker.date.recent().toISOString(),
    ...overrides,
  };
}

export function buildOrderItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id: faker.string.uuid(),
    productId: faker.string.uuid(),
    productName: faker.commerce.productName(),
    quantity: faker.number.int({ min: 1, max: 10 }),
    unitPrice: faker.number.float({ min: 0.99, max: 299.99, fractionDigits: 2 }),
    ...overrides,
  };
}
```

---

## Seeding for Determinism

Always seed fakers in CI to produce deterministic output:

```typescript
// In test setup or vitest.config.ts
beforeAll(() => { faker.seed(12345); });
```

```python
# Python (Faker)
from faker import Faker
fake = Faker()
Faker.seed(12345)
```

---

## Database Fixtures (Integration Tests)

Use fixture files for complex relational seed data. Store in `tests/fixtures/`:

```
tests/fixtures/
  users.json       — 3-5 representative users
  products.json    — 10-15 products with varied attributes
  orders.json      — orders in each status (pending, confirmed, shipped, cancelled)
```

Load fixtures in a `beforeEach` transaction that is rolled back after each test:

```python
@pytest.fixture(autouse=True)
def db_transaction(db):
    db.begin_nested()
    load_fixtures(db, "users", "products")
    yield db
    db.rollback()
```

---

## Realistic Data Checklist

Before submitting tests, verify:
- [ ] Emails look like real emails (`jane@example.com`, not `a@b.com`)
- [ ] Prices have two decimal places and are plausible for the domain
- [ ] UUIDs are generated (not hardcoded strings like `"abc-123"`)
- [ ] Dates are in the correct format (ISO 8601) and are logically consistent
- [ ] Names are human names, not `"Test User"` or `"User 1"`
- [ ] Quantities and amounts are within valid domain ranges
