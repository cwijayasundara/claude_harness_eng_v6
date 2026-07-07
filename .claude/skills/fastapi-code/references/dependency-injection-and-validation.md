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
