"""Unit coverage for auth_service, called through its public interface.

Covers VM-002 (unit half: stored hash begins with `$argon2id$`) and the
unit half of VM-003 (the logging_config redaction filter, in isolation).
"""

from __future__ import annotations

import logging

import pytest
from src.logging_config import RedactHashFilter
from src.services.auth_service import (
    EmailAlreadyRegistered,
    InvalidCredentials,
    NoActiveSession,
    get_current_member,
    register,
    sign_in,
)


@pytest.mark.asyncio
async def test_register_returns_member_with_argon2id_hash() -> None:
    """VM-002 (unit): the stored credential begins with `$argon2id$`."""
    member = await register("alice@example.com", "correct-horse-battery-staple")

    assert member.email == "alice@example.com"
    assert member.password_hash.startswith("$argon2id$")


@pytest.mark.asyncio
async def test_register_rejects_duplicate_email() -> None:
    await register("bob@example.com", "first-password")

    with pytest.raises(EmailAlreadyRegistered):
        await register("bob@example.com", "second-password")


@pytest.mark.asyncio
async def test_sign_in_with_correct_credentials_returns_member_and_session() -> None:
    """Registering then signing in proves the stored hash is verifiable, not
    a rejected or plaintext-compared value (the other half of VM-002)."""
    registered = await register("carol@example.com", "correct-horse-battery-staple")

    member, session = await sign_in("carol@example.com", "correct-horse-battery-staple")

    assert member.id == registered.id
    assert session.member_id == member.id
    assert session.revoked_at is None


@pytest.mark.asyncio
async def test_sign_in_rejects_unregistered_email() -> None:
    with pytest.raises(InvalidCredentials):
        await sign_in("nobody@example.com", "whatever")


@pytest.mark.asyncio
async def test_sign_in_rejects_wrong_password() -> None:
    await register("dave@example.com", "the-real-password")

    with pytest.raises(InvalidCredentials):
        await sign_in("dave@example.com", "a-wrong-password")


@pytest.mark.asyncio
async def test_get_current_member_resolves_active_session() -> None:
    registered = await register("erin@example.com", "correct-horse-battery-staple")
    _member, session = await sign_in("erin@example.com", "correct-horse-battery-staple")

    resolved = await get_current_member(session.id)

    assert resolved.id == registered.id


@pytest.mark.asyncio
async def test_get_current_member_rejects_missing_session_id() -> None:
    with pytest.raises(NoActiveSession):
        await get_current_member(None)


def test_redact_hash_filter_strips_argon2id_hash_from_log_record() -> None:
    """Unit half of VM-003: a defense-in-depth backstop that strips any
    `$argon2id$...` substring from a log record before it is emitted."""
    hash_value = "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$aGFzaGVkdmFsdWU"
    record = logging.LogRecord(
        name="test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="member registered with hash %s",
        args=(hash_value,),
        exc_info=None,
    )

    RedactHashFilter().filter(record)

    assert hash_value not in record.getMessage()
    assert "[REDACTED]" in record.getMessage()
