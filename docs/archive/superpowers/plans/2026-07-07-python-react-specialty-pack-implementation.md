# Python (FastAPI) & React Specialty Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new auto-attached local skill packs (`fastapi-code`, `react-code`) to the tech-stack specialty layer, extending `.claude/config/framework-skill-packs.json`, so that `/scaffold` gives every FastAPI and/or React project curated, current, production-oriented guidance with zero new interactive question.

**Architecture:** Two new `"source":"local"` registry entries, each a single skill, copied by the already-existing `copyFrameworkPackSkills` (no new copy mechanism — built for `python-ai-agents`, unmodified here). The only new logic is prose: `.claude/commands/scaffold.md`'s Step 2 gains an instruction to auto-append `fastapi-code`/`react-code` to `frameworkPacks` based on the stack the user already chose (`backend.framework === "fastapi"`, `frontend.framework === "react"`), additive to whatever AI-agent packs they explicitly picked.

**Tech Stack:** Node.js (`node:test`) for registry/wiring tests; Markdown for the two new skills.

## Global Constraints

- No new copy mechanism, no new interactive wizard question — reuse `copyFrameworkPackSkills` and `frameworkPacks` exactly as `python-ai-agents` established them.
- `fastapi-code` attaches when `stack.backend.framework === "fastapi"`. `react-code` attaches when `stack.frontend.framework === "react"` — explicitly **not** `"nextjs"` (Preset B is out of scope for v1).
- `fastapi-code` content is scoped to FastAPI/Pydantic/testing — no database/ORM (SQLAlchemy) content.
- `react-code` content is scoped to Vite+React client-side patterns — no Next.js (App Router/Server Components/Server Actions) content.
- Every reference file must cite its real source URL, fetched fresh during this plan's writing (not reused from training-data memory, not copied from the audited external `langchain-agents-*` pack).
- Auto-attach is additive: a project can end up with any combination of `python-ai-agents`, `fastapi-code`, `react-code`, plus the external `langchain`/`google-adk` entries in `frameworkPacks`.

---

### Task 1: Registry entries for `fastapi-code` and `react-code`

**Files:**
- Modify: `.claude/config/framework-skill-packs.json`
- Test: `test/framework-skill-packs.test.js` (append)

**Interfaces:**
- Produces: two new registry entries, `{ "key": "fastapi-code", "source": "local", "skills": ["fastapi-code"] }` and `{ "key": "react-code", "source": "local", "skills": ["react-code"] }`, added to the existing `packs` array alongside `python-ai-agents`, `langchain`, `google-adk`.

- [ ] **Step 1: Write the failing test**

Append to `test/framework-skill-packs.test.js`:

```javascript
test('framework-skill-packs.json registers fastapi-code and react-code as local, single-skill packs', () => {
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));

  const fastapi = registry.packs.find((p) => p.key === 'fastapi-code');
  assert.ok(fastapi, 'expected a fastapi-code entry');
  assert.strictEqual(fastapi.source, 'local');
  assert.deepStrictEqual(fastapi.skills, ['fastapi-code']);

  const react = registry.packs.find((p) => p.key === 'react-code');
  assert.ok(react, 'expected a react-code entry');
  assert.strictEqual(react.source, 'local');
  assert.deepStrictEqual(react.skills, ['react-code']);

  // Existing entries must survive untouched
  const local = registry.packs.find((p) => p.key === 'python-ai-agents');
  assert.deepStrictEqual(local.skills.sort(), ['deepagents-code', 'langchain-code', 'langgraph-code'].sort());
});
```

(`REGISTRY_PATH` and `fs`/`path`/`assert`/`test` are already imported at the top of this file from Task 1 of the prior tech-stack-specialty-pack plan — do not re-declare them.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/framework-skill-packs.test.js`
Expected: FAIL — no `fastapi-code`/`react-code` entries exist yet

- [ ] **Step 3: Update the registry**

In `.claude/config/framework-skill-packs.json`, add two new entries to the `packs` array (after the existing `python-ai-agents` entry, before `langchain`):

```json
    {
      "key": "fastapi-code",
      "source": "local",
      "skills": ["fastapi-code"]
    },
    {
      "key": "react-code",
      "source": "local",
      "skills": ["react-code"]
    },
```

The full file must remain valid JSON with all 5 entries (`python-ai-agents`, `fastapi-code`, `react-code`, `langchain`, `google-adk`) in the `packs` array.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/framework-skill-packs.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add .claude/config/framework-skill-packs.json test/framework-skill-packs.test.js
git commit -m "feat: register fastapi-code and react-code as local framework skill packs"
```

---

### Task 2: `fastapi-code` skill

**Files:**
- Create: `.claude/skills/fastapi-code/SKILL.md`
- Create: `.claude/skills/fastapi-code/references/dependency-injection-and-validation.md`
- Create: `.claude/skills/fastapi-code/references/async-and-testing.md`
- Test: `test/framework-skill-packs.test.js` (append)

**Sourcing for this task:** content fetched and verified this session from `https://fastapi.tiangolo.com/tutorial/dependencies/`, `https://fastapi.tiangolo.com/tutorial/testing/`, `https://fastapi.tiangolo.com/tutorial/background-tasks/`, `https://fastapi.tiangolo.com/async/`, and `https://pydantic.dev/docs/validation/latest/get-started/migration/` (the current canonical URL — `docs.pydantic.dev/latest/migration/` 301-redirects here).

- [ ] **Step 1: Write the failing wiring test**

Append to `test/framework-skill-packs.test.js`:

```javascript
test('fastapi-code skill exists with correct frontmatter and reference files', () => {
  const skillDir = path.join(__dirname, '..', '.claude', 'skills', 'fastapi-code');
  const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: fastapi-code\n/);
  assert.match(skill, /Depends/);
  assert.strictEqual(fs.existsSync(path.join(skillDir, 'references', 'dependency-injection-and-validation.md')), true);
  assert.strictEqual(fs.existsSync(path.join(skillDir, 'references', 'async-and-testing.md')), true);
  const di = fs.readFileSync(path.join(skillDir, 'references', 'dependency-injection-and-validation.md'), 'utf8');
  assert.match(di, /fastapi\.tiangolo\.com\/tutorial\/dependencies/);
  assert.match(di, /pydantic\.dev/);
  const asyncTesting = fs.readFileSync(path.join(skillDir, 'references', 'async-and-testing.md'), 'utf8');
  assert.match(asyncTesting, /fastapi\.tiangolo\.com\/async/);
  assert.match(asyncTesting, /fastapi\.tiangolo\.com\/tutorial\/testing/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/framework-skill-packs.test.js`
Expected: FAIL — `.claude/skills/fastapi-code/SKILL.md` does not exist

- [ ] **Step 3: Write `SKILL.md`**

Create `.claude/skills/fastapi-code/SKILL.md`:

```markdown
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
```

- [ ] **Step 4: Write `references/dependency-injection-and-validation.md`**

Create `.claude/skills/fastapi-code/references/dependency-injection-and-validation.md`:

```markdown
# Dependency Injection and Pydantic v2 Validation

Source: https://fastapi.tiangolo.com/tutorial/dependencies/, https://pydantic.dev/docs/validation/latest/get-started/migration/ (fetched 2026-07-07 — re-verify if this content seems stale)

## `Depends()` — the Core Pattern

`Depends()` takes a function (or class) reference — FastAPI calls it, resolves its own parameters from the request, and injects the result:

```python
from typing import Annotated
from fastapi import Depends, FastAPI

app = FastAPI()

async def common_parameters(q: str | None = None, skip: int = 0, limit: int = 100):
    return {"q": q, "skip": skip, "limit": limit}

@app.get("/items/")
async def read_items(commons: Annotated[dict, Depends(common_parameters)]):
    return commons
```

**Pass the function itself, not a call to it** — `Depends(common_parameters)`, never `Depends(common_parameters())`.

## Class Dependencies

```python
class CommonQueryParams:
    def __init__(self, q: str | None = None, skip: int = 0, limit: int = 100):
        self.q = q
        self.skip = skip
        self.limit = limit

@app.get("/items/")
async def read_items(commons: Annotated[CommonQueryParams, Depends()]):
    return commons
```

## Sub-Dependencies (Dependency Trees)

Dependencies can depend on other dependencies — FastAPI resolves the whole tree, deepest first:

```python
async def get_current_user(token: Annotated[str, Depends(verify_token)]) -> User:
    return User.from_token(token)

async def get_admin_user(user: Annotated[User, Depends(get_current_user)]) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403)
    return user

@app.delete("/admin/users/{user_id}")
async def delete_user(admin: Annotated[User, Depends(get_admin_user)]):
    ...
```

This is the standard shape for hierarchical authorization: `delete_user` → `get_admin_user` → `get_current_user` → `verify_token`.

## Dependency Caching Is Per-Request

If the same dependency is declared more than once in a single request's tree, FastAPI calls it **once** and reuses the result — but each new HTTP request gets a fresh instance:

```python
async def get_db():
    db = DatabaseConnection()   # created once per request, even if depended on twice
    return db
```

**Gotcha:** don't rely on this caching for anything that must persist *across* requests (a connection pool, a cache) — use FastAPI's lifespan events for app-lifetime state instead of a dependency.

## Cleanup with `yield`

For resources that need teardown (DB sessions, file handles), use a generator dependency:

```python
async def get_db():
    db = Database()
    try:
        yield db
    finally:
        db.close()
```

## Reusable Type Aliases

```python
CommonsDep = Annotated[dict, Depends(common_parameters)]

@app.get("/items/")
async def read_items(commons: CommonsDep): ...

@app.get("/users/")
async def read_users(commons: CommonsDep): ...
```

Keeps type hints (and IDE/mypy support) intact while avoiding repetition.

## Pydantic v1 → v2 Renames (the ones that bite most often)

| v1 | v2 |
|---|---|
| `.dict()` | `.model_dump()` |
| `.json()` | `.model_dump_json()` |
| `.parse_obj(...)` | `.model_validate(...)` |
| `.construct(...)` | `.model_construct(...)` |
| `__fields__` | `model_fields` |
| inner `class Config:` | `model_config = ConfigDict(...)` class attribute |
| `Config.orm_mode = True` | `ConfigDict(from_attributes=True)` |
| `@validator("x")` | `@field_validator("x")` + `@classmethod` |
| `@root_validator` | `@model_validator(mode="before")` |

```python
# v1
class MyModel(BaseModel):
    class Config:
        orm_mode = True
    x: int
    @validator("x")
    def check_x(cls, v):
        return v

# v2
from pydantic import ConfigDict, field_validator

class MyModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    x: int
    @field_validator("x")
    @classmethod
    def check_x(cls, v):
        return v
```

**Constrained types** (`ConstrainedInt`, etc.) are gone — use `Annotated` + `Field` instead:

```python
from typing import Annotated
from pydantic import Field

PositiveInt = Annotated[int, Field(ge=0)]
```

**For validating a bare type (not a full model)**, use `TypeAdapter`:

```python
from pydantic import TypeAdapter

adapter = TypeAdapter(list[int])
result = adapter.validate_python(["1", "2", "3"])  # -> [1, 2, 3]
```

## Gotchas

- Circular dependencies (A depends on B, B depends on A) are a real failure mode — keep the dependency graph acyclic.
- All dependency parameters show up in the OpenAPI schema automatically — a dependency with a `q: str | None = None` parameter makes `q` appear in Swagger UI for every route that uses it.
- A bare default value (`q: str = "default"`) is not a dependency — only `Annotated[str, Depends(...)]` triggers FastAPI's injection machinery. Don't confuse the two.
```

- [ ] **Step 5: Write `references/async-and-testing.md`**

Create `.claude/skills/fastapi-code/references/async-and-testing.md`:

```markdown
# Async/Sync Routes, Background Tasks, and Testing

Source: https://fastapi.tiangolo.com/async/, https://fastapi.tiangolo.com/tutorial/background-tasks/, https://fastapi.tiangolo.com/tutorial/testing/ (fetched 2026-07-07 — re-verify if this content seems stale)

## `async def` vs `def` — the Rule

- Use `async def` when you `await` something that actually supports it (most modern async DB drivers, `httpx.AsyncClient`, etc.).
- Use plain `def` when calling a library that does **not** support `await` (most traditional/blocking DB libraries). FastAPI runs `def` route functions in an external threadpool automatically — a safe default when unsure.
- Dependencies follow the same rule independently of the route they're attached to: a sync dependency runs in a threadpool, an async one is awaited, and you can freely mix both under one route.

## The Blocking-Code Gotcha (the one that actually causes incidents)

```python
# BAD — blocks the entire server, not just this request
@app.get('/slow')
async def slow_operation():
    time.sleep(5)
    return "done"

# GOOD — def runs in a threadpool, other requests are unaffected
@app.get('/slow')
def slow_operation():
    time.sleep(5)
    return "done"
```

Calling blocking I/O (`time.sleep`, a synchronous DB query, a synchronous `requests.get`) inside `async def` stalls the whole event loop — every other in-flight request waits. If a route needs to call blocking code, declare it as plain `def`, not `async def`.

## Background Tasks

For quick, fire-and-forget work after a response is sent:

```python
from fastapi import BackgroundTasks, FastAPI

app = FastAPI()

def write_notification(email: str, message=""):
    with open("log.txt", mode="w") as f:
        f.write(f"notification for {email}: {message}")

@app.post("/send-notification/{email}")
async def send_notification(email: str, background_tasks: BackgroundTasks):
    background_tasks.add_task(write_notification, email, message="some notification")
    return {"message": "Notification sent in the background"}
```

The task function can be `async def` or plain `def`. `BackgroundTasks` can also be requested inside a dependency — FastAPI merges tasks added at any level of the dependency tree.

**Use `BackgroundTasks` for:** small, quick work (emails, logging, simple notifications) that can tolerate being lost if the process crashes mid-task.

**Use a real task queue (Celery + Redis/RabbitMQ, or similar) instead when:** the work is CPU-heavy, must survive a process crash, needs retries, or must run on a different machine than the API process. `BackgroundTasks` has none of that — no persistence, no automatic retries, same-process execution only.

## Testing with `TestClient`

```python
from fastapi.testclient import TestClient

client = TestClient(app)

def test_read_main():                      # plain def, not async def
    response = client.get("/")              # no await, even though the app is async
    assert response.status_code == 200
    assert response.json() == {"msg": "Hello World"}
```

`TestClient` is built on HTTPX/Starlette and mimics the `requests` API: `json=` for a JSON body, `data=` for form data, `headers=`, `cookies=`.

### Dependency Overrides for Testing

```python
def get_db():
    return {"real": "database"}

@app.get("/items/")
async def read_items(db: dict = Depends(get_db)):
    return {"db": db}

def override_get_db():
    return {"test": "database"}

client = TestClient(app)

def test_with_override():
    app.dependency_overrides[get_db] = override_get_db
    response = client.get("/items/")
    assert response.json() == {"db": {"test": "database"}}
    app.dependency_overrides.clear()   # always clean up, or it leaks into other tests
```

## Gotchas

- **`TestClient` test functions must be synchronous** (`def test_x():`), even though the application under test is fully `async`. Never `await` a `TestClient` call.
- **Reach for `pytest-asyncio` only when testing an async helper function directly** (e.g. an async database function called outside the request cycle) — not for driving `TestClient` itself.
- **Always clear `app.dependency_overrides`** after a test that sets one, or the override leaks into unrelated tests run later in the same session.
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test test/framework-skill-packs.test.js`
Expected: PASS (all tests including the new `fastapi-code` one)

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/fastapi-code test/framework-skill-packs.test.js
git commit -m "feat: add fastapi-code skill (dependency injection, Pydantic v2, async/testing)"
```

---

### Task 3: `react-code` skill

**Files:**
- Create: `.claude/skills/react-code/SKILL.md`
- Create: `.claude/skills/react-code/references/hooks-and-state.md`
- Create: `.claude/skills/react-code/references/vite-and-testing.md`
- Test: `test/framework-skill-packs.test.js` (append)

**Sourcing for this task:** content fetched and verified this session from `https://react.dev/learn/synchronizing-with-effects` and `https://vite.dev/guide/env-and-mode`. The Vitest+React-Testing-Library section is scoped narrowly and flagged in the skill itself as the one part not backed by a fresh, detailed fetch this session (the official Vitest getting-started guide didn't cover React-specific setup) — it states only well-established, stable conventions (jsdom environment config, `@testing-library/react`'s `render`/`screen`, `act()` warnings) rather than anything version-specific or likely to have changed.

- [ ] **Step 1: Write the failing wiring test**

Append to `test/framework-skill-packs.test.js`:

```javascript
test('react-code skill exists with correct frontmatter and reference files', () => {
  const skillDir = path.join(__dirname, '..', '.claude', 'skills', 'react-code');
  const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: react-code\n/);
  assert.match(skill, /useEffect/);
  assert.strictEqual(fs.existsSync(path.join(skillDir, 'references', 'hooks-and-state.md')), true);
  assert.strictEqual(fs.existsSync(path.join(skillDir, 'references', 'vite-and-testing.md')), true);
  const hooks = fs.readFileSync(path.join(skillDir, 'references', 'hooks-and-state.md'), 'utf8');
  assert.match(hooks, /react\.dev\/learn\/synchronizing-with-effects/);
  const vite = fs.readFileSync(path.join(skillDir, 'references', 'vite-and-testing.md'), 'utf8');
  assert.match(vite, /vite\.dev\/guide\/env-and-mode/);
});

test('python-ai-agents, fastapi-code, and react-code packs all register skills that exist on disk', () => {
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  for (const key of ['python-ai-agents', 'fastapi-code', 'react-code']) {
    const entry = registry.packs.find((p) => p.key === key);
    for (const skillName of entry.skills) {
      assert.strictEqual(
        fs.existsSync(path.join(__dirname, '..', '.claude', 'skills', skillName, 'SKILL.md')),
        true,
        `expected .claude/skills/${skillName}/SKILL.md to exist`
      );
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/framework-skill-packs.test.js`
Expected: FAIL — `.claude/skills/react-code/SKILL.md` does not exist

- [ ] **Step 3: Write `SKILL.md`**

Create `.claude/skills/react-code/SKILL.md`:

```markdown
---
name: react-code
description: Build client-side React apps with Vite — useEffect cleanup and stale-closure bugs, dependency-array gotchas, Context vs. server-state libraries for API data, Vite environment variables, and testing with Vitest. Scoped to Vite+React client-side apps — NOT Next.js (App Router/Server Components/Server Actions need different guidance). Triggers on "useEffect", "React hook", "stale closure", "dependency array", "Vite env variable", "React Vitest testing".
---

# React (Vite, client-side)

Sources: https://react.dev/learn/synchronizing-with-effects, https://vite.dev/guide/env-and-mode (fetched 2026-07-07 — re-verify if this content seems stale).

**Scope note:** this skill covers Vite+React client-side SPA patterns. If the project is Next.js (App Router, Server Components, Server Actions), this content does not apply — that's a meaningfully different rendering model needing its own guidance, not covered here.

## Quick Reference

- `references/hooks-and-state.md` — `useEffect` cleanup functions, stale-closure bugs (including the classic fetch-race-condition), dependency-array gotchas, when to reach for Context vs. a server-state library for API data.
- `references/vite-and-testing.md` — Vite environment variables (`VITE_` prefix, `.env` file precedence), and Vitest/React Testing Library basics.

## Gotchas (do not skip)

- **A `useEffect` without a cleanup function leaks whatever it set up** — subscriptions, intervals, event listeners, connections. If the setup has a natural "undo" (`disconnect`, `unsubscribe`, `removeEventListener`, `clearInterval`), the effect needs a cleanup function that calls it.
- **React intentionally double-invokes effects in development (Strict Mode)** — setup → cleanup → setup again. This is deliberately surfacing real cleanup bugs, not a framework bug. If an effect breaks under double-invocation, the cleanup is incomplete.
- **Fetches inside `useEffect` can race** — a slow earlier request can resolve after a faster later one and overwrite it with stale data. Use an `ignore` flag set in the cleanup function to discard results from a superseded effect run (see `references/hooks-and-state.md`).
- **Objects/functions created inline are a new reference every render** — putting one directly in a dependency array causes the effect to re-run every render, not just when the "real" value changes. Move them outside the component or memoize them.
- **Only `VITE_`-prefixed environment variables reach client code.** Anything without that prefix is silently `undefined` in `import.meta.env` — this is a deliberate secret-leakage guard, not a bug to work around.

## Not Yet Covered Here (fetch before relying on these topics)

Next.js-specific rendering (Server Components, Server Actions, the App Router's data-fetching model) is explicitly out of scope for this skill — fetch `https://nextjs.org/docs` fresh rather than assuming Vite+React conventions transfer.
```

- [ ] **Step 4: Write `references/hooks-and-state.md`**

Create `.claude/skills/react-code/references/hooks-and-state.md`:

```markdown
# useEffect Cleanup, Stale Closures, and Dependency Arrays

Source: https://react.dev/learn/synchronizing-with-effects (fetched 2026-07-07 — re-verify if this content seems stale)

## Cleanup Functions — What and Why

A cleanup function is the optional value `useEffect`'s callback returns. It runs before the effect re-runs, and on unmount. Effects that create something (a subscription, a timer, a connection) almost always need a cleanup that undoes it:

| Setup | Cleanup |
|---|---|
| `connect()` | `disconnect()` |
| `subscribe()` | `unsubscribe()` |
| `addEventListener()` | `removeEventListener()` |
| `setInterval()` | `clearInterval()` |
| `showModal()` | `close()` |

```jsx
// Without cleanup — a new interval is created every time this effect re-runs,
// and the old one is never cleared.
useEffect(() => {
  const id = setInterval(() => setCount(c => c + 1), 1000);
}, []);

// With cleanup — correct.
useEffect(() => {
  const id = setInterval(() => setCount(c => c + 1), 1000);
  return () => clearInterval(id);
}, []);
```

## Stale-Closure Bug: the Fetch Race Condition

This is the single most common real-world `useEffect` bug:

```jsx
// BAD — a slow earlier request can resolve after a faster later one
useEffect(() => {
  fetchBio(person).then(result => {
    setBio(result);   // could be stale by the time this runs
  });
}, [person]);
```

Sequence: select "Alice" → fetch starts. Quickly select "Bob" → a second fetch starts. If Alice's slower response arrives *after* Bob's, the UI ends up showing Alice's bio while `person` state says "Bob".

```jsx
// GOOD — the cleanup function marks a superseded effect run as stale
useEffect(() => {
  let ignore = false;
  fetchBio(person).then(result => {
    if (!ignore) {
      setBio(result);
    }
  });
  return () => { ignore = true; };
}, [person]);
```

**Anti-pattern to avoid:** using a `ref` to skip re-running setup instead of writing a real cleanup function. This hides the underlying bug rather than fixing it — the connection/subscription never actually gets torn down when the component unmounts, it just avoids being *recreated*.

## Dependency Array Gotchas

- **Missing a dependency the effect actually reads** silently breaks the effect for that value's changes — e.g. an effect that reads `isPlaying` but has `[]` as its dependency array will never react to `isPlaying` changing again after mount.
- **Empty `[]` = run once on mount.** No array at all = run after *every* render. `[a, b]` = run on mount and whenever `a` or `b` changes. These are meaningfully different, not stylistic variants.
- **Inline objects/functions are a new reference every render.** `useEffect(() => subscribe(options), [options])` where `options = { timeout: 1000 }` is defined inline re-runs the effect every single render, because `options` is never `===` to the previous render's `options`. Move the object outside the component (if it's truly static) or otherwise avoid depending on a freshly-created reference each render.
- **Refs are stable across renders and are safe to omit** from the dependency array — including them is not wrong, but omitting them is the common convention since a ref's identity never changes.

## Context vs. a Server-State Library — Decision Rule

- **Local UI state that doesn't need to survive a refetch or be shared across unrelated parts of the tree** (a toggle, a form field, a modal's open/closed state): plain `useState`, or `useContext` if it needs to be shared a few levels down without prop-drilling.
- **Data that came from an API** (a list of items, a user profile fetched by ID): don't just stash it in Context and call it done. Context has no built-in caching, deduplication, revalidation, or loading/error state — you'd be reimplementing all of that by hand. A dedicated server-state library (e.g. TanStack Query) gives you caching, automatic refetch, and race-condition handling (the exact bug above) for free.
- **The dividing line:** if the data's source of truth lives on a server and the UI is a read-through cache of it, treat it as server state, not client state — even if it's technically stored in a `useState` somewhere.
```

- [ ] **Step 5: Write `references/vite-and-testing.md`**

Create `.claude/skills/react-code/references/vite-and-testing.md`:

```markdown
# Vite Environment Variables and Testing with Vitest

Source: https://vite.dev/guide/env-and-mode (fetched 2026-07-07 — re-verify if this content seems stale). The Vitest/React Testing Library section below states only long-stable, version-independent conventions — it was not backed by a detailed fresh fetch this session (the official Vitest getting-started guide doesn't cover React-specific setup); verify against `https://testing-library.com/docs/react-testing-library/intro/` if anything here seems off.

## Environment Variables

Vite exposes env data via `import.meta.env`, statically replaced at build time (which is what makes tree-shaking of unused branches work):

```js
if (import.meta.env.DEV) {
  console.log('dev mode');
}
```

Built-in constants: `import.meta.env.MODE`, `.BASE_URL`, `.PROD`, `.DEV`, `.SSR`.

**Only `VITE_`-prefixed variables reach client code** — this is a deliberate guard against accidentally bundling secrets into client-shipped JavaScript:

```
# .env
VITE_PUBLIC_KEY=abc123
SECRET_API_KEY=confidential
```

```js
import.meta.env.VITE_PUBLIC_KEY  // "abc123"
import.meta.env.SECRET_API_KEY   // undefined — not exposed
```

## `.env` File Precedence (later overrides earlier)

1. `.env` — all contexts
2. `.env.local` — all contexts, git-ignored
3. `.env.[mode]` — mode-specific (e.g. `.env.staging`)
4. `.env.[mode].local` — mode-specific, git-ignored

## Gotchas

- **Env values are strings.** A variable set to `"false"` is still a truthy non-empty string in JS — convert explicitly (`import.meta.env.VITE_FLAG === "true"`), don't rely on implicit boolean coercion.
- **Changing `.env` requires a dev-server restart** — values are read once at startup, not watched for changes.
- **`NODE_ENV` and Vite's `mode` are separate concepts.** A production build can still run under a custom mode (e.g. `vite build --mode staging`), and mode-specific `.env` files are keyed by that mode name, not by `NODE_ENV`.
- **Add a `vite-env.d.ts`** to get TypeScript IntelliSense for custom `VITE_*` variables without losing type safety on the rest of `import.meta.env`.

## Testing with Vitest + React Testing Library (established conventions)

Vitest reads the project's existing `vite.config.*` by default, so Vite plugins/aliases already configured for the app apply to tests too. For component tests, configure the `jsdom` (or `happy-dom`) test environment — either globally in `vite.config.ts`'s `test.environment` field, or per-file with a `// @vitest-environment jsdom` comment.

```jsx
import { render, screen } from '@testing-library/react';
import { test, expect } from 'vitest';
import { Greeting } from './Greeting';

test('renders a greeting', () => {
  render(<Greeting name="Ada" />);
  expect(screen.getByText('Hello, Ada')).toBeInTheDocument();
});
```

**Common gotchas:**
- State updates triggered outside of an explicit user-interaction helper (e.g. a `useEffect` firing after mount) can produce an `act()` warning if not awaited — prefer `@testing-library/user-event` for interactions and `findBy*`/`waitFor` queries (which internally wrap updates in `act()`) over manually triggering DOM events.
- Query by role/text/label (`getByRole`, `getByText`) rather than by test IDs or CSS selectors where practical — it more closely matches how a user actually perceives the UI, and is more resilient to markup refactors that don't change behavior.
- Async data fetching in a component under test needs an async query (`findByText`, or `await waitFor(...)`) — a synchronous `getByText` immediately after `render()` will not see data that arrives after a fetch resolves.
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test test/framework-skill-packs.test.js`
Expected: PASS (all tests including the two new ones)

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/react-code test/framework-skill-packs.test.js
git commit -m "feat: add react-code skill (hooks/effects, Vite env vars, testing)"
```

---

### Task 4: Auto-attach wiring in `/scaffold` Step 2

**Files:**
- Modify: `.claude/commands/scaffold.md` (Step 2 section)
- Test: `test/scaffold-vertical-composition.test.js` (append) — reusing this file rather than creating a new one, since it already holds the precedent wiring test for `scaffold.md`'s Step 1/Step 2 prose (see the existing test asserting the Step-1 domain-vertical wiring)

**Interfaces:**
- Consumes: `frameworkPacks` field convention established by `python-ai-agents` (Plan B) — `profile.frameworkPacks` (camelCase, input) → `manifest.framework_skill_packs` (snake_case, output via `scaffold-render.js`).
- Produces: no new code interface — a prose instruction read by the `/scaffold`-executing agent, plus a `copyFrameworkPackSkills` integration test proving the mechanism (not the inference) works.

- [ ] **Step 1: Write the failing tests**

Append to `test/scaffold-vertical-composition.test.js`:

```javascript
test('scaffold.md Step 2 auto-attaches fastapi-code and react-code based on the chosen stack', () => {
  const scaffoldMd = fs.readFileSync(
    path.join(__dirname, '..', '.claude', 'commands', 'scaffold.md'), 'utf8'
  );
  const step2Index = scaffoldMd.indexOf('## Step 2: Generate project-manifest.json');
  const step3Index = scaffoldMd.indexOf('## Step 3');
  assert.ok(step2Index > -1, 'expected Step 2 heading in scaffold.md');
  assert.ok(step3Index > step2Index, 'expected Step 3 to follow Step 2');
  const step2Section = scaffoldMd.slice(step2Index, step3Index);
  assert.match(step2Section, /fastapi-code/);
  assert.match(step2Section, /react-code/);
  assert.match(step2Section, /stack\.backend\.framework/);
  assert.match(step2Section, /stack\.frontend\.framework/);
  assert.match(step2Section, /nextjs/);
});

test('copyFrameworkPackSkills copies fastapi-code when selected via an auto-attached frameworkPacks entry', () => {
  const { copyFrameworkPackSkills } = require(
    path.join(__dirname, '..', '.claude', 'scripts', 'scaffold-copy.js')
  );
  const src = path.join(__dirname, '..');
  const target = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fastapi-attach-'));
  // Simulates what Step 2's auto-attach rule produces for a FastAPI-backend profile:
  // frameworkPacks includes "fastapi-code" even though the user never answered a
  // separate framework-pack question about it.
  copyFrameworkPackSkills(src, target, ['fastapi-code', 'react-code']);
  assert.strictEqual(fs.existsSync(path.join(target, '.claude', 'skills', 'fastapi-code', 'SKILL.md')), true);
  assert.strictEqual(fs.existsSync(path.join(target, '.claude', 'skills', 'react-code', 'SKILL.md')), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scaffold-vertical-composition.test.js`
Expected: the first new test FAILs (scaffold.md's Step 2 doesn't mention `fastapi-code`/`react-code` yet); the second new test currently PASSes already (since `copyFrameworkPackSkills` is generic and Task 1-3 already created the registry entries and skill files) — this is expected and fine, it's here as a regression guard for later, not a RED-first test for this task.

- [ ] **Step 3: Write the implementation**

In `.claude/commands/scaffold.md`, find the `## Step 2: Generate project-manifest.json` section (search for that exact heading) and its introductory content (`Based on their answers, write project-manifest.json to the project root. Fill in:` followed by a bulleted list). Insert this new subsection immediately after that introductory bulleted list, before the next `##` heading (`## Step 3`):

```markdown
### Auto-attach stack-matched specialty packs

After the interview, before assembling `frameworkPacks` for the profile: if `stack.backend.framework` is `"fastapi"`, include `"fastapi-code"` in `frameworkPacks`. If `stack.frontend.framework` is `"react"` (the Vite variant — Presets A and C; **not** `"nextjs"`, Preset B), include `"react-code"`. These are additive to any AI-agent packs the user explicitly selected in the tech-stack-pack question (Step 1.E Q7) — a project can end up with any combination of `python-ai-agents`, `fastapi-code`, `react-code`, `langchain`, `google-adk` in `frameworkPacks`. Neither of these two additions requires a new question or a new confirmation-card line — they follow silently from the stack the user already chose.
```

**Note:** read the exact current text of the Step 2 introductory bullet list first (it may not be word-for-word what's paraphrased above) — insert the new subsection based on its actual heading structure, not a guessed line number.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/scaffold-vertical-composition.test.js`
Expected: PASS (both new tests, plus all pre-existing ones)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests pass (baseline before this task, after Tasks 1-3: whatever `npm test` reports at that point, plus the tests added in this task)

- [ ] **Step 6: Commit**

```bash
git add .claude/commands/scaffold.md test/scaffold-vertical-composition.test.js
git commit -m "feat: auto-attach fastapi-code/react-code to /scaffold based on chosen stack"
```

---

### Task 5: Full-suite verification

**Files:** none created or modified — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including every test added in Tasks 1-4

- [ ] **Step 2: Manual smoke check — auto-attach end-to-end via `scaffold-apply.js`, on BOTH `core` and `full` profiles**

**Important:** check `core`, not just `full`. A prior bug in `copyFrameworkPackSkills` (fixed separately, see `git log --oneline -- .claude/scripts/scaffold-copy.js`) was masked for months because every manual check only used the `full` profile — `copyScaffoldTree`'s wholesale directory copy ships every skill regardless of the registry for that profile, so it can look correct even when the actual pack-copy mechanism is broken. Always check `core` (or `brownfield`) too, where only the registry-driven copy path is exercised.

```bash
cat > /tmp/fastapi-react-smoke-profile.json <<'EOF'
{
  "name": "smoke-test-fastapi-react",
  "description": "manual smoke check",
  "frameworkPacks": ["fastapi-code", "react-code"],
  "stack": {
    "backend": { "language": "python", "version": "3.12", "framework": "fastapi", "package_manager": "uv" },
    "frontend": { "language": "typescript", "framework": "react", "package_manager": "npm" }
  }
}
EOF

TMPDIR_CORE=$(mktemp -d)
node .claude/scripts/scaffold-apply.js --profile /tmp/fastapi-react-smoke-profile.json --plugin-source "$(pwd)/.claude" --target "$TMPDIR_CORE" --scaffold-profile core
ls "$TMPDIR_CORE/.claude/skills/fastapi-code/SKILL.md"
ls "$TMPDIR_CORE/.claude/skills/react-code/SKILL.md"

TMPDIR_FULL=$(mktemp -d)
node .claude/scripts/scaffold-apply.js --profile /tmp/fastapi-react-smoke-profile.json --plugin-source "$(pwd)/.claude" --target "$TMPDIR_FULL" --scaffold-profile full
ls "$TMPDIR_FULL/.claude/skills/fastapi-code/SKILL.md"
ls "$TMPDIR_FULL/.claude/skills/react-code/SKILL.md"
```

Expected: both `SKILL.md` paths exist in **both** targets — confirms the mechanism works end-to-end for a FastAPI+React profile on the profile where the registry-driven copy path is actually exercised (`core`), not only the profile where it would be masked (`full`). Uses `frameworkPacks` values that Step 2's new auto-attach rule would have produced (this manual check drives `scaffold-apply.js` directly with a hand-built profile, since the auto-attach *inference* itself is `/scaffold`-agent prose, not something a script invocation exercises).

- [ ] **Step 3: Commit any final cleanup (only if Step 1 or 2 surfaced something to fix)**

If all tests passed and the manual check matched expectations, there is nothing to commit here — Tasks 1-4 already committed everything.
