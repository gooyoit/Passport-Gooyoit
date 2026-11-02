"""SMS register and forgot-password flows."""

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.core.security import hash_password

from conftest import create_test_application, request_sms_code, sms_sender  # noqa: F401


def _register(client: TestClient, application: dict, phone: str, code: str) -> dict:
    return client.post(
        "/auth/sms/register",
        json={
            "client_id": application["client_id"],
            "redirect_uri": "https://crm.example.com/callback",
            "phone": phone,
            "code": code,
        },
    )


def _reset(client: TestClient, application: dict, phone: str, code: str, new_password: str) -> dict:
    return client.post(
        "/auth/sms/reset-password",
        json={
            "client_id": application["client_id"],
            "redirect_uri": "https://crm.example.com/callback",
            "phone": phone,
            "code": code,
            "new_password": new_password,
        },
    )


def _seed_user_with_password(db: Session, phone: str, password: str) -> models.User:
    user = models.User(
        phone=phone,
        phone_verified_at=None,
        hashed_password=hash_password(password),
        status="active",
    )
    db.add(user)
    db.commit()
    return user


def test_sms_register_creates_account_and_logs_in(
    client: TestClient, db_session: Session, sms_sender
) -> None:
    """Register-purpose code creates the account and returns a login grant."""
    application = create_test_application(db_session, login_methods=["sms_code"])

    payload = request_sms_code(
        client, application["client_id"], "13800138000", purpose="register"
    )
    response = _register(client, application, "13800138000", payload["debug_code"])
    assert response.status_code == 200
    assert "code=" in response.json()["redirect_uri"]

    db_session.expire_all()
    user = db_session.scalar(
        select(models.User).where(models.User.phone == "13800138000")
    )
    assert user is not None
    assert user.phone_verified_at is not None
    assert user.hashed_password is None  # password is set later in the account center

    # The grant is a working authorization code.
    token = client.post(
        "/oauth/token",
        json={
            "client_id": application["client_id"],
            "client_secret": application["client_secret"],
            "code": response.json()["code"],
            "redirect_uri": "https://crm.example.com/callback",
        },
    )
    assert token.status_code == 200


def test_sms_register_rejected_on_closed_app(
    client: TestClient, db_session: Session
) -> None:
    """Closed apps refuse register-purpose codes and registrations."""
    application = create_test_application(
        db_session, enable_public_users=False, login_methods=["sms_code"]
    )

    captcha = client.get("/auth/captcha").json()
    rejected = client.post(
        "/auth/sms/request-code",
        json={
            "client_id": application["client_id"],
            "phone": "13800138000",
            "purpose": "register",
            "captcha_key": captcha["captcha_key"],
            "captcha_answer": captcha["captcha_answer"],
        },
    )
    assert rejected.status_code == 400
    assert rejected.json()["detail"] == "Registration is disabled"


def test_sms_register_existing_phone_gets_conflict_on_code_request(
    client: TestClient, db_session: Session
) -> None:
    """Already-registered phones are pointed to login instead of a new account."""
    application = create_test_application(db_session, login_methods=["sms_code"])
    _seed_user_with_password(db_session, "13800138000", "StrongPass1!")

    captcha = client.get("/auth/captcha").json()
    conflict = client.post(
        "/auth/sms/request-code",
        json={
            "client_id": application["client_id"],
            "phone": "13800138000",
            "purpose": "register",
            "captcha_key": captcha["captcha_key"],
            "captcha_answer": captcha["captcha_answer"],
        },
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"] == "Phone number is already registered"


def test_sms_register_wrong_code_rejected(
    client: TestClient, db_session: Session, sms_sender
) -> None:
    application = create_test_application(db_session, login_methods=["sms_code"])
    payload = request_sms_code(
        client, application["client_id"], "13800138000", purpose="register"
    )
    response = _register(client, application, "13800138000", "000000")
    assert response.status_code == 400

    # The valid code still works afterwards.
    retry = _register(client, application, "13800138000", payload["debug_code"])
    assert retry.status_code == 200


def test_sms_reset_password_swaps_credentials_and_revokes_sessions(
    client: TestClient, db_session: Session, sms_sender
) -> None:
    """Reset sets the new password, revokes old sessions, and logs the user in."""
    application = create_test_application(
        db_session, login_methods=["sms_code", "email_password"]
    )
    _seed_user_with_password(db_session, "13800138000", "OldPass1!")

    # Log in once to obtain a refresh token that must die with the reset.
    login_code = request_sms_code(client, application["client_id"], "13800138000")[
        "debug_code"
    ]
    login = client.post(
        "/auth/sms/login",
        json={
            "client_id": application["client_id"],
            "redirect_uri": "https://crm.example.com/callback",
            "phone": "13800138000",
            "code": login_code,
        },
    ).json()
    grant = client.post(
        "/oauth/token",
        json={
            "client_id": application["client_id"],
            "client_secret": application["client_secret"],
            "code": login["code"],
            "redirect_uri": "https://crm.example.com/callback",
        },
    ).json()
    assert grant["access_token"]

    payload = request_sms_code(
        client, application["client_id"], "13800138000", purpose="reset_password"
    )
    response = _reset(client, application, "13800138000", payload["debug_code"], "NewPass1!")
    assert response.status_code == 200

    # Old refresh token is revoked.
    revoked = client.post(
        "/oauth/token/refresh",
        json={
            "client_id": application["client_id"],
            "client_secret": application["client_secret"],
            "refresh_token": grant["refresh_token"],
        },
    )
    assert revoked.status_code == 401

    # New password works for password login.
    password_login = client.post(
        "/auth/email/login-password",
        json={
            "client_id": application["client_id"],
            "redirect_uri": "https://crm.example.com/callback",
            "identifier": "13800138000",
            "password": "NewPass1!",
        },
    )
    assert password_login.status_code == 200


def test_sms_reset_password_requires_registered_phone(
    client: TestClient, db_session: Session
) -> None:
    application = create_test_application(db_session, login_methods=["sms_code"])

    captcha = client.get("/auth/captcha").json()
    rejected = client.post(
        "/auth/sms/request-code",
        json={
            "client_id": application["client_id"],
            "phone": "13900139000",
            "purpose": "reset_password",
            "captcha_key": captcha["captcha_key"],
            "captcha_answer": captcha["captcha_answer"],
        },
    )
    assert rejected.status_code == 400
    assert rejected.json()["detail"] == "Phone number is not registered"


def test_sms_reset_password_rejects_weak_password(
    client: TestClient, db_session: Session, sms_sender
) -> None:
    application = create_test_application(db_session, login_methods=["sms_code"])
    _seed_user_with_password(db_session, "13800138000", "OldPass1!")

    payload = request_sms_code(
        client, application["client_id"], "13800138000", purpose="reset_password"
    )
    response = _reset(client, application, "13800138000", payload["debug_code"], "weakpass")
    assert response.status_code == 422
