"""Integration tests for `POST /auth/register` and `POST /auth/sign-in`.

Exercises the real FastAPI app (`src.main.app`) through `httpx.AsyncClient`
over an ASGI transport, against the real Postgres-backed repositories (see
`tests/conftest.py`) — the "outcomes" seam for E1-S1.
"""

from __future__ import annotations

import logging
import uuid

import pytest
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient, Response
from src.api.deps import require_session
from src.main import app
from src.types.models import Member

PASSWORD = "correct horse battery staple"


def _unique_email() -> str:
    return f"member-{uuid.uuid4()}@example.com"


def _build_protected_app() -> FastAPI:
    """A test-only app exercising the real `require_session` dependency.

    Proves AC1's "subsequent authenticated request succeeds" without adding
    a production endpoint outside the frozen `api-contracts.md` surface.
    """
    protected_app = FastAPI()

    @protected_app.get("/__test__/protected")
    async def protected(member: Member = Depends(require_session)) -> dict[str, str]:
        return {"email": member.email}

    return protected_app


async def _post(path: str, body: dict[str, str]) -> Response:
    # ASGITransport calls the in-process ASGI app directly — no real network
    # I/O — so the placeholder base_url below is not a live external call.
    transport = ASGITransport(app=app)
    base_url = "http://test"  # harness:live-ok
    async with AsyncClient(transport=transport, base_url=base_url) as client:
        return await client.post(path, json=body)


async def _register(email: str, password: str = PASSWORD) -> Response:
    return await _post("/auth/register", {"email": email, "password": password})


async def _sign_in(email: str, password: str = PASSWORD) -> Response:
    return await _post("/auth/sign-in", {"email": email, "password": password})


def _assert_cookie_attributes(set_cookie: str) -> None:
    lowered = set_cookie.lower()
    assert "httponly" in lowered
    assert "samesite=lax" in lowered
    assert "secure" in lowered


async def _assert_cookie_authenticates(session_id: str, expected_email: str) -> None:
    protected_app = _build_protected_app()
    # See _post's comment above: this is the same in-process ASGI transport.
    async with AsyncClient(
        transport=ASGITransport(app=protected_app),
        base_url="http://test",  # harness:live-ok
        cookies={"session_id": session_id},
    ) as protected_client:
        protected_response = await protected_client.get("/__test__/protected")

    assert protected_response.status_code == 200
    assert protected_response.json()["email"] == expected_email


@pytest.mark.asyncio
async def test_sign_in_sets_cookie_and_authenticates_subsequent_request() -> None:
    """AC1 / VM-001."""
    email = _unique_email()
    await _register(email)

    sign_in_response = await _sign_in(email)

    assert sign_in_response.status_code == 200
    set_cookie = sign_in_response.headers.get("set-cookie")
    assert set_cookie is not None
    _assert_cookie_attributes(set_cookie)

    session_id = sign_in_response.cookies.get("session_id")
    assert session_id is not None
    await _assert_cookie_authenticates(session_id, email)


@pytest.mark.asyncio
async def test_register_response_carries_no_secret_and_credential_verifies() -> None:
    """AC2 / VM-002: response shape carries no secret, and the stored value
    is verifiable (sign-in with the same credentials succeeds), not a
    rejected or plaintext-compared value."""
    email = _unique_email()

    register_response = await _register(email)

    assert register_response.status_code == 201
    body = register_response.json()
    assert set(body.keys()) == {"id", "email", "createdAt"}
    assert body["email"] == email

    raw_body = register_response.text
    assert "password" not in raw_body
    assert "password_hash" not in raw_body
    assert "$argon2id$" not in raw_body
    assert PASSWORD not in raw_body

    sign_in_response = await _sign_in(email)
    assert sign_in_response.status_code == 200


@pytest.mark.asyncio
async def test_register_duplicate_email_returns_409() -> None:
    """Contract: POST /auth/register -> 409 ErrorBody when email is taken."""
    email = _unique_email()
    await _register(email)

    response = await _register(email)

    assert response.status_code == 409
    assert response.json() == {"error": "email_already_registered"}


@pytest.mark.asyncio
async def test_register_and_sign_in_never_log_secrets(caplog: pytest.LogCaptureFixture) -> None:
    """AC3 / VM-003."""
    email = _unique_email()

    with caplog.at_level(logging.DEBUG):
        await _register(email)
        await _sign_in(email)

    log_text = "\n".join(record.getMessage() for record in caplog.records)
    assert PASSWORD not in log_text
    assert "$argon2id$" not in log_text


@pytest.mark.asyncio
async def test_sign_in_unregistered_email_returns_401_with_no_cookie() -> None:
    """AC4 / VM-004."""
    response = await _sign_in(_unique_email())

    assert response.status_code == 401
    assert response.headers.get("set-cookie") is None
    assert response.json() == {"error": "invalid_credentials"}


@pytest.mark.asyncio
async def test_sign_in_wrong_password_returns_401_with_no_cookie() -> None:
    """AC4 / VM-004."""
    email = _unique_email()
    await _register(email)

    response = await _sign_in(email, password="wrong password")

    assert response.status_code == 401
    assert response.headers.get("set-cookie") is None
    assert response.json() == {"error": "invalid_credentials"}
