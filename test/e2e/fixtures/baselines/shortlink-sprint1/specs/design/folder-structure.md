# Folder Structure — shortlink (sprint 1)

```
backend/                     FastAPI service (Python 3.12 / uv)
  src/
    types/                   Pydantic models shared by every layer below
    config/                  Settings loaded from environment (DATABASE_URL, PUBLIC_BASE_URL, SESSION_COOKIE_NAME)
    repository/               Postgres access — never imports services/ or api/
    services/                 Business rules — never imports api/
    api/                      FastAPI routers + request dependencies
    main.py                   App wiring: routers, middleware, exception handlers
    logging_config.py         Log redaction filter (password/hash never logged)
  tests/
    unit/                     One file per services/ and repository/ module
    integration/               One file per api/ router, hitting a real test DB
    perf/                      E4-S2 load-test harness + report writer
  pyproject.toml               uv-managed deps, ruff, mypy, pytest config
  Dockerfile

frontend/                    Next.js service (TypeScript)
  src/
    app/
      console/                The Console page (E4-S1)
      api/                    Route Handlers proxying to the backend (D-1)
      [code]/                 Public redirect passthrough route
    components/                One component per file (frontend/CLAUDE.md)
    api/                       API client wrappers — the only layer that calls fetch()
    types/                     Shared TypeScript types, mirroring api-contracts.schema.json
  tests/                        Mirrors src/ — one test file per component/route
  package.json
  Dockerfile

docker-compose.yml            backend + frontend + postgres:16 — one command, one Postgres (E7-S1)
.env.example                  DATABASE_URL, PUBLIC_BASE_URL, SESSION_COOKIE_NAME placeholders

specs/                        Pipeline artifacts (this design, stories, tests) — not shipped
CONTEXT.md                    Domain glossary — read before naming anything new
```

No directory beyond this list is required by any sprint-1 story. A new
top-level directory (a `packages/` monorepo split, a `worker/` service, a
`nginx/` reverse proxy) is out of scope unless a future decision record adds
it — none of D-1..D-4 calls for one, and D-1 explicitly keeps the topology to
two application services in front of one Postgres.
