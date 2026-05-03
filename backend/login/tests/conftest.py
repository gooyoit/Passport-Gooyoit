"""Test fixtures."""

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.db.session import Base, get_db
from app.main import app
from app import models  # noqa: F401


@pytest.fixture()
def db_session() -> Generator[Session, None, None]:
    """Create an isolated schema in the configured real test database."""
    if not settings.test_database_url:
        raise RuntimeError("TEST_DATABASE_URL must be configured for tests")
    engine = create_engine(settings.test_database_url, pool_pre_ping=True)
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
    """Create a FastAPI test client with DB override."""
    settings.debug = True
    settings.cookie_secure = False

    def override_get_db() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def admin_headers() -> dict[str, str]:
    """Return admin auth headers using client credentials.

    TODO: Replace with proper client_id/client_secret based auth
    when admin API endpoints are refactored to use OAuth instead of X-Admin-Token.
    """
    return {"X-Admin-Token": "dev-admin-token"}
