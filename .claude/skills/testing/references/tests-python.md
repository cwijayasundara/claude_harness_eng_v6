# Test authoring reference — Python (pytest)

Idioms for unit/integration tests in Python. (E2E stays Playwright — see the agent's Playwright section, which is cross-stack.)

- **Layout**: tests under `tests/` mirroring `src/` (`tests/service/test_foo.py`), or co-located `test_*.py`. Shared setup in `conftest.py` (fixtures auto-discovered).
- **Fixtures over setup boilerplate**: `@pytest.fixture` for DB sessions, test clients, seeded data; scope appropriately (`function` default, `session` for expensive immutable setup). Yield-fixtures for teardown.
- **API/integration**: exercise FastAPI through `httpx.AsyncClient`(ASGI transport) or `TestClient` — hit real routes, assert status + response body against the Pydantic/schema shape, not internal functions. Use a transactional test DB or in-memory SQLite; never the real DB.
- **Async**: `pytest-asyncio` (`@pytest.mark.asyncio` or `asyncio_mode=auto`); `await` the client; an un-awaited coroutine is a test bug.
- **Edge cases**: `@pytest.mark.parametrize` for input matrices; cover the 4xx/422/401 paths, not just 200.
- **Mock only true externals** (network, clock, queue) with `monkeypatch`/`unittest.mock`; never mock internal modules or assert private call order — test observable behavior through the public interface.
- **Coverage**: `uv run pytest --cov=src --cov-report=term-missing`; cover branches/decision points, not lines for their own sake.
- **Determinism**: freeze time (`freezegun`), seed randomness, no network — flaky tests are findings.
