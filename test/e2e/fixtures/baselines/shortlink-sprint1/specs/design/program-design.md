# Program design

Types, signatures, call stacks, and file layout the implementer is bound by.
The human approves this file, not an implied architecture in the stories.

## Types

```
# --- backend/src/types/models.py (Pydantic) ---

Member { id: UUID, email: str, password_hash: str, created_at: datetime }

Session { id: UUID, member_id: UUID, created_at: datetime,
          expires_at: datetime | None,   # schema-ready per D-2; not enforced
                                          # this sprint — no AC specifies a TTL,
                                          # so it stays NULL until a retention
                                          # policy is decided (design-render:
                                          # not inventing an unowned threshold)
          revoked_at: datetime | None }  # sign-out sets this; NULL = active

Link { id: UUID, owner_id: UUID, code: str, target_url: str,
       created_at: datetime, deleted_at: datetime | None }

# --- API request/response shapes (mirror api-contracts.schema.json) ---

RegisterRequest { email: str, password: str }
SignInRequest   { email: str, password: str }
MemberView      { id: UUID, email: str, createdAt: datetime }

CreateLinkRequest { targetUrl: str }
LinkView          { code: str, targetUrl: str, createdAt: datetime }
LinkPage          { items: list[LinkView], page: int, pageSize: int, total: int }

ErrorBody { error: str }
HealthBody { status: Literal["ok", "unavailable"], database: Literal["reachable", "unreachable"] }
```

## Signatures

```
# --- backend/src/services/auth_service.py ---
register(email: str, password: str) -> Member
    raises EmailAlreadyRegistered

sign_in(email: str, password: str) -> tuple[Member, Session]
    raises InvalidCredentials   # unregistered email OR wrong password — same error, same status

sign_out(session_id: UUID) -> None
    raises NoActiveSession

get_current_member(session_id: UUID | None) -> Member
    raises NoActiveSession      # missing cookie, revoked, or (if ever set) expired session

# --- backend/src/services/link_service.py ---
create_link(owner_id: UUID, target_url: str) -> Link
    raises UnsafeTarget         # scheme/host/IP-range rejected — maps to 422

get_link_by_code(code: str) -> Link
    raises LinkNotFound         # unissued OR soft-deleted code — both 404

list_links(owner_id: UUID, page: int) -> LinkPage   # pageSize fixed at 20, newest first

delete_link(owner_id: UUID, code: str) -> None
    raises LinkNotFound         # not found, already deleted, OR owned by another member — 404 in all three

# --- backend/src/services/target_validation.py ---
validate_target(url: str, public_base_url: str) -> None
    raises UnsafeTarget
    # literal scheme allow-list (http, https) + literal host/IP-range deny-list
    # (PUBLIC_BASE_URL, localhost, RFC1918/loopback/link-local/unique-local/
    # 169.254.169.254) — no socket.getaddrinfo, no outbound request, ever.

# --- backend/src/services/code_generator.py ---
generate_code(length: int = 7) -> str
    # secrets.choice over a fixed 62-char alphanumeric alphabet; caller retries
    # generate_code() -> repository insert on a UNIQUE-constraint collision
    # (D-3: the constraint spans all rows, so a collision is db-detected)

# --- backend/src/repository/db.py ---
check_db_reachable() -> bool   # single lightweight SELECT 1, short timeout

# --- backend/src/api/deps.py ---
require_session(request: Request) -> Member   # FastAPI dependency, wraps get_current_member

# --- frontend/src/api/linksClient.ts ---
listLinks(page: number): Promise<LinkPage>
deleteLink(code: string): Promise<void>
# both call same-origin `/api/links*` Route Handlers — never `fetch` to the
# FastAPI origin directly (D-1), and never called straight from a component
# (frontend/CLAUDE.md: API client calls live in src/api/, not in components)
```

## Call stack

```
POST /api/links (Next.js Route Handler, app/api/links/route.ts)
  fetch(BACKEND_URL + "/links", { headers: { cookie }, ... })
    FastAPI: POST /links (api/links.py)
+     require_session(request) -> Member
+     link_service.create_link(member.id, body.targetUrl)
+       target_validation.validate_target(targetUrl, settings.PUBLIC_BASE_URL)
+       code_generator.generate_code()
+       link_repository.insert(owner_id, code, target_url)
+     -> 201 LinkView

GET /{code} (Next.js Route Handler, app/[code]/route.ts)
  fetch(BACKEND_URL + "/{code}", { redirect: "manual" })
    FastAPI: GET /{code} (api/redirect.py)
+     link_repository.get_by_code(code)   # WHERE code=? AND deleted_at IS NULL
+     -> 302 Location: target_url  |  404
  NextResponse.redirect(location, 302)    # relays Location, never fetches it

GET /console (app/console/page.tsx, server component)
  linksClient.listLinks(page)             # frontend/src/api/linksClient.ts
    GET /api/links?page=  (Route Handler, app/api/links/route.ts)
      fetch(BACKEND_URL + "/links?page=", { headers: { cookie } })
        FastAPI: GET /links (api/links.py)
+         require_session(request) -> Member
+         link_service.list_links(member.id, page)
+           link_repository.list_for_owner(owner_id, page, page_size=20)
+         -> 200 LinkPage
  <ConsoleList items=... />                # components/LinkList.tsx
    <LinkRow onDelete={...} />             # components/LinkRow.tsx
      linksClient.deleteLink(code)
        DELETE /api/links/{code}
          FastAPI: DELETE /links/{code} (api/links.py)
+           require_session(request) -> Member
+           link_service.delete_link(member.id, code)
+             link_repository.soft_delete(owner_id, code)   # sets deleted_at
+           -> 204 | 404
```

## File tree

```
backend/src/
+  types/
+    models.py            # Member, Session, Link, request/response models
+  config/
+    settings.py           # DATABASE_URL, PUBLIC_BASE_URL, SESSION_COOKIE_NAME
+  repository/
+    db.py                 # engine/session factory, check_db_reachable
+    member_repository.py
+    session_repository.py
+    link_repository.py
+  services/
+    auth_service.py        # register, sign_in, sign_out, get_current_member
+    target_validation.py   # validate_target (SSRF-safe, literal-only)
+    code_generator.py      # generate_code (CSPRNG)
+    link_service.py        # create_link, get_link_by_code, list_links, delete_link
+  api/
+    deps.py                # require_session dependency
+    auth.py                # POST /auth/register, /auth/sign-in, /auth/sign-out
+    links.py                # POST /links, GET /links, DELETE /links/{code}
+    redirect.py             # GET /{code}
+    health.py               # GET /healthz
+    error_handlers.py       # global 503 JSON envelope on DB-unreachable
+  logging_config.py         # redaction filter — password/hash never logged
+  main.py                   # FastAPI app wiring
backend/tests/
+  unit/  ...                # one file per service/repository module above
+  integration/ ...          # one file per api/ router
+  perf/
+    test_latency.py          # E4-S2 load-test harness, writes JSON report

frontend/src/
+  app/
+    console/page.tsx         # the Console (E4-S1)
+    api/
+      auth/register/route.ts
+      auth/sign-in/route.ts
+      auth/sign-out/route.ts
+      links/route.ts         # POST create, GET list
+      links/[code]/route.ts  # DELETE
+    [code]/route.ts          # public redirect passthrough
+  components/
+    LinkList.tsx
+    LinkRow.tsx
+    Pagination.tsx
+    EmptyState.tsx
+  api/
+    linksClient.ts
+  types/
+    link.ts
+    member.ts
frontend/tests/
+  ...                        # one file per component + Route Handler above

~  docker-compose.yml         # backend, frontend, postgres:16 (E7-S1)
```
