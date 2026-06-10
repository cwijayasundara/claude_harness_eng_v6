# Verification reference — Python / FastAPI (black-box)

Deep Python rigor for the evaluator. Stays black-box: **the tools produce the evidence; never form an opinion by reading source.** `pytest`/`mypy`/`ruff` are objective instruments, not invitations to eyeball the code.

## Environment — run it the project's way

- Resolve the interpreter the project uses. With `package_manager: uv`, run **everything** as `uv run <cmd>`; never bare `python`/`pytest` (wrong interpreter / missing deps). For plain venv, activate `.venv` first.
- Run backend commands from the backend directory (`cd backend` when the preset has one). A "module not found" from the wrong CWD is an environment artifact, not a real failure — fix the CWD and re-run before recording a verdict.
- If the *tooling itself* is missing (`uv run` reports a missing tool/module), that is an infrastructure FAIL (`failure_layer: "infrastructure"`), not a code FAIL.

## Tests — the authoritative behavioral evidence

- `uv run pytest -x -q` — stop at first failure. Nonzero exit is a FAIL; capture the failing **test id** (`path::test_name`) and the assertion/exception, not just "tests failed".
- Distinguish **collection errors** (a module fails to import during collection) from **assertion failures**. A collection error means the code doesn't even import → `error_type: import_error`.
- Coverage: `uv run pytest --cov=src --cov-report=term-missing -q`; parse the `TOTAL` line. Under `/auto`, Gate 3 owns the threshold — don't double-fail; cite the number.
- **Never** edit a test to make it pass. A red test is a real failure. A test that asserts nothing (or is skipped/xfail to dodge a bug) is itself a finding.

## Types & lint — objective gates

- `uv run mypy src/`: a type error is a FAIL with `error_type: type_error`; capture `file:line`.
- `uv run ruff check .`: surface lint errors as evidence.

## Traceback parsing — give the generator the real cause

Read the traceback bottom-up (last frame = where it was raised). Map the exception to `error_type`:

| Exception | error_type |
|---|---|
| `KeyError` | `key_error` |
| `TypeError` / `AttributeError` | `type_error` |
| `ImportError` / `ModuleNotFoundError` | `import_error` |
| `pydantic.ValidationError` | `validation_error` |
| `AssertionError` | `assertion_error` |
| `asyncio.TimeoutError` / read timeout | `timeout` |
| `ConnectionRefusedError` / `OSError` connect | `connection_refused` |

For `files_likely_involved`, take the **deepest project-owned frame** (under `src/`), not the library frame.

## FastAPI / async signals (interpret behavior, never read code to guess)

- **HTTP 500 with empty/opaque body** → an unhandled server exception. Pull the traceback from `docker compose logs backend --tail=50` (docker) or process stderr (local) before classifying. Never report "500" without the underlying exception.
- **HTTP 422** → a Pydantic request-validation rejection, usually a **contract/schema mismatch** (request shape vs. model) — note whether it's a contract problem rather than a server bug.
- **"coroutine was never awaited"**, "event loop is already running", or endpoint timeouts under light load → a missing `await` or a blocking/sync call inside an async route. Classify (`timeout`/`type_error`) from the actual error.

## Persistence & wiring — verify, don't assume

- A health-check `200` already proves the app imports and boots; if health fails with `ImportError`/`ModuleNotFoundError` in the logs, that's `import_error` (circular import or missing `__init__.py`), not "app down".
- When the contract involves persistence, verify a real **round-trip**: a write (`POST`/`PUT`) followed by an independent read (`GET`) that returns the persisted value. A `201` that doesn't actually persist is a FAIL. Confirm migrations are applied (`uv run alembic current`, or the configured tool) when the contract depends on schema.
