"""Postgres access for Member rows. Never imports services/ or api/."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, String, Uuid, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from src.repository.db import Base
from src.types.models import Member


class MemberRow(Base):
    """ORM row for the `members` table."""

    __tablename__ = "members"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


def _to_domain(row: MemberRow) -> Member:
    return Member(
        id=row.id,
        email=row.email,
        password_hash=row.password_hash,
        created_at=row.created_at,
    )


async def create(db: AsyncSession, member: Member) -> Member:
    """Insert a new Member row and return the domain model."""
    row = MemberRow(
        id=member.id,
        email=member.email,
        password_hash=member.password_hash,
        created_at=member.created_at,
    )
    db.add(row)
    await db.commit()
    return _to_domain(row)


async def get_by_email(db: AsyncSession, email: str) -> Member | None:
    """Look up a Member by email, or None if unregistered."""
    result = await db.execute(select(MemberRow).where(MemberRow.email == email))
    row = result.scalar_one_or_none()
    return _to_domain(row) if row is not None else None


async def get_by_id(db: AsyncSession, member_id: UUID) -> Member | None:
    """Look up a Member by id, or None if it does not exist."""
    row = await db.get(MemberRow, member_id)
    return _to_domain(row) if row is not None else None
