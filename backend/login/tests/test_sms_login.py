"""SMS code login flow tests."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app import models

from conftest import FakeRedis, create_test_application, request_sms_code, sms_sender  # noqa: F401


def test_sms_login_auto_registers_user(
    client: TestClient, db_session: Session, sms_sender
) -> None:
    """First SMS login on an open app creates the account and issues a code."""
    application = create_test_application(
        db_session, login_methods=["sms_code", "email_password"]
    )

    payload = request_sms_code(client, application["client_id"], "13800138000")
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

    payload = request_sms_code(client, application["client_id"], "13900139000")
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

    payload = request_sms_code(client, application["client_id"], "13800138000")
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
        response = client.post(
            "/auth/sms/request-code",
            json={
                "client_id": application["client_id"],
                "phone": "13800138000",
                "captcha_verify_param": "test-captcha-token",
            },
        )
        if i == 0:
            first = response.status_code
        else:
            assert first == 200
            assert response.status_code == 429


def test_captcha_failure_does_not_burn_sms_quota(
    client: TestClient, db_session: Session, sms_sender, monkeypatch
) -> None:
    """A failed slider attempt must not consume the per-minute SMS quota."""
    from app.api import auth as auth_api

    redis = FakeRedis()
    monkeypatch.setattr(auth_api, "get_redis_client", lambda: redis)
    monkeypatch.setattr(
        auth_api, "verify_captcha", lambda param: param == "test-captcha-token"
    )
    application = create_test_application(db_session, login_methods=["sms_code"])

    payload = {
        "client_id": application["client_id"],
        "phone": "13800138000",
        "captcha_verify_param": "bad-captcha-token",
    }
    failed = client.post("/auth/sms/request-code", json=payload)
    assert failed.status_code == 400

    payload["captcha_verify_param"] = "test-captcha-token"
    ok = client.post("/auth/sms/request-code", json=payload)
    assert ok.status_code == 200, ok.text
    assert ok.json()["debug_code"]


def test_captcha_gate_blocks_verify_spam(
    client: TestClient, db_session: Session, sms_sender, monkeypatch
) -> None:
    """The outbound captcha call itself is per-IP throttled, independent of SMS quota."""
    from app.api import auth as auth_api

    redis = FakeRedis()
    monkeypatch.setattr(auth_api, "get_redis_client", lambda: redis)
    monkeypatch.setattr(auth_api, "verify_captcha", lambda param: False)
    application = create_test_application(db_session, login_methods=["sms_code"])

    payload = {
        "client_id": application["client_id"],
        "phone": "13800138000",
        "captcha_verify_param": "bad",
    }
    for _ in range(30):
        assert client.post("/auth/sms/request-code", json=payload).status_code == 400
    limited = client.post("/auth/sms/request-code", json=payload)
    assert limited.status_code == 429
    assert limited.headers.get("Retry-After")


def test_sms_code_burns_after_repeated_wrong_guesses(
    client: TestClient, db_session: Session, sms_sender
) -> None:
    """Five wrong code guesses invalidate the code even if leaked later."""
    application = create_test_application(db_session, login_methods=["sms_code"])

    payload = request_sms_code(client, application["client_id"], "13800138000")
    valid_code = payload["debug_code"]
    for _ in range(5):
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

    # The burned code no longer works even with the correct value.
    burned = client.post(
        "/auth/sms/login",
        json={
            "client_id": application["client_id"],
            "redirect_uri": "https://crm.example.com/callback",
            "phone": "13800138000",
            "code": valid_code,
        },
    )
    assert burned.status_code == 400


def test_phone_variants_share_one_bucket(
    client: TestClient, db_session: Session, sms_sender, monkeypatch
) -> None:
    """+86 and bare forms normalize to one phone identity and one rate bucket."""
    from app.api import auth as auth_api

    redis = FakeRedis()
    monkeypatch.setattr(auth_api, "get_redis_client", lambda: redis)
    application = create_test_application(db_session, login_methods=["sms_code"])

    import json as _json
    first = None
    second = None
    for phone in ["+8613800138000", "13800138000"]:
        r = client.post(
            "/auth/sms/request-code",
            json={
                "client_id": application["client_id"],
                "phone": phone,
                "captcha_verify_param": "test-captcha-token",
            },
        )
        if first is None:
            first = (r.status_code, phone)
        else:
            second = r.status_code
    assert first[0] == 200
    assert second == 429  # same bucket, per-phone minute limit hit
