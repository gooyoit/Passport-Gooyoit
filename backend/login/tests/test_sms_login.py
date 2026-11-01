"""SMS code login flow tests."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app import models
from app.services import auth as auth_service

from conftest import FakeRedis, create_test_application


def _request_sms_code(
    client: TestClient, client_id: str, phone: str, monkeypatch=None
) -> dict:
    """Request an SMS code through the real captcha flow."""
    captcha = client.get("/auth/captcha").json()
    response = client.post(
        "/auth/sms/request-code",
        json={
            "client_id": client_id,
            "phone": phone,
            "captcha_key": captcha["captcha_key"],
            "captcha_answer": captcha["captcha_answer"],
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture()
def sms_sender(monkeypatch: pytest.MonkeyPatch):
    """Stub SMS delivery and return the sent codes."""
    sent: list[str] = []
    monkeypatch.setattr(auth_service, "send_sms_code", lambda phone, code: sent.append(code) or True)
    return sent


def test_sms_login_auto_registers_user(
    client: TestClient, db_session: Session, sms_sender
) -> None:
    """First SMS login on an open app creates the account and issues a code."""
    application = create_test_application(
        db_session, login_methods=["sms_code", "email_password"]
    )

    payload = _request_sms_code(client, application["client_id"], "13800138000")
    assert payload["debug_code"]

    login = client.post(
        "/auth/sms/login",
        json={
            "client_id": application["client_id"],
            "redirect_uri": "https://crm.example.com/callback",
            "phone": "13800138000",
            "code": payload["debug_code"],
            "state": "s1",
        },
    )
    assert login.status_code == 200
    assert "code=" in login.json()["redirect_uri"]

    db_session.expire_all()
    user = db_session.scalar(
        __import__("sqlalchemy").select(models.User).where(models.User.phone == "13800138000")
    )
    assert user is not None
    assert user.phone_verified_at is not None
    assert (
        db_session.query(models.UserIdentity)
        .filter_by(user_id=user.id, provider="phone")
        .count()
        == 1
    )


def test_sms_login_closed_app_rejects_new_phone(
    client: TestClient, db_session: Session, sms_sender
) -> None:
    """Closed apps only admit already-registered phone numbers."""
    application = create_test_application(
        db_session, enable_public_users=False, login_methods=["sms_code"]
    )

    payload = _request_sms_code(client, application["client_id"], "13900139000")
    login = client.post(
        "/auth/sms/login",
        json={
            "client_id": application["client_id"],
            "redirect_uri": "https://crm.example.com/callback",
            "phone": "13900139000",
            "code": payload["debug_code"],
        },
    )
    assert login.status_code == 403
    assert login.json()["detail"] == "Phone number is not registered"


def test_sms_login_wrong_code_rejected_then_retry(
    client: TestClient, db_session: Session, sms_sender
) -> None:
    """A wrong code does not consume the valid one."""
    application = create_test_application(db_session, login_methods=["sms_code"])

    payload = _request_sms_code(client, application["client_id"], "13800138000")
    wrong = client.post(
        "/auth/sms/login",
        json={
            "client_id": application["client_id"],
            "redirect_uri": "https://crm.example.com/callback",
            "phone": "13800138000",
            "code": "000000",
        },
    )
    assert wrong.status_code == 400

    retry = client.post(
        "/auth/sms/login",
        json={
            "client_id": application["client_id"],
            "redirect_uri": "https://crm.example.com/callback",
            "phone": "13800138000",
            "code": payload["debug_code"],
        },
    )
    assert retry.status_code == 200


def test_password_login_accepts_phone_identifier(
    client: TestClient, db_session: Session
) -> None:
    """The password login identifier now matches the phone column too."""
    from app.core.security import hash_password

    application = create_test_application(db_session, login_methods=["email_password"])
    db_session.add(
        models.User(
            phone="13800138000",
            phone_verified_at=None,
            hashed_password=hash_password("StrongPass1!"),
            status="active",
        )
    )
    db_session.commit()

    login = client.post(
        "/auth/email/login-password",
        json={
            "client_id": application["client_id"],
            "redirect_uri": "https://crm.example.com/callback",
            "identifier": "13800138000",
            "password": "StrongPass1!",
        },
    )
    assert login.status_code == 200


def test_sms_rate_limit_blocks_burst(
    client: TestClient, db_session: Session, sms_sender, monkeypatch
) -> None:
    """Per-phone minute window throttles repeated sends."""
    from app.api import auth as auth_api

    redis = FakeRedis()
    monkeypatch.setattr(auth_api, "get_redis_client", lambda: redis)
    application = create_test_application(db_session, login_methods=["sms_code"])

    first = None
    for i in range(2):
        captcha = client.get("/auth/captcha").json()
        response = client.post(
            "/auth/sms/request-code",
            json={
                "client_id": application["client_id"],
                "phone": "13800138000",
                "captcha_key": captcha["captcha_key"],
                "captcha_answer": captcha["captcha_answer"],
            },
        )
        if i == 0:
            first = response.status_code
        else:
            assert first == 200
            assert response.status_code == 429
