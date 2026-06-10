# Stack reference — Python / FastAPI (implementation)

Idiomatic, type-safe, testable patterns for backend Python. These idioms are what make the code pass the typecheck/lint/architecture hooks and the evaluator on the first attempt.

- **Typing is non-negotiable** (the `typecheck` hook blocks on `mypy` errors). Annotate every parameter and return. No bare `Any` — use precise types, `TypedDict`, `Protocol` for interfaces, `|`-unions, and `Optional[...]` only when `None` is real. Model all I/O boundaries with **Pydantic v2** models, not dicts.
- **Layered architecture** (the `verify-on-save` hook enforces one-way imports): `api/` → `service/` → `repository/` → `types/`/`config/`. Route handlers stay thin: validate (Pydantic) → call a service → map result to a response model. No business logic in routers; no DB access from services that skip the repository.
- **FastAPI idioms**: inject dependencies with `Depends(...)` (DB session, auth, settings); declare `response_model=` and explicit `status_code=`; raise `HTTPException` (or a domain exception with a registered handler) instead of returning error dicts; group routes with `APIRouter`.
- **Async correctness**: an `async def` route must not call blocking I/O (sync DB driver, `requests`, `time.sleep`) — use an async driver / `httpx.AsyncClient`, or offload with `run_in_executor`. Always `await` coroutines. Use an async DB session and close it via a dependency.
- **Errors**: never bare `except:`; catch the narrowest exception; never swallow (no silent `pass`). Validate input at the boundary with Pydantic so handlers receive typed, valid data.
- **Tests (TDD, behavior-first)**: `pytest` with fixtures; exercise the API through `httpx.AsyncClient`/`TestClient`, not internal functions; `pytest.mark.parametrize` for edge cases; `pytest-asyncio` for async; mock only true externals (network, clock), never internal modules. Cover the acceptance criteria, including the failure/422/401 paths.
- **Packaging**: `src/` layout, `uv` for deps, real `__init__.py`, no import cycles (they surface as `ImportError` at startup — the evaluator will catch them).
