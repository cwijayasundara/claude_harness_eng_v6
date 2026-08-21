# API Contracts — shortlink (sprint 1)

Two contract shapes exist per D-1: the **backend contract** (FastAPI, called
only server-side by Next.js Route Handlers, never by the browser) and the
**frontend contract** (Next.js, the only origin the browser calls). Field
shapes are identical; only the base origin and cookie boundary differ. Both
are listed below; `api-contracts.schema.json` documents the backend contract
(the source of truth for the OpenAPI shape) since the frontend contract is a
1:1 relay.

Auth: session cookie `session_id` (`HttpOnly`, `Secure`, `SameSite=Lax`), set
by `POST /auth/sign-in` / `POST /api/auth/sign-in`. No separate CSRF token
(D-4) — Route Handlers only accept same-origin requests.

Rate limits: none this sprint (SG-8 — rate limiting is explicitly out of scope).

---

## POST /auth/register  (frontend: `POST /api/auth/register`)

Register a new Member. Does not sign in.

**Request**
```json
{ "email": "ada@example.com", "password": "correct horse battery staple" }
```

**Response 201**
```json
{ "id": "b3e1...", "email": "ada@example.com", "createdAt": "2026-08-21T16:30:00Z" }
```

**Response 409** — `email` already registered
```json
{ "error": "email_already_registered" }
```

**Response 422** — malformed email or missing/empty password
```json
{ "error": "validation_error" }
```

---

## POST /auth/sign-in  (frontend: `POST /api/auth/sign-in`)

**Request**
```json
{ "email": "ada@example.com", "password": "correct horse battery staple" }
```

**Response 200** — sets `Set-Cookie: session_id=...; HttpOnly; Secure; SameSite=Lax`
```json
{ "id": "b3e1...", "email": "ada@example.com" }
```

**Response 401** — unregistered email or wrong password (same error either way — no
user-enumeration signal); no cookie is set
```json
{ "error": "invalid_credentials" }
```

---

## POST /auth/sign-out  (frontend: `POST /api/auth/sign-out`)

**Request**: no body. Auth: session cookie required.

**Response 204**: no body. Server-side session row is revoked (`revoked_at`
set) — the same cookie, replayed, then fails auth.

**Response 401** — no active session (missing, already-revoked, or unknown
cookie); no server state changes
```json
{ "error": "no_active_session" }
```

---

## POST /links  (frontend: `POST /api/links`)

Auth: session cookie required.

**Request**
```json
{ "targetUrl": "https://example.com/a/long/path" }
```

**Response 201**
```json
{ "code": "aZ3kQ9x", "targetUrl": "https://example.com/a/long/path", "createdAt": "2026-08-21T16:31:00Z" }
```

**Response 401** — no valid session; no link row created
```json
{ "error": "no_active_session" }
```

**Response 422** — unsafe scheme/host (non-http(s) scheme; host matches
`PUBLIC_BASE_URL`; or a `localhost`/private/loopback/link-local/unique-local/
cloud-metadata literal). Rejected by literal inspection only — no DNS lookup,
no outbound fetch.
```json
{ "error": "unsafe_target" }
```

---

## GET /links  (frontend: `GET /api/links`)

Auth: session cookie required. Returns only the caller's own Links.

**Query params**: `page` (integer, >= 1, default 1). Page size is fixed at
20 and is not client-configurable.

**Response 200**
```json
{
  "items": [
    { "code": "aZ3kQ9x", "targetUrl": "https://example.com/a", "createdAt": "2026-08-21T16:31:00Z" }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 25
}
```
Newest first (`created_at DESC`), consistent ordering across the page
boundary. Empty `items` (not an error) when the member owns zero links.

**Response 401**
```json
{ "error": "no_active_session" }
```

---

## DELETE /links/{code}  (frontend: `DELETE /api/links/{code}`)

Auth: session cookie required. Only the owning member may delete.

**Response 204**: no body. The link is soft-deleted (`deleted_at` set); its
`code` is never reissued (D-3's cross-row `UNIQUE` constraint on `code`
enforces this at the database level).

**Response 401**
```json
{ "error": "no_active_session" }
```

**Response 404** — code does not exist, is already deleted, or is owned by
another member (all three cases return the same 404, never leaking which)
```json
{ "error": "link_not_found" }
```

---

## GET /{code}  (frontend: `GET /{code}`, root-level, unauthenticated)

No auth. Public redirect.

**Response 302** — `Location: <targetUrl>`. Neither the FastAPI handler nor
the Next.js proxy in front of it follows or fetches the target — the header
is relayed as-is.

**Response 404** — code was never issued, or is soft-deleted
```json
{ "error": "link_not_found" }
```

---

## GET /healthz

No auth. Served directly by FastAPI (docker-compose healthcheck target, not
proxied through Next.js — see `architecture.md`).

**Response 200**
```json
{ "status": "ok", "database": "reachable" }
```

**Response 503**
```json
{ "status": "unavailable", "database": "unreachable" }
```

---

## Global 503 envelope (all endpoints except `/healthz`)

When Postgres is unreachable, every other endpoint returns:

**Response 503**
```json
{ "error": "service_unavailable" }
```

Never a stack trace, exception class name, or filesystem path. Recovers to
the endpoint's normal status once the database is reachable again.
