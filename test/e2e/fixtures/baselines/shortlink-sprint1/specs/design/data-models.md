# Data Models — shortlink (sprint 1)

Postgres 16, one schema, three tables. Entity names match `CONTEXT.md`
exactly (Member, Session, Link).

---

## Member

| Field | Type | Constraints |
|---|---|---|
| `id` | uuid | primary key, `default gen_random_uuid()` |
| `email` | text | `NOT NULL`, `UNIQUE` (case-insensitive — store lowercased) |
| `password_hash` | text | `NOT NULL`; Argon2id hash, begins with `$argon2id$`; never logged |
| `created_at` | timestamptz | `NOT NULL`, `default now()` |

**Indexes**: unique index on `email`.

**Relationships**: one Member has many Sessions, many Links.

**Example record**
```json
{
  "id": "b3e1c2a4-9f3a-4e3b-9a1a-2c9c9b8d7f11",
  "email": "ada@example.com",
  "password_hash": "$argon2id$v=19$m=19456,t=2,p=1$...",
  "created_at": "2026-08-21T16:30:00Z"
}
```

---

## Session

| Field | Type | Constraints |
|---|---|---|
| `id` | uuid | primary key, `default gen_random_uuid()` — this is the `session_id` cookie value |
| `member_id` | uuid | `NOT NULL`, `REFERENCES members(id)` |
| `created_at` | timestamptz | `NOT NULL`, `default now()` |
| `expires_at` | timestamptz | nullable. Schema-ready per decision D-2; **not enforced this sprint** — no acceptance criterion specifies a retention window, so the column stays `NULL` (no time-based expiry) until that policy is decided. Do not hardcode a duration here. |
| `revoked_at` | timestamptz | nullable. Set by sign-out (`FR-7`). `NULL` = active. |

**Indexes**: index on `member_id`; index on `id` (primary key, used on every
authenticated request's session lookup).

**Relationships**: many Sessions belong to one Member.

**A Session is valid** iff `revoked_at IS NULL` and (`expires_at IS NULL` or
`expires_at` is in the future).

**Example record**
```json
{
  "id": "0f2a...",
  "member_id": "b3e1c2a4-9f3a-4e3b-9a1a-2c9c9b8d7f11",
  "created_at": "2026-08-21T16:31:00Z",
  "expires_at": null,
  "revoked_at": null
}
```

---

## Link

| Field | Type | Constraints |
|---|---|---|
| `id` | uuid | primary key, `default gen_random_uuid()` |
| `owner_id` | uuid | `NOT NULL`, `REFERENCES members(id)` |
| `code` | text | `NOT NULL`, `UNIQUE` across **all** rows including soft-deleted ones (D-3) — this is what guarantees a deleted code is never reissued; length >= 7, alphanumeric |
| `target_url` | text | `NOT NULL`; validated at insert time only (literal scheme/host check, `services/target_validation.py`) — never re-validated or re-fetched afterward |
| `created_at` | timestamptz | `NOT NULL`, `default now()` |
| `deleted_at` | timestamptz | nullable. `NULL` = live. Set by delete (D-3 soft delete); never cleared. |

**Indexes**:
- `UNIQUE` index on `code` (full table, not partial — must cover deleted rows
  per D-3).
- composite index on `(owner_id, created_at DESC)` for the paginated,
  newest-first list query (`GET /links`) and for the ownership check on
  delete.
- The redirect lookup (`GET /{code}`) filters `WHERE code = ? AND deleted_at
  IS NULL`, served by the `code` unique index.

**Relationships**: many Links belong to one Member (`owner_id`).

**Example record**
```json
{
  "id": "6a7b...",
  "owner_id": "b3e1c2a4-9f3a-4e3b-9a1a-2c9c9b8d7f11",
  "code": "aZ3kQ9x",
  "target_url": "https://example.com/a/long/path",
  "created_at": "2026-08-21T16:31:30Z",
  "deleted_at": null
}
```

**A Link is "live"** (returned by `GET /{code}`, `GET /links`, eligible for
delete) iff `deleted_at IS NULL`. A soft-deleted Link's row and `code` persist
forever, purely to hold the `UNIQUE` constraint (SG-11: no scheduled purge
job is a required deliverable this sprint).
