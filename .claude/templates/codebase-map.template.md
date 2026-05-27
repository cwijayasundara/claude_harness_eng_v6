# Codebase Map

Top-level directory structure with one-line descriptions. Helps Claude navigate without scanning.

## Directories

| Directory | Purpose |
|-----------|---------|
| `src/` | Application source code |
| `src/api/` | HTTP route handlers and middleware |
| `src/services/` | Business logic layer |
| `src/repository/` | Data access and database queries |
| `src/types/` | Shared TypeScript/Python type definitions |
| `src/config/` | Configuration loading and validation |
| `tests/` | Unit and integration tests |
| `e2e/` | Playwright end-to-end tests |
| `specs/` | BRD, stories, design docs, brownfield maps |
| `.claude/` | Harness agents, skills, hooks, state |

## Entry Points

- **Backend**: `src/main.py` or `src/index.ts`
- **Frontend**: `src/App.tsx` or `pages/index.tsx`
- **CLI**: `src/cli.py` or `src/cli.ts`

## Test Commands (scoped by directory)

| Scope | Command |
|-------|---------|
| Backend unit | `cd backend && uv run pytest -x -q` |
| Backend lint | `cd backend && uv run ruff check --fix .` |
| Backend types | `cd backend && uv run mypy src/` |
| Frontend unit | `cd frontend && npm test` |
| Frontend lint | `cd frontend && npm run lint` |
| Frontend types | `cd frontend && npm run typecheck` |
| E2E | `npx playwright test` |

## Conventions

- Layered architecture: types -> config -> repository -> service -> api
- One-way dependencies only (enforced by check-architecture hook)
- Functions < 50 lines, files < 300 lines (enforced by hooks)
