# Backend

## Test & Lint Commands (run from this directory)

- `uv run pytest -x -q` — run tests
- `uv run ruff check --fix .` — lint
- `uv run mypy src/` — type check

## Conventions

- FastAPI route handlers in `src/api/`
- Business logic in `src/services/` — never import from `api/`
- Database access in `src/repository/` — never import from `services/`
- All functions must have type annotations
