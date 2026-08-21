# Deployment — shortlink (sprint 1)

## Environments

Single environment this sprint: **local/evaluation**, brought up entirely by
`docker compose up` (E7-S1, NFR-5). No staging/production environment is in
scope — the PRD's success criterion is a clean-checkout, single-command run
with no third-party network calls at build or run time.

## Services (`docker-compose.yml`)

| Service | Image/build | Port (host) | Depends on |
|---|---|---|---|
| `postgres` | `postgres:16` (official image; the one third-party image the stack pulls) | not published to host by default | — |
| `backend` | built from `backend/Dockerfile` | not required to be published — only `frontend` calls it, over the compose network (D-1) | `postgres` (healthcheck) |
| `frontend` | built from `frontend/Dockerfile` | `3000:3000` — this is the one origin the browser and the evaluator hit | `backend` (healthcheck) |

Exactly one Postgres service (`E7-S1-AC3`) — no read replica, no separate
cache, no message broker; none is required by any sprint-1 story.

## Configuration / secrets

Environment variables, documented in `.env.example`, no secret committed:

- `DATABASE_URL` — `postgres` service DSN, backend only.
- `PUBLIC_BASE_URL` — the deployed origin, used by `target_validation.py`'s
  host deny-list (FR-6) so a member cannot mint a link back at the service
  itself.
- `SESSION_COOKIE_NAME` — defaults to `session_id`.
- `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` — local-only
  compose-generated credentials; not meaningful outside the compose network
  (no production database this sprint).

No API key, SSO secret, or third-party credential exists in this sprint's
scope (SG-7: no SSO/MFA; no team integrations per the project description).

## CI/CD

Not built as a deliverable this sprint (SG-11 explicitly excludes scheduled
jobs and OpenAPI publication as required deliverables, and no story asks for
a CI pipeline). `backend/CLAUDE.md` / `frontend/CLAUDE.md` document the
local test/lint/typecheck commands the evaluator and any future CI runs.

## IaC approach

None beyond `docker-compose.yml` — no Terraform/Pulumi, no cloud
provisioning. The entire "infrastructure" this sprint is the compose file,
consistent with NFR-5's single-command, no-external-service posture.

## Startup / health

- `postgres` compose healthcheck: `pg_isready`.
- `backend` compose healthcheck: `GET /healthz` (E6-S1) inside the container
  network — exercises the same DB-reachability check the story requires,
  doubling as the compose dependency gate for `frontend`.
- `frontend` has no separate healthcheck beyond responding on `:3000`; it
  depends on `backend` being healthy before compose reports the stack ready.

## Rollback

No deployed environment exists to roll back this sprint — `docker compose
down` and a clean `docker compose up` on the previous commit is the entire
rollback story for local/evaluation use. Revisit when a real deployment
target is added in a later sprint.

## Network posture (NFR-5)

- Browser → `frontend:3000` only (D-1). `frontend` → `backend` and
  `backend` → `postgres` stay inside the compose network.
- No service makes an outbound call to a host outside the compose network,
  at build or run time — `target_validation.py` never performs a DNS lookup
  or outbound fetch (FR-6/SG-10), and nothing else in this sprint's scope
  calls out (no SSO, no analytics, no email).
