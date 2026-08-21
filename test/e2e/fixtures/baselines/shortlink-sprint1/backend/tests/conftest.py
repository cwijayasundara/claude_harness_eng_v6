"""Session-scoped real Postgres fixture.

Per code-gen/SKILL.md Testing Rules: mock only true externals, never
SQLAlchemy/business logic. This starts a throwaway local Postgres cluster
(via the `postgresql@15` binaries already on this machine) on a free port,
isolated from any `.env` file, and points `DATABASE_URL` at it in
`pytest_configure` — which runs before test collection/import, since
`src.*` modules build their engine/settings at import time.
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import tempfile
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

_PG_BIN = Path("/opt/homebrew/opt/postgresql@15/bin")
_data_dir: Path | None = None


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]  # type: ignore[no-any-return]


def _init_cluster(data_dir: Path) -> None:
    subprocess.run(
        [str(_PG_BIN / "initdb"), "-D", str(data_dir), "-U", "postgres", "-A", "trust"],
        check=True,
        capture_output=True,
    )


def _start_cluster(data_dir: Path, port: int) -> None:
    # pg_ctl forks a detached postgres daemon whose long-lived background
    # workers (checkpointer, walwriter, ...) inherit any pipe fd handed to
    # the pg_ctl subprocess. `capture_output=True` would hang forever
    # waiting for EOF on a pipe those workers keep open indefinitely, so
    # this call is redirected to /dev/null instead of piped.
    with open(os.devnull, "wb") as devnull:
        subprocess.run(
            [
                str(_PG_BIN / "pg_ctl"),
                "-D",
                str(data_dir),
                "-o",
                f"-p {port} -k {data_dir} -c listen_addresses=''",
                "-w",
                "start",
            ],
            check=True,
            stdout=devnull,
            stderr=devnull,
        )


def _create_database(data_dir: Path, port: int) -> None:
    subprocess.run(
        [
            str(_PG_BIN / "createdb"),
            "-h",
            str(data_dir),
            "-p",
            str(port),
            "-U",
            "postgres",
            "shortlink_test",
        ],
        check=True,
        capture_output=True,
    )


def pytest_configure(config: pytest.Config) -> None:
    """Start an isolated Postgres cluster before any test module is imported."""
    global _data_dir
    _data_dir = Path(tempfile.mkdtemp(prefix="shortlink-test-pg-"))
    port = _free_port()
    _init_cluster(_data_dir)
    _start_cluster(_data_dir, port)
    _create_database(_data_dir, port)
    os.environ["DATABASE_URL"] = (
        f"postgresql+asyncpg://postgres@/shortlink_test?host={_data_dir}&port={port}"
    )
    os.environ["SESSION_COOKIE_NAME"] = "session_id"


def pytest_unconfigure(config: pytest.Config) -> None:
    """Stop and remove the throwaway Postgres cluster."""
    if _data_dir is None:
        return
    subprocess.run(
        [str(_PG_BIN / "pg_ctl"), "-D", str(_data_dir), "-m", "immediate", "stop"],
        capture_output=True,
    )
    shutil.rmtree(_data_dir, ignore_errors=True)


@pytest.fixture(scope="session")
async def _schema_ready() -> None:
    """Create all ORM tables once, before the first test runs.

    Runs on the same (session-scoped) event loop as every async test and
    fixture below, so the engine's connection pool is never split across
    event loops (see pyproject.toml's `asyncio_default_*_loop_scope`).
    """
    from src.repository.db import Base, engine
    from src.repository.member_repository import MemberRow  # noqa: F401
    from src.repository.session_repository import SessionRow  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


@pytest.fixture(autouse=True)
async def _clean_tables(_schema_ready: None) -> AsyncIterator[None]:
    """Truncate all tables between tests so no test observes another's data."""
    from sqlalchemy import delete
    from src.repository.db import async_session_factory
    from src.repository.member_repository import MemberRow
    from src.repository.session_repository import SessionRow

    yield
    async with async_session_factory() as db:
        await db.execute(delete(SessionRow))
        await db.execute(delete(MemberRow))
        await db.commit()
