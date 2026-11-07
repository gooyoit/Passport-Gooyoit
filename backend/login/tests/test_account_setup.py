"""Account completion validation, pending-context, and flow tests."""

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.schemas import AccountSetupRequest
from app.services import account_setup

from conftest import FakeRedis, create_test_application, request_sms_code


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
    """WeChat users cannot enter an application without binding a credential."""
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

    assert response.status_code == 422
    assert redis.values


def test_wechat_new_email_binding_allows_password_login(
    client: TestClient, db_session: Session, monkeypatch
) -> None:
    """A new email and password become the required local login credential."""
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
            "email": "wechat.user@example.com",
            "password": "StrongPass1!",
        },
    )
    assert setup_response.status_code == 200

    login_response = client.post(
        "/auth/email/login-password",
        json={
            "client_id": application["client_id"],
            "redirect_uri": "https://crm.example.com/callback",
            "email": "wechat.user@example.com",
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



def test_setup_email_binding_rejects_wrong_existing_password(
    client: TestClient, db_session: Session, monkeypatch
) -> None:
    """An existing email can only receive the WeChat identity after password proof."""
    from app.core.security import hash_password
    from app.models import User, UserIdentity

    redis = FakeRedis()
    monkeypatch.setattr(account_setup, "get_redis_client", lambda: redis)
    application, context = _pending_wechat_token(
        db_session, enable_public_users=True
    )
    victim = User(
        username="victim",
        email="victim@example.com",
        hashed_password=hash_password("RightPass1!"),
        status="active",
    )
    db_session.add(victim)
    db_session.commit()
    token = account_setup.create_pending_account_setup(context)

    response = client.post(
        "/auth/account-setup",
        json={
            "token": token,
            "mode": "new",
            "email": "victim@example.com",
            "password": "WrongPass1!",
        },
    )

    assert response.status_code == 401
    # The wechat identity must not have been attached to the victim's account.
    assert (
        db_session.query(UserIdentity)
        .filter_by(user_id=victim.id, provider="wechat")
        .count()
        == 0
    )


def test_setup_email_binding_merges_into_existing_account(
    client: TestClient, db_session: Session, monkeypatch
) -> None:
    """Correct existing-email credentials attach WeChat to the canonical account."""
    from app.core.security import hash_password
    from app.models import User, UserIdentity

    redis = FakeRedis()
    monkeypatch.setattr(account_setup, "get_redis_client", lambda: redis)
    _, context = _pending_wechat_token(db_session, enable_public_users=False)
    owner = User(
        email="owner@example.com",
        hashed_password=hash_password("OwnerPass1!"),
        status="active",
    )
    db_session.add(owner)
    db_session.commit()
    token = account_setup.create_pending_account_setup(context)

    response = client.post(
        "/auth/account-setup",
        json={
            "token": token,
            "mode": "new",
            "email": "owner@example.com",
            "password": "OwnerPass1!",
        },
    )

    assert response.status_code == 200, response.text
    assert (
        db_session.query(UserIdentity)
        .filter_by(user_id=owner.id, provider="wechat")
        .count()
        == 1
    )


def test_setup_link_mode_locks_out_brute_force(
    client: TestClient, db_session: Session, monkeypatch
) -> None:
    """Repeated wrong passwords on a setup token trigger the lockout."""
    from app.api import auth as auth_api

    redis = FakeRedis()
    monkeypatch.setattr(auth_api, "get_redis_client", lambda: redis)

    application, context = _pending_wechat_token(db_session, enable_public_users=False)
    from app.core.security import hash_password
    from app.models import User

    db_session.add(
        User(
            username="victim",
            hashed_password=hash_password("RightPass1!"),
            status="active",
        )
    )
    db_session.commit()
    token = account_setup.create_pending_account_setup(context)

    for _ in range(5):
        response = client.post(
            "/auth/account-setup",
            json={"token": token, "mode": "link", "identifier": "victim", "existing_password": "WrongPass1!"},
        )
        assert response.status_code == 401

    locked = client.post(
        "/auth/account-setup",
        json={"token": token, "mode": "link", "identifier": "victim", "existing_password": "RightPass1!"},
    )
    assert locked.status_code == 429


def test_setup_email_binding_locks_out_brute_force(
    client: TestClient, db_session: Session, monkeypatch
) -> None:
    """Repeated wrong passwords while binding an email trigger the lockout."""
    from app.api import auth as auth_api
    from app.core.security import hash_password
    from app.models import User

    redis = FakeRedis()
    monkeypatch.setattr(auth_api, "get_redis_client", lambda: redis)
    _, context = _pending_wechat_token(db_session, enable_public_users=True)
    db_session.add(
        User(
            email="victim@example.com",
            hashed_password=hash_password("RightPass1!"),
            status="active",
        )
    )
    db_session.commit()
    token = account_setup.create_pending_account_setup(context)

    for _ in range(5):
        response = client.post(
            "/auth/account-setup",
            json={
                "token": token,
                "mode": "new",
                "email": "victim@example.com",
                "password": "WrongPass1!",
            },
        )
        assert response.status_code == 401

    locked = client.post(
        "/auth/account-setup",
        json={
            "token": token,
            "mode": "new",
            "email": "victim@example.com",
            "password": "RightPass1!",
        },
    )
    assert locked.status_code == 429


def test_setup_email_binding_lockout_ignores_identifier(
    client: TestClient, db_session: Session, monkeypatch
) -> None:
    """Identifier aliases cannot shard or clear the verified email's counter."""
    from app.api import auth as auth_api
    from app.core.security import hash_password
    from app.models import User

    redis = FakeRedis()
    monkeypatch.setattr(auth_api, "get_redis_client", lambda: redis)
    _, context = _pending_wechat_token(db_session, enable_public_users=True)
    db_session.add(
        User(
            email="victim@example.com",
            hashed_password=hash_password("RightPass1!"),
            status="active",
        )
    )
    db_session.commit()
    token = account_setup.create_pending_account_setup(context)

    for alias in ["alias-1", "alias-2", "alias-3", "alias-4", "alias-5"]:
        response = client.post(
            "/auth/account-setup",
            json={
                "token": token,
                "mode": "new",
                "email": "victim@example.com",
                "password": "WrongPass1!",
                "identifier": alias,
            },
        )
        assert response.status_code == 401

    # A successful setup for a different email must not clear the victim's
    # counter, even when the request spoofs the victim's identifier.
    other = client.post(
        "/auth/account-setup",
        json={
            "token": token,
            "mode": "new",
            "email": "other@example.com",
            "password": "OtherPass1!",
            "identifier": "victim@example.com",
        },
    )
    assert other.status_code == 200

    locked = client.post(
        "/auth/account-setup",
        json={
            "token": token,
            "mode": "new",
            "email": "victim@example.com",
            "password": "RightPass1!",
        },
    )
    assert locked.status_code == 429


def test_password_login_lockout_survives_identifier_variants(
    client: TestClient, db_session: Session, monkeypatch
) -> None:
    """Identifier spelling variants share one failure counter."""
    from app.api import auth as auth_api
    from app.core.security import hash_password
    from app.models import User

    redis = FakeRedis()
    monkeypatch.setattr(auth_api, "get_redis_client", lambda: redis)

    application = create_test_application(
        db_session, login_methods=["email_password"]
    )
    db_session.add(
        User(
            email="user@example.com",
            email_verified_at=None,
            hashed_password=hash_password("RightPass1!"),
            status="active",
        )
    )
    db_session.commit()

    attempts = 0
    for variant in ["USER@example.com", " user@example.com ", "User@Example.com"]:
        while attempts < 5:
            response = client.post(
                "/auth/email/login-password",
                json={
                    "client_id": application["client_id"],
                    "redirect_uri": "https://crm.example.com/callback",
                    "identifier": variant,
                    "password": "WrongPass1!",
                },
            )
            assert response.status_code == 401
            attempts += 1

    locked = client.post(
        "/auth/email/login-password",
        json={
            "client_id": application["client_id"],
            "redirect_uri": "https://crm.example.com/callback",
            "identifier": "user@example.com",
            "password": "RightPass1!",
        },
    )
    assert locked.status_code == 429


def _phone_owner(db_session: Session, phone: str, username: str):
    """Create an account that already owns a verified phone credential."""
    from sqlalchemy import func

    from app.models import User, UserIdentity

    owner = User(
        username=username,
        phone=phone,
        phone_verified_at=func.now(),
        status="active",
    )
    db_session.add(owner)
    db_session.flush()
    db_session.add(
        UserIdentity(
            user_id=owner.id,
            provider="phone",
            provider_user_id=phone,
            raw_profile={},
        )
    )
    db_session.commit()
    return owner


def test_wechat_new_mode_with_phone_creates_verified_account(
    client: TestClient, db_session: Session, monkeypatch, sms_sender
) -> None:
    """Completing setup with phone+code builds an account with a verified phone."""
    from sqlalchemy import select

    from app.models import User, UserIdentity

    redis = FakeRedis()
    monkeypatch.setattr(account_setup, "get_redis_client", lambda: redis)
    application, context = _pending_wechat_token(db_session, enable_public_users=True)
    token = account_setup.create_pending_account_setup(context)
    code = request_sms_code(
        client, application["client_id"], "13800138000", purpose="bind_phone"
    )["debug_code"]

    response = client.post(
        "/auth/account-setup",
        json={
            "token": token,
            "mode": "new",
            "phone": "13800138000",
            "code": code,
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["redirect_uri"].startswith("https://crm.example.com/callback?code=")
    db_session.expire_all()
    user = db_session.scalar(select(User).where(User.phone == "13800138000"))
    assert user is not None
    assert user.phone_verified_at is not None
    assert user.hashed_password is None
    providers = sorted(
        db_session.scalars(
            select(UserIdentity.provider).where(UserIdentity.user_id == user.id)
        ).all()
    )
    assert providers == ["phone", "wechat"]



def test_wechat_new_mode_with_owned_phone_merges_into_phone_account(
    client: TestClient, db_session: Session, monkeypatch, sms_sender
) -> None:
    """The SMS code proves phone ownership: pending identity joins that account."""
    from sqlalchemy import select

    from app.core.security import hash_password
    from app.models import ApplicationUser, User, UserIdentity

    redis = FakeRedis()
    monkeypatch.setattr(account_setup, "get_redis_client", lambda: redis)
    application, context = _pending_wechat_token(db_session, enable_public_users=True)
    owner = _phone_owner(db_session, "13900139000", "owner")
    owner.hashed_password = hash_password("OwnerPass1!")
    db_session.commit()
    token = account_setup.create_pending_account_setup(context)
    code = request_sms_code(
        client, application["client_id"], "13900139000", purpose="bind_phone"
    )["debug_code"]

    response = client.post(
        "/auth/account-setup",
        json={
            "token": token,
            "mode": "new",
            "phone": "13900139000",
            "code": code,
            "username": "ignored_name",
            "password": "IgnoredPass1!",
        },
    )

    assert response.status_code == 200, response.text
    db_session.expire_all()
    # The wechat identity joined the phone's account; no fork account was made.
    assert (
        db_session.query(UserIdentity)
        .filter_by(user_id=owner.id, provider="wechat")
        .count()
        == 1
    )
    assert db_session.scalar(select(User).where(User.username == "ignored_name")) is None
    membership = db_session.scalar(
        select(ApplicationUser).where(
            ApplicationUser.application_id == application["id"],
            ApplicationUser.user_id == owner.id,
        )
    )
    assert membership is not None
    # Optional password was ignored: the owner's own one still works.
    login = client.post(
        "/auth/email/login-password",
        json={
            "client_id": application["client_id"],
            "redirect_uri": "https://crm.example.com/callback",
            "identifier": "owner",
            "password": "OwnerPass1!",
        },
    )
    assert login.status_code == 200


def test_wechat_new_mode_with_phone_rejects_owner_already_on_wechat(
    client: TestClient, db_session: Session, monkeypatch, sms_sender
) -> None:
    """A phone account that already uses wechat means: go log in, 409."""
    from app.models import UserIdentity

    redis = FakeRedis()
    monkeypatch.setattr(account_setup, "get_redis_client", lambda: redis)
    application, context = _pending_wechat_token(db_session, enable_public_users=True)
    owner = _phone_owner(db_session, "13900139000", "owner")
    db_session.add(
        UserIdentity(
            user_id=owner.id,
            provider="wechat",
            provider_user_id="union-id-other",
            raw_profile={},
        )
    )
    db_session.commit()
    token = account_setup.create_pending_account_setup(context)
    code = request_sms_code(
        client, application["client_id"], "13900139000", purpose="bind_phone"
    )["debug_code"]

    response = client.post(
        "/auth/account-setup",
        json={
            "token": token,
            "mode": "new",
            "phone": "13900139000",
            "code": code,
        },
    )

    assert response.status_code == 409
    db_session.expire_all()
    # The original wechat identity is untouched; nothing new was attached.
    identities = (
        db_session.query(UserIdentity)
        .filter_by(user_id=owner.id, provider="wechat")
        .all()
    )
    assert len(identities) == 1
    assert identities[0].provider_user_id == "union-id-other"
