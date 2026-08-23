"""Business rules for registration, sign-in, and session lookup.

Never imports api/. `sign_out` is story E1-S2's addition; this module is
deliberately structured (typed errors + a single unit-of-work session per
call) so that adding it later does not require reshaping anything here.
"""

import asyncio
from datetime import UTC, datetime
from uuid import UUID, uuid4

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from src.repository import member_repository, session_repository
from src.repository.db import async_session_factory
from src.types.models import Member
from src.types.models import Session as SessionModel

# Hoisted to module scope: PasswordHasher does its own expensive parameter
# setup; recreating it per request would be wasted CPU on every request.
_password_hasher = PasswordHasher()


class EmailAlreadyRegistered(Exception):
    """Raised by `register` when the email already has a Member row."""


class InvalidCredentials(Exception):
    """Raised by `sign_in` for an unregistered email OR a wrong password."""


class NoActiveSession(Exception):
    """Raised by `get_current_member` when no session cookie, or the
    session is revoked or (if ever set) expired."""


async def register(email: str, password: str) -> Member:
    """Create a Member with an Argon2id-hashed password.

    Raises EmailAlreadyRegistered if the email already has a Member row.
    """
    # Argon2id hashing is deliberately CPU-heavy; run it off the event loop
    # so it never stalls other concurrent requests (code-gen/SKILL.md
    # Performance & Latency: never block the event loop on a hot path).
    normalized_email = email.lower()
    password_hash = await asyncio.to_thread(_password_hasher.hash, password)
    async with async_session_factory() as db:
        existing = await member_repository.get_by_email(db, normalized_email)
        if existing is not None:
            raise EmailAlreadyRegistered(normalized_email)
        member = Member(
            id=uuid4(),
            email=normalized_email,
            password_hash=password_hash,
            created_at=datetime.now(UTC),
        )
        return await member_repository.create(db, member)


async def sign_in(email: str, password: str) -> tuple[Member, SessionModel]:
    """Verify credentials and open a new Session.

    Raises InvalidCredentials for an unregistered email OR a wrong password
    — same error, same status, so no response ever reveals which failed.
    """
    normalized_email = email.lower()
    async with async_session_factory() as db:
        member = await member_repository.get_by_email(db, normalized_email)
        if member is None:
            raise InvalidCredentials()
        try:
            await asyncio.to_thread(_password_hasher.verify, member.password_hash, password)
        except VerifyMismatchError as exc:
            raise InvalidCredentials() from exc
        new_session = SessionModel(
            id=uuid4(),
            member_id=member.id,
            created_at=datetime.now(UTC),
            expires_at=None,
            revoked_at=None,
        )
        created_session = await session_repository.create(db, new_session)
        return member, created_session


async def get_current_member(session_id: UUID | None) -> Member:
    """Resolve the Member behind an active Session id.

    Raises NoActiveSession when the id is missing, revoked, or has no
    matching Session/Member row.
    """
    if session_id is None:
        raise NoActiveSession()
    async with async_session_factory() as db:
        active_session = await session_repository.get_active(db, session_id)
        if active_session is None:
            raise NoActiveSession()
        member = await member_repository.get_by_id(db, active_session.member_id)
        if member is None:
            raise NoActiveSession()
        return member
