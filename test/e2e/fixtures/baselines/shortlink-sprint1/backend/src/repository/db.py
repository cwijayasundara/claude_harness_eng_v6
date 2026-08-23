"""Async SQLAlchemy engine/session factory.

Async driver only (`postgresql+asyncpg://`) — a sync driver in an async
request handler is both a correctness and a latency bug (code-gen/SKILL.md
Performance & Latency). Kept minimal: engine, session factory, `get_db()`,
and `check_db_reachable()` (story E6-S1's connectivity probe).
"""

import asyncio
from collections.abc import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from src.config.settings import settings


class Base(DeclarativeBase):
    """Declarative base for repository-layer ORM row models."""


engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True)

async_session_factory = async_sessionmaker(engine, expire_on_commit=False)

_HEALTH_CHECK_TIMEOUT_SECONDS = 2.0


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI-dependency-injectable async session, one per request."""
    async with async_session_factory() as session:
        yield session


async def _select_one() -> None:
    async with engine.connect() as connection:
        await connection.execute(text("SELECT 1"))


async def check_db_reachable() -> bool:
    """Probe the database with a short-timeout `SELECT 1`.

    Returns `True` if the connection and query succeed within
    `_HEALTH_CHECK_TIMEOUT_SECONDS`, `False` on any connection failure or
    timeout. Never raises — a hung/unreachable DB must not hang the caller.
    """
    try:
        await asyncio.wait_for(_select_one(), timeout=_HEALTH_CHECK_TIMEOUT_SECONDS)
    except (SQLAlchemyError, OSError, TimeoutError):
        return False
    return True
