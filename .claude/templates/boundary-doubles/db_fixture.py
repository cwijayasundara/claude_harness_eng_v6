"""Transactional-isolation DB fixture (boundary-test-doubles kit, gap G34).

Keeps a REAL engine (honoring test-strategy.md's "real DB" doctrine) but wraps
each test in a transaction rolled back at teardown, against a deterministic seed —
fast and deterministic without a fake engine. In-memory SQLite is an approved fast
path when TEST_DATABASE_URL is unset. Requires the project's SQLAlchemy stack.
"""
import os
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


def _engine_url() -> str:
    return os.environ.get("TEST_DATABASE_URL", "sqlite+pysqlite:///:memory:")


@pytest.fixture
def db_session(seed):
    """`seed` is a project-provided fixture: callable(session) -> None."""
    engine = create_engine(_engine_url())
    connection = engine.connect()
    trans = connection.begin()
    Session = sessionmaker(bind=connection)
    session = Session()
    seed(session)
    try:
        yield session
    finally:
        session.close()
        trans.rollback()
        connection.close()
