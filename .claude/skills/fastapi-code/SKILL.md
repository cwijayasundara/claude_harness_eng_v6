---
name: fastapi-code
description: Build FastAPI backends — dependency injection with Depends(), Pydantic v2 request/response validation, async vs sync route rules, background tasks, and testing with TestClient. Use for any FastAPI route, dependency, or Pydantic model. Not for database/ORM design (no SQLAlchemy content here) or non-FastAPI Python web frameworks. Triggers on "FastAPI route", "Depends()", "Pydantic model", "FastAPI dependency", "FastAPI testing", "TestClient", "async def vs def FastAPI".
---

# FastAPI

Sources: https://fastapi.tiangolo.com/tutorial/dependencies/, https://fastapi.tiangolo.com/tutorial/testing/, https://fastapi.tiangolo.com/tutorial/background-tasks/, https://fastapi.tiangolo.com/async/, https://pydantic.dev/docs/validation/latest/get-started/migration/ (fetched 2026-07-07 — re-verify if this content seems stale).

## Quick Reference

- `references/dependency-injection-and-validation.md` — `Depends()` patterns (function/class/sub-dependencies), dependency caching per request, Pydantic v2 validation and the v1→v2 migration renames.
- `references/async-and-testing.md` — `async def` vs `def` route rules (and what happens when you get it wrong), `BackgroundTasks` vs a real task queue, `TestClient` + dependency overrides for testing.

## Gotchas (do not skip)

- **Blocking code inside `async def` blocks the entire server**, not just that request — `time.sleep()` or a synchronous DB call in an `async def` route stalls every other in-flight request. If a library doesn't support `await`, use plain `def` — FastAPI runs it in a threadpool automatically, which is the *safe default* when unsure.
- **Dependencies are cached per request, not globally.** The same `Depends(get_db)` declared twice in one request's dependency tree executes once and shares the result — but a fresh instance is created on every new request. Don't rely on dependency-level state persisting across requests; use FastAPI's lifespan events for that instead.
- **`Depends(fn)` takes the function reference, not a call to it.** `Depends(get_db)`, never `Depends(get_db())`.
- **Pydantic v1 method names are gone in v2**: `.dict()` → `.model_dump()`, `.json()` → `.model_dump_json()`, `.parse_obj()` → `.model_validate()`, the inner `class Config` → a `model_config = ConfigDict(...)` class attribute, `@validator` → `@field_validator` (now requires `@classmethod` too), `@root_validator` → `@model_validator(mode="before")`.
- **`TestClient` test functions are synchronous** (`def test_x():`, not `async def`) — no `await` on client calls, even though the app under test is fully async. Reach for `pytest-asyncio` only for testing async helper functions directly, not for driving `TestClient`.
- **`BackgroundTasks` runs in the same process, with no persistence or retries.** Fine for a quick log write or notification; a crash before it completes loses the task silently. Reach for a real task queue (Celery + Redis/RabbitMQ) when the work is heavy, must survive a crash, or needs distributed execution.

## Not Yet Covered Here (fetch before relying on these topics)

Database/ORM patterns (SQLAlchemy) are explicitly out of scope for this skill — see the design's own scoping decision. If a project needs that content, fetch `https://docs.sqlalchemy.org/` fresh rather than guessing.
