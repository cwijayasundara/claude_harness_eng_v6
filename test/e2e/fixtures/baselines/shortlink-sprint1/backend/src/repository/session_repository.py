"""Postgres access for Session rows. Never imports services/ or api/."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Uuid, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from src.repository.db import Base
from src.types.models import Session


class SessionRow(Base):
    """ORM row for the `sessions` table."""

    __tablename__ = "sessions"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    member_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("members.id"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


def _to_domain(row: SessionRow) -> Session:
    return Session(
        id=row.id,
        member_id=row.member_id,
        created_at=row.created_at,
        expires_at=row.expires_at,
        revoked_at=row.revoked_at,
    )


async def create(db: AsyncSession, session: Session) -> Session:
    """Insert a new Session row and return the domain model."""
    row = SessionRow(
        id=session.id,
        member_id=session.member_id,
        created_at=session.created_at,
        expires_at=session.expires_at,
        revoked_at=session.revoked_at,
    )
    db.add(row)
    await db.commit()
    return _to_domain(row)


async def get_active(db: AsyncSession, session_id: UUID) -> Session | None:
    """Look up a not-revoked Session by id, or None if absent/revoked."""
    result = await db.execute(
        select(SessionRow).where(SessionRow.id == session_id, SessionRow.revoked_at.is_(None))
    )
    row = result.scalar_one_or_none()
    return _to_domain(row) if row is not None else None
