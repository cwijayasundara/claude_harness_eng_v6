# Component Map — shortlink (sprint 1)

Every ready story to the files implementing it. Files touched by more than
one story are called out under **Shared files** with a single owner — other
stories touching that file are consumers who add to it, not co-owners.

## E1-S1 — Register and sign in

Owns:
- `backend/src/types/models.py` (shared — see below; E1-S1 creates it: `Member`, `Session`, `RegisterRequest`, `SignInRequest`, `MemberView`, `ErrorBody`)
- `backend/src/config/settings.py` (shared — see below; E1-S1 creates it)
- `backend/src/repository/db.py` (shared — see below; E1-S1 creates it: engine/session factory)
- `backend/src/repository/member_repository.py`
- `backend/src/repository/session_repository.py`
- `backend/src/services/auth_service.py` (shared with E1-S2 — see below; E1-S1 creates it: `register`, `sign_in`, `get_current_member`)
- `backend/src/api/deps.py`
- `backend/src/api/auth.py` (shared with E1-S2 — see below; E1-S1 creates it: `POST /auth/register`, `POST /auth/sign-in`)
- `backend/src/logging_config.py`
- `backend/src/main.py` (shared — see below; E1-S1 creates it)
- `frontend/src/app/api/auth/register/route.ts`
- `frontend/src/app/api/auth/sign-in/route.ts`

Produces: `Member`, `Session` types; the session-cookie mechanism (`require_session` dependency) every other authenticated story consumes; the D-1 proxy pattern the other auth Route Handlers copy.
Consumes: nothing (no `depends_on`).

Note: the story's `layer` is `backend`, but D-1 requires every browser-facing
call — including register and sign-in — to go through a same-origin Next.js
Route Handler. The two thin proxy files above are that decision's direct
consequence, not scope this story invented.

## E1-S2 — Sign out invalidates the session

Owns:
- `backend/src/api/auth.py` (shared — adds `POST /auth/sign-out` to E1-S1's file)
- `backend/src/services/auth_service.py` (shared — adds `sign_out`)
- `frontend/src/app/api/auth/sign-out/route.ts`

Produces: session revocation (`revoked_at` set).
Consumes: `Session` (E1-S1) — invalidates the row E1-S1's sign-in creates.

## E2-S1 — Create a short link (SSRF-safe, random code)

Owns:
- `backend/src/types/models.py` (shared — adds `Link`, `CreateLinkRequest`, `LinkView`)
- `backend/src/config/settings.py` (shared — adds `PUBLIC_BASE_URL`)
- `backend/src/repository/link_repository.py`
- `backend/src/services/target_validation.py`
- `backend/src/services/code_generator.py`
- `backend/src/services/link_service.py` (shared with E4-S1, E5-S1 — see below; E2-S1 creates it: `create_link`)
- `backend/src/api/links.py` (shared with E4-S1 — see below; E2-S1 creates it: `POST /links`)
- `frontend/src/app/api/links/route.ts` (shared with E4-S1 — see below; E2-S1 creates it: `POST` handler)

Produces: `Link` type; the target-validation and code-generation building
blocks E3-S1/E4-S1/E5-S1's endpoints all read through.
Consumes: `Session` (E1-S1) — create requires a signed-in session.

## E3-S1 — Redirect a known code to its target

Owns:
- `backend/src/api/redirect.py`
- `frontend/src/app/[code]/route.ts`

Produces: `GET /{code}` (public redirect).
Consumes: `Link` row (E2-S1) — needs an existing link to redirect.

## E4-S1 — List the signed-in member's own links (console)

Owns:
- `backend/src/repository/link_repository.py` (shared — adds the paginated list query to E2-S1's file)
- `backend/src/services/link_service.py` (shared — adds `list_links`)
- `backend/src/api/links.py` (shared — adds `GET /links` to E2-S1's file)
- `frontend/src/app/api/links/route.ts` (shared — adds the `GET` handler to E2-S1's file)
- `frontend/src/app/console/page.tsx`
- `frontend/src/components/LinkList.tsx`
- `frontend/src/components/LinkRow.tsx`
- `frontend/src/components/Pagination.tsx`
- `frontend/src/components/EmptyState.tsx`
- `frontend/src/api/linksClient.ts`
- `frontend/src/types/link.ts`
- `frontend/src/types/member.ts`

Produces: the Console page E4-S3 audits; `GET /links`.
Consumes: `Session` (E1-S1); `Link` rows (E2-S1); `DELETE /links/{code}`
(E5-S1) — the per-row delete action calls E5-S1's endpoint.

## E4-S2 — Create/list p95 < 300ms at 100 links

Owns:
- `backend/tests/perf/test_latency.py`

Produces: the machine-readable timing report the evaluator reads.
Consumes: `POST /links` (E2-S1), `GET /links` (E4-S1) — measures both, adds
no production code of its own.

## E4-S3 — Console list page meets WCAG 2.2 AA

Owns:
- `frontend/tests/console/a11y.spec.ts`
- `frontend/src/components/LinkList.tsx` (shared — a11y fixes land in E4-S1's file, e.g. focus order, ARIA labels)
- `frontend/src/components/Pagination.tsx` (shared — same, keyboard operability)

Produces: the automated WCAG 2.2 AA scan + keyboard/contrast test suite.
Consumes: the Console page (E4-S1) — audits and, where a violation is found,
patches E4-S1's own component files rather than forking them.

## E5-S1 — Delete a member's own link

Owns:
- `backend/src/repository/link_repository.py` (shared — adds `soft_delete`)
- `backend/src/services/link_service.py` (shared — adds `delete_link`)
- `backend/src/api/links.py` (shared — adds `DELETE /links/{code}` to the same router file E2-S1/E4-S1 use)
- `frontend/src/app/api/links/[code]/route.ts`

Produces: `DELETE /links/{code}`; the soft-delete + code-never-reissued
guarantee (D-3) that E3-S1's redirect and E2-S1's uniqueness constraint both
rely on.
Consumes: `Session` (E1-S1); `Link` row (E2-S1).

## E6-S1 — `/healthz` reflecting database reachability

Owns:
- `backend/src/repository/db.py` (shared — adds `check_db_reachable`)
- `backend/src/types/models.py` (shared — adds `HealthBody`)
- `backend/src/api/health.py`
- `backend/src/main.py` (shared — registers the health router)

Produces: `check_db_reachable()`, the shared DB-reachability primitive E6-S2
reuses.
Consumes: nothing (no `depends_on`).

## E6-S2 — Safe 503 JSON envelope when DB unreachable

Owns:
- `backend/src/api/error_handlers.py`
- `backend/src/types/models.py` (shared — adds `ErrorBody`, already used by every 4xx response above)
- `backend/src/main.py` (shared — registers the global exception handler)

Produces: the global 503 envelope every non-`/healthz` endpoint returns on
DB failure.
Consumes: `check_db_reachable` (E6-S1).

## E7-S1 — `docker compose up` runs the whole stack

Owns:
- `docker-compose.yml`
- `backend/Dockerfile`
- `frontend/Dockerfile`
- `.env.example`

Produces: the one-command stack every other story is demoed and evaluated
through.
Consumes: nothing (no `depends_on`).

---

## Shared files (cross-story ownership)

| File | Owner | Also touched by | Why it is shared |
|---|---|---|---|
| `backend/src/types/models.py` | E1-S1 | E2-S1, E6-S1, E6-S2 | One Pydantic module for every request/response/domain type — a route registry for types, not a god module (each addition is one Type per story). |
| `backend/src/config/settings.py` | E1-S1 | E2-S1 | Single settings surface; E2-S1 adds `PUBLIC_BASE_URL` alongside E1-S1's `DATABASE_URL`/`SESSION_COOKIE_NAME`. |
| `backend/src/repository/db.py` | E1-S1 | E6-S1 | E1-S1 creates the engine/session factory; E6-S1 adds the one-line reachability probe that reuses it. |
| `backend/src/services/auth_service.py` | E1-S1 | E1-S2 | Sign-out invalidates the session sign-in issues — same module, same domain concern. |
| `backend/src/api/auth.py` | E1-S1 | E1-S2 | One router for the three auth endpoints. |
| `backend/src/services/link_service.py` | E2-S1 | E4-S1, E5-S1 | Create/list/delete are all Link business rules — one service module per `backend/CLAUDE.md`'s layering, not three. |
| `backend/src/repository/link_repository.py` | E2-S1 | E4-S1, E5-S1 | One repository module for the `links` table. |
| `backend/src/api/links.py` | E2-S1 | E4-S1, E5-S1 | One router for `POST/GET /links` and `DELETE /links/{code}`. |
| `frontend/src/app/api/links/route.ts` | E2-S1 | E4-S1 | Next.js convention: one file exports both `POST` and `GET` for the same path. |
| `frontend/src/components/LinkList.tsx`, `frontend/src/components/Pagination.tsx` | E4-S1 | E4-S3 | E4-S3 audits and patches accessibility into the components E4-S1 renders — it does not fork them. |
| `backend/src/main.py` | E1-S1 | E1-S2, E3-S1, E6-S1, E6-S2 | App-wiring route registry: every router registers here. Reported as a warning, not a collision, by `ownership-check.js` — a route registry is a legitimate shared surface, not a merge hazard on behavior. |

`ownership-check.js --clusters` will warn on `backend/src/main.py`,
`backend/src/repository/db.py`, and `backend/src/types/models.py` since they
are touched across `story-clusters.json` cluster boundaries (C1/C2/C3/C5).
Each is a registry/type-module case the reference doc calls a legitimate
design outcome, not a behavior collision — resolved by owner-integrates
(the owning story's teammate is the one who commits the file; consumers hand
their addition to the integrator rather than editing directly).
