# Architecture reference — Python / FastAPI

Conventions for designing a FastAPI backend's structure, contracts, and schemas. Use when planning architecture for a Python stack.

- **Layering** (one-way deps; the `verify-on-save` hook enforces this at impl time): `api/` (routers) → `service/` (business logic) → `repository/` (data access) → `types/` + `config/`. Routers thin; no business logic in routers; no DB access outside the repository.
- **Project layout**: `src/` package layout, `uv` deps in `pyproject.toml`, `__init__.py` per package, settings via `pydantic-settings` (`Settings` reading env), app factory (`create_app()`), routers via `APIRouter` mounted with prefixes/tags.
- **Contracts are Pydantic v2 models** = the API surface. Each endpoint declares a request model and a `response_model`; these map 1:1 to entries in `api-contracts.schema.json`. Reuse models across layers via `from_attributes`.
- **Data models**: SQLAlchemy (async) or the chosen ORM in `repository/`; entities mirror `data-models.schema.json` (fields, types, constraints, relationships). Migrations via Alembic — plan a migration story whenever schema changes.
- **Errors**: a small set of domain exceptions mapped to HTTP via exception handlers; document status codes per endpoint in the architecture doc.
- **Async**: async routes + async DB sessions injected via `Depends`; no blocking I/O in the event loop.
- **Component map**: assign each story to files within these layers; mark `Produces:`/`Consumes:` at the Pydantic-model boundary so downstream stories code against a typed contract.
