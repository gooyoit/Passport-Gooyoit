"""Account completion validation, pending-context, and flow tests."""

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.schemas import AccountSetupRequest
from app.services import account_setup

from conftest import create_test_application


class FakeRedis:
    def __init__(self):
        self.values: dict[str, str] = {}

    def setex(self, key: str, ttl: int, value: str) -> None:
        assert ttl > 0
        self.values[key] = value

    def get(self, key: str) -> str | None:
        return self.values.get(key)

    def delete(self, key: str) -> None:
        self.values.pop(key, None)


def _pending_wechat_token(db_session: Session, *, enable_public_users: bool) -> tuple[dict, str]:
    """Create an application and a pending wechat setup token for it."""
    application = create_test_application(
        db_session,
        enable_public_users=enable_public_users,
        login_methods=["wechat", "email_password", "email_code"],
    )
    context = {
        "provider": "wechat",
        "provider_user_id": "union-id-1",
        "display_name": "微信用户",
        "avatar_url": None,
        "raw_profile": {},
        "client_id": application["client_id"],
        "redirect_uri": "https://crm.example.com/callback",
        "state": "state-9",
    }
    return application, context


def test_pending_account_setup_round_trip(monkeypatch):
    redis = FakeRedis()
    monkeypatch.setattr(account_setup, "get_redis_client", lambda: redis)
    context = {
        "provider": "wechat",
        "provider_user_id": "union-id",
        "client_id": "app-id",
        "redirect_uri": "https://app.example.com/callback",
    }

    token = account_setup.create_pending_account_setup(context)

    assert len(token) >= 32
    assert account_setup.get_pending_account_setup(token) == context


def test_account_setup_normalizes_username_and_contact_phone():
    payload = AccountSetupRequest(
        token="t" * 32,
        mode="new",
        username="Passport_User",
        password="StrongPass1!",
        contact_phone="+86 138-0013-8000",
    )

    assert payload.username == "passport_user"
    assert payload.contact_phone == "+8613800138000"


def test_account_setup_rejects_weak_new_password():
    with pytest.raises(ValidationError):
        AccountSetupRequest(
            token="t" * 32,
            mode="new",
            username="passport_user",
            password="password",
        )


def test_wechat_skip_joins_application_without_public_signup(
    client: TestClient, db_session: Session, monkeypatch
) -> None:
    """A verified wechat identity may join even when public signup is off."""
    redis = FakeRedis()
    monkeypatch.setattr(account_setup, "get_redis_client", lambda: redis)
    application, context = _pending_wechat_token(
        db_session, enable_public_users=False
    )
    token = account_setup.create_pending_account_setup(context)

    response = client.post(
        "/auth/account-setup",
        json={"token": token, "mode": "skip"},
    )

    assert response.status_code == 200
    redirect_uri = response.json()["redirect_uri"]
    assert redirect_uri.startswith("https://crm.example.com/callback?code=")
    assert "state=state-9" in redirect_uri
    assert redis.values == {}


def test_wechat_new_mode_credentials_allow_password_login(
    client: TestClient, db_session: Session, monkeypatch
) -> None:
    """Username+password captured during setup work for later logins."""
    redis = FakeRedis()
    monkeypatch.setattr(account_setup, "get_redis_client", lambda: redis)
    application, context = _pending_wechat_token(
        db_session, enable_public_users=True
    )
    token = account_setup.create_pending_account_setup(context)

    setup_response = client.post(
        "/auth/account-setup",
        json={
            "token": token,
            "mode": "new",
            "username": "wechat_user",
            "password": "StrongPass1!",
        },
    )
    assert setup_response.status_code == 200

    login_response = client.post(
        "/auth/email/login-password",
        json={
            "client_id": application["client_id"],
            "redirect_uri": "https://crm.example.com/callback",
            "identifier": "wechat_user",
            "password": "StrongPass1!",
        },
    )
    assert login_response.status_code == 200
    assert "code" in login_response.json()


def test_wechat_link_mode_binds_existing_local_account(
    client: TestClient, db_session: Session, monkeypatch
) -> None:
    """Linking attaches the wechat identity to an existing account."""
    from app.core.security import hash_password
    from app.models import User

    redis = FakeRedis()
    monkeypatch.setattr(account_setup, "get_redis_client", lambda: redis)
    application, context = _pending_wechat_token(
        db_session, enable_public_users=False
    )
    existing = User(
        username="local_user",
        email="local@example.com",
        email_verified_at=None,
        hashed_password=hash_password("OldPass1!"),
        status="active",
    )
    db_session.add(existing)
    db_session.commit()
    token = account_setup.create_pending_account_setup(context)

    response = client.post(
        "/auth/account-setup",
        json={
            "token": token,
            "mode": "link",
            "identifier": "local_user",
            "existing_password": "OldPass1!",
        },
    )

    assert response.status_code == 200
    assert response.json()["redirect_uri"].startswith(
        "https://crm.example.com/callback?code="
    )

