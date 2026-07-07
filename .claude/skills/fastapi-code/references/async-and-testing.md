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
