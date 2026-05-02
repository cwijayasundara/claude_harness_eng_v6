---
name: architecture
description: Layered architecture rules — one-way imports, module boundaries, file organization.
---

# Architecture Skill

Reference skill for generator teammates. Read this before designing or scaffolding any module.

---

## Layered Architecture

Dependencies flow strictly downward. No layer may import from a layer above it.

```
Types       — shared domain types, enums, constants (no dependencies)
Config      — environment loading, validated settings (depends on Types)
Repository  — data access, queries, persistence (depends on Types, Config)
Service     — business logic, orchestration (depends on Repository, Types, Config)
API         — request handling, routing, serialization (depends on Service, Types)
UI          — components, pages, hooks (depends on API types, local Types)
```

Violations (e.g., Repository importing from Service, UI importing from Repository) are
blocking defects and must be fixed before merge.

---

## API Patterns

### Typed Request/Response Schemas

**Python (Pydantic):**
```python
class CreateOrderRequest(BaseModel):
    customer_id: CustomerId
    items: list[OrderItemInput]

class CreateOrderResponse(BaseModel):
    order_id: OrderId
    status: OrderStatus
    created_at: datetime
```

**TypeScript (interface):**
```typescript
interface CreateOrderRequest {
  customerId: CustomerId;
  items: OrderItemInput[];
}
interface CreateOrderResponse {
  orderId: OrderId;
  status: OrderStatus;
  createdAt: string; // ISO 8601
}
```

### Error Response Format
All API errors return a consistent envelope:
```json
{
  "error": {
    "code": "ORDER_NOT_FOUND",
    "message": "Order abc-123 not found",
    "details": {}
  }
}
```

### Pagination
Use cursor-based pagination for lists:
```json
{
  "items": [...],
  "nextCursor": "opaque-string-or-null",
  "total": 142
}
```

---

## Folder Structure

Parameterize `{service}` with the feature or bounded context name.

```
backend/
  src/
    types/        — domain types, enums, error classes
    config/       — env schema, settings loader
    repository/   — DB models, queries, migrations
    service/      — business logic, domain operations
    api/          — routes, controllers, serializers
  tests/
    unit/
    integration/

frontend/
  src/
    types/        — shared TypeScript interfaces
    config/       — env, feature flags, constants
    hooks/        — data-fetching and state hooks
    components/   — reusable UI primitives
    app/          — pages, layouts, routing
  tests/
    unit/
    e2e/
```

---

## Data Modeling

- **Primary keys:** UUIDs (`uuid4`). Never auto-increment integers for domain entities.
- **Timestamps:** every table includes `created_at` and `updated_at` (set by DB trigger or ORM hook).
- **Soft delete:** use `deleted_at TIMESTAMPTZ NULL` instead of hard deletes. Queries filter `WHERE deleted_at IS NULL`.
- **Status fields:** always enums, never free-form strings.
- **Foreign keys:** explicit constraints in migrations, not just ORM relationships.

---

## Environment Variables

Every service must ship a `.env.example` with all variables documented:
```
# Database connection
DATABASE_URL=postgresql://user:pass@localhost:5432/dbname

# Auth
JWT_SECRET=change-me-in-production
JWT_EXPIRES_IN=3600

# External services
STRIPE_API_KEY=sk_test_...
```
No variable may be added to code without a corresponding entry in `.env.example`.

---

## Migration Strategy

- **Python/SQLAlchemy:** Alembic. Every schema change needs a migration file. Never mutate the DB by hand.
- **Node/Prisma:** `prisma migrate dev` for local, `prisma migrate deploy` for CI/prod.
- Migrations are forward-only in production. Write rollback logic only when explicitly required.
- Migration files are committed alongside the feature code that requires them.

---

## Gotchas (Things That Cause Review Failures)

- Type definition gaps — domain concept used in 3+ places without a named type alias
- Layering violations — any upward import (e.g., Repository importing from Service)
- Missing folder structure — files placed at wrong layer level
- Undocumented env vars — added to code but absent from `.env.example`
- Missing migrations — schema changes applied manually without a migration file
- Auto-increment PKs on domain entities instead of UUIDs
- Free-form string status fields instead of enums
- Hard deletes on entities that have audit or history requirements
