"""Integration tests for `GET /healthz`.

Exercises the real FastAPI app (`src.main.app`) through `httpx.AsyncClient`
over an ASGI transport — the "outcomes" seam for E6-S1 (health check
handler -> `repository/db.py` connectivity probe, per test-plan.md).
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient, Response
from src.main import app


async def _get_healthz() -> Response:
    # ASGITransport calls the in-process ASGI app directly — no real network
    # I/O — so the placeholder base_url below is not a live external call.
    transport = ASGITransport(app=app)
    base_url = "http://test"  # harness:live-ok
    async with AsyncClient(transport=transport, base_url=base_url) as client:
        return await client.get("/healthz")


@pytest.mark.asyncio
async def test_healthz_reachable_db_returns_200() -> None:
    """AC1 / VM-030: a reachable database -> 200 with the ok body."""
    response = await _get_healthz()

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "reachable"}


@pytest.mark.asyncio
async def test_healthz_unreachable_db_returns_503(monkeypatch: pytest.MonkeyPatch) -> None:
    """AC2 / VM-031: an unreachable database -> 503 with the unavailable body.

    Monkeypatches `check_db_reachable` as bound in `src.api.health` — the
    one true external boundary (the DB connection) per code-gen/SKILL.md's
    "mock only external boundaries" rule, not business logic.
    """

    async def _unreachable() -> bool:
        return False

    monkeypatch.setattr("src.api.health.check_db_reachable", _unreachable)

    response = await _get_healthz()

    assert response.status_code == 503
    assert response.json() == {"status": "unavailable", "database": "unreachable"}


@pytest.mark.asyncio
async def test_healthz_requires_no_auth_and_returns_json_health_body() -> None:
    """AC3 / VM-032: no session cookie/auth header is sent, yet the request
    succeeds and the JSON body describes status/database."""
    transport = ASGITransport(app=app)
    base_url = "http://test"  # harness:live-ok
    async with AsyncClient(transport=transport, base_url=base_url) as client:
        assert len(client.cookies) == 0
        response = await client.get("/healthz")

    assert response.status_code == 200
    body = response.json()
    assert set(body.keys()) == {"status", "database"}
    assert body["status"] == "ok"
    assert body["database"] == "reachable"
