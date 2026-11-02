"""Test fixtures."""

import re
import secrets
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.core.security import hash_secret
from app.db.session import Base, get_db
from app.main import app
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


class FakeRedis:
    """In-memory redis double covering the rate-limit command surface."""

    def __init__(self):
        self.values: dict[str, str] = {}

    def setex(self, key: str, ttl: int, value: str) -> None:
        assert ttl > 0
        self.values[key] = value

    def get(self, key: str) -> str | None:
        return self.values.get(key)

    def delete(self, *keys: str) -> None:
        for key in keys:
            self.values.pop(key, None)

    def incr(self, key: str) -> int:
        count = int(self.values.get(key, 0)) + 1
        self.values[key] = str(count)
        return count

    def expire(self, key: str, ttl: int) -> None:
        pass

    def ttl(self, key: str) -> int:
        return 60


def create_test_application(
    db: Session,
    *,
    name: str = "CRM",
    redirect_uris: list[str] | None = None,
    enable_public_users: bool = True,
    login_methods: list[str] | None = None,
) -> dict:
    """Create an application row set directly in the database."""
    client_secret = "sec-" + secrets.token_urlsafe(24)
    application = models.Application(
        client_id="cid-" + secrets.token_urlsafe(12),
        name=name,
        redirect_uris=redirect_uris or ["https://crm.example.com/callback"],
        enable_public_users=enable_public_users,
        enable_sso=True,
        status="active",
    )
    db.add(application)
    db.flush()
    db.add(
        models.ApplicationClientSecret(
            application_id=application.id,
            secret_hash=hash_secret(client_secret),
        )
    )
    default_role = models.Role(
        application_id=application.id,
        code="member",
        name="Member",
        is_default=True,
    )
    db.add(default_role)
    db.flush()
    application.default_role_id = default_role.id
    for method in login_methods or ["sms_code"]:
        db.add(
            models.ApplicationLoginMethod(
                application_id=application.id,
                method=method,
                enabled=True,
                config={},
            )
        )
    db.commit()
    return {
        "id": application.id,
        "client_id": application.client_id,
        "client_secret": client_secret,
        "default_role_id": default_role.id,
    }


@pytest.fixture(autouse=True)
def _local_only_redis(monkeypatch: pytest.MonkeyPatch) -> None:
    """Skip rate limits and accept every SMS captcha token in tests."""
    from app.api import account as account_api
    from app.api import auth as auth_api

    monkeypatch.setattr(auth_api, "get_redis_client", lambda: None)
    monkeypatch.setattr(account_api, "get_redis_client", lambda: None)
    monkeypatch.setattr(auth_api, "verify_captcha", lambda param: True)
    monkeypatch.setattr(account_api, "verify_captcha", lambda param: True)


@pytest.fixture()
def sms_sender(monkeypatch: pytest.MonkeyPatch):
    """Stub SMS delivery and return the sent codes."""
    from app.services import auth as auth_service

    sent: list[str] = []
    monkeypatch.setattr(
        auth_service,
        "send_sms_code",
        lambda phone, code, purpose="login": sent.append(code) or True,
    )
    return sent


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


def request_sms_code(
    client: TestClient, client_id: str, phone: str, purpose: str = "login"
) -> dict:
    """Request an SMS code (captcha verification is mocked to accept)."""
    response = client.post(
        "/auth/sms/request-code",
        json={
            "client_id": client_id,
            "phone": phone,
            "purpose": purpose,
            "captcha_verify_param": "test-captcha-token",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()
