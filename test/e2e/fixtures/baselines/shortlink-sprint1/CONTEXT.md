# Context

Domain glossary for the shortlink service. Seeded during `/design` rendering
(sprint 1) from `prd.md` and `specs/stories/stories.json` — the adopt-only BRD
pass (`--prd`) did not extract `domain_concepts`, so this is the first pass.
Extend it, do not fork it, when later sprints add terms.

## Terms

**Core Domain**

### Member
A registered account holder. The only actor type in sprint 1 — no admin, no
anonymous minting, no teams. Identified by email; proves identity with a
password at sign-in.

### Session
The server-side record backing a Member's HTTP-only cookie after sign-in.
Distinct from the cookie itself: the cookie is a bearer reference, the Session
row is the revocable server-side state. Sign-out invalidates a Session
server-side (sets it revoked) rather than merely clearing the client's cookie.

### Link
A shortening of one Target URL to one Code, owned by exactly one Member.
A Link is soft-deleted (see `deleted_at`), never hard-deleted, so its Code can
never be reissued to a different Link.

### Code
The short, unique, randomly generated string that identifies a Link (e.g.
`aZ3kQ9x`). At least 7 characters drawn from a CSPRNG over a 62-character
alphanumeric alphabet (>= 40 bits of entropy). Never chosen by a Member (no
vanity codes) and never reused — unique across every Link row, deleted or not.

### Target URL
The destination a Link's Code redirects to. Validated at creation time by
literal scheme/host/IP-range inspection only — never by DNS resolution or an
outbound fetch — and rejected if it points at the service's own public base
URL or at a private/loopback/link-local/unique-local/cloud-metadata address.

### Console
The signed-in Member's web page listing their own Links, newest first, 20 per
page, with a delete action per Link. Renders no other Member's Links.

### Redirect
The HTTP 302 response an existing, not-deleted Code's Target URL produces when
requested. The handler returns the `Location` header only — it never follows
or fetches the Target URL itself.

**Wire Shapes**

API request/response schema names from `specs/design/api-contracts.schema.json`
— each is a shape of a Core Domain term above, not a new concept.

### RegisterRequest
The `POST /auth/register` request body: a Member's email and password.

### SignInRequest
The `POST /auth/sign-in` request body: a Member's email and password.

### MemberView
The Member fields returned to the client: id, email, createdAt. Never
includes the password hash.

### CreateLinkRequest
The `POST /links` request body: the Target URL to shorten.

### LinkView
The Link fields returned to the client: code, targetUrl, createdAt.

### LinkPage
A paginated page of LinkView items for the Console: items, page, pageSize
(20), total.

### HealthBody
The `/healthz` response body: status and database reachability.

### ErrorBody
The shared error envelope every 4xx/503 response returns: a single `error`
message field.

## Invariants

- A Code is unique across every Link row that has ever existed (including
  soft-deleted rows) — a deleted Code is never reissued.
- A Session is invalidated server-side (revoked), not just forgotten
  client-side; a revoked or expired Session's cookie authenticates nothing.
- Target URL validation is literal-only: no DNS lookup, no outbound fetch, at
  creation time or at redirect time.
- A Member only ever sees or deletes their own Links.

## Out of Scope Terms

- **Vanity code / custom code** — Codes are always server-generated, never
  chosen by a Member (SG-1).
- **Click count / analytics event** — no click tracking, referrers, or GeoIP
  this sprint (SG-4).
- **Team / workspace / admin role** — ownership is a single Member; no shared
  or administrative access (SG-5).
- **Expiring link** — Links do not expire this sprint (SG-3); do not confuse
  with soft-delete, which is permanent revocation, not a time window.
