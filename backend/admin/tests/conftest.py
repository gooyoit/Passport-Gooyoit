"""Test fixtures."""

import re
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings
from app.db.session import get_db
from app.deps import require_admin, require_super_admin
from app.main import app
from app.models import Base
from app import models  # noqa: F401


def _test_database_url() -> str:
    """Point the configured database URL at the isolated passport_test schema."""
    return re.sub(r"/[^/?]+(\?|$)", "/passport_test\\1", settings.database_url)


@pytest.fixture()
def db_session() -> Generator[Session, None, None]:
    """Create an isolated schema in the configured real test database."""
    engine = create_engine(_test_database_url(), pool_pre_ping=True)
    TestingSessionLocal = sessionmaker(
        bind=engine,
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
    )
    Base.metadata.create_all(bind=engine)

    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


@pytest.fixture()
def client(db_session: Session) -> Generator[TestClient, None, None]:
    """Create a FastAPI test client with DB and admin-auth overrides."""
    settings.debug = True

    def override_get_db() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[require_admin] = lambda: 1
    app.dependency_overrides[require_super_admin] = lambda: 1
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
