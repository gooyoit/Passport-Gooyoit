"""Account center API tests."""

import secrets

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import create_access_token, hash_password
from app.models import ApplicationUser, User, UserIdentity
from app.services.sso import create_sso_session

from conftest import create_test_application, request_email_code


def _wechat_skip_user(db_session: Session) -> User:
    """Insert the user a skipped wechat signup would leave behind."""
    user = User(
        display_name="微信用户",
        status="active",
    )
    db_session.add(user)
    db_session.flush()
    db_session.add(
        UserIdentity(
            user_id=user.id,
            provider="wechat",
            provider_user_id=f"union-{secrets.token_hex(8)}",
            raw_profile={},
        )
    )
    db_session.commit()
    return user


def _bearer(db_session: Session, user: User) -> tuple[dict, dict]:
    application = create_test_application(
        db_session, login_methods=["email_code", "email_password"]
    )
    token = create_access_token(
        subject=str(user.id), application_id=application["id"], expires_in=3600
    )
    return {"Authorization": f"Bearer {token}"}, application


def test_profile_via_bearer_and_sso_cookie(
    client: TestClient, db_session: Session
) -> None:
    """Profile resolves via Bearer token and via the SSO cookie."""
    user = _wechat_skip_user(db_session)
    headers, _ = _bearer(db_session, user)

    response = client.get("/account/profile", headers=headers)
    assert response.status_code == 200
    payload = response.json()
    assert payload["has_password"] is False
    assert payload["user"]["email"] is None
    assert [i["provider"] for i in payload["identities"]] == ["wechat"]

    sso_token = create_sso_session(db_session, user_id=user.id)
    client.cookies.set("passport_sso", sso_token)
    cookie_response = client.get("/account/profile")
    assert cookie_response.status_code == 200
    assert cookie_response.json()["user"]["id"] == user.id
    client.cookies.delete("passport_sso")


def test_profile_requires_authentication(client: TestClient) -> None:
    assert client.get("/account/profile").status_code == 401
    bad = client.get("/account/profile", headers={"Authorization": "Bearer not-a-jwt"})
    assert bad.status_code == 401


def test_send_code_bearer_skips_cookie_captcha(
    client: TestClient, db_session: Session
) -> None:
    """A fresh access token is a strong enough proof; no captcha needed."""
    user = _wechat_skip_user(db_session)
    headers, _ = _bearer(db_session, user)

    response = client.post(
        "/account/email/send-code", headers=headers, json={"email": "bind@example.com"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["debug_code"]

    taken = User(email="owner@example.com", status="active")
    db_session.add(taken)
    db_session.commit()
    conflict = client.post(
        "/account/email/send-code", headers=headers, json={"email": "owner@example.com"}
    )
    assert conflict.status_code == 409


def test_send_code_cookie_path_requires_captcha(
    client: TestClient, db_session: Session
) -> None:
    """The SSO cookie path must pass a captcha before a code is mailed."""
    user = _wechat_skip_user(db_session)
    client.cookies.set("passport_sso", create_sso_session(db_session, user_id=user.id))

    missing = client.post(
        "/account/email/send-code", json={"email": "bind@example.com"}
    )
    assert missing.status_code == 400

    captcha = client.get("/auth/captcha").json()
    ok = client.post(
        "/account/email/send-code",
        json={
            "email": "bind@example.com",
            "captcha_key": captcha["captcha_key"],
            "captcha_answer": captcha["captcha_answer"],
        },
    )
    assert ok.status_code == 200, ok.text
    client.cookies.delete("passport_sso")


def test_bind_email_happy_path_and_conflicts(
    client: TestClient, db_session: Session
) -> None:
    """Binding consumes a valid code, is idempotent, and rejects taken emails."""
    user = _wechat_skip_user(db_session)
    headers, _ = _bearer(db_session, user)

    code = client.post(
        "/account/email/send-code", headers=headers, json={"email": "bind@example.com"}
    ).json()["debug_code"]
    bound = client.post(
        "/account/email/bind",
        headers=headers,
        json={"email": "bind@example.com", "code": code},
    )
    assert bound.status_code == 200
    assert bound.json()["user"]["email"] == "bind@example.com"
    assert bound.json()["user"]["email_verified"] is True

    db_session.expire_all()
    refreshed = db_session.get(User, user.id)
    assert refreshed.email == "bind@example.com"
    assert (
        db_session.query(UserIdentity)
        .filter_by(user_id=user.id, provider="email")
        .count()
        == 1
    )

    # Wrong code is rejected without consuming the valid one.
    second = client.post(
        "/account/email/send-code", headers=headers, json={"email": "bind@example.com"}
    ).json()["debug_code"]
    wrong = client.post(
        "/account/email/bind",
        headers=headers,
        json={"email": "bind@example.com", "code": "000000"},
    )
    assert wrong.status_code == 400
    retry = client.post(
        "/account/email/bind",
        headers=headers,
        json={"email": "bind@example.com", "code": second},
    )
    assert retry.status_code == 200

    # A valid code still cannot bind an email that got taken meanwhile.
    late_user = _wechat_skip_user(db_session)
    late_headers, _ = _bearer(db_session, late_user)
    taken_code = client.post(
        "/account/email/send-code",
        headers=late_headers,
        json={"email": "late@example.com"},
    ).json()["debug_code"]
    latecomer = User(email="late@example.com", status="active")
    db_session.add(latecomer)
    db_session.commit()
    taken = client.post(
        "/account/email/bind",
        headers=late_headers,
        json={"email": "late@example.com", "code": taken_code},
    )
    assert taken.status_code == 409

    # The account already has an email; binding a different one is rejected.
    owner = User(email="owner@example.com", status="active")
    db_session.add(owner)
    db_session.commit()
    swap = client.post(
        "/account/email/send-code",
        headers=headers,
        json={"email": "owner@example.com"},
    )
    assert swap.status_code == 409


def test_credentials_enable_password_login(
    client: TestClient, db_session: Session
) -> None:
    """A wechat-skip user can set username+password and then log in with them."""
    user = _wechat_skip_user(db_session)
    headers, application = _bearer(db_session, user)

    response = client.post(
        "/account/credentials",
        headers=headers,
        json={"username": "center_user", "password": "StrongPass1!"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["has_password"] is True

    login = client.post(
        "/auth/email/login-password",
        json={
            "client_id": application["client_id"],
            "redirect_uri": "https://crm.example.com/callback",
            "identifier": "center_user",
            "password": "StrongPass1!",
        },
    )
    assert login.status_code == 200

    conflict = client.post(
        "/account/credentials",
        headers=headers,
        json={"username": "center_user"},
    )
    assert conflict.status_code == 200  # idempotent same-username update

    duplicate_holder = User(username="taken_name", status="active")
    db_session.add(duplicate_holder)
    db_session.commit()
    duplicate = client.post(
        "/account/credentials", headers=headers, json={"username": "taken_name"}
    )
    assert duplicate.status_code == 409

    weak = client.post(
        "/account/credentials", headers=headers, json={"password": "password"}
    )
    assert weak.status_code == 422

    empty = client.post("/account/credentials", headers=headers, json={})
    assert empty.status_code == 400


def test_credentials_overwrite_password_needs_current_password(
    client: TestClient, db_session: Session
) -> None:
    """Changing an existing password requires proving the current one."""
    user = User(
        username="pwd_user",
        hashed_password=hash_password("OldPass1!"),
        status="active",
    )
    db_session.add(user)
    db_session.commit()
    headers, _ = _bearer(db_session, user)

    missing = client.post(
        "/account/credentials", headers=headers, json={"password": "NewPass1!"}
    )
    assert missing.status_code == 401

    wrong = client.post(
        "/account/credentials",
        headers=headers,
        json={"password": "NewPass1!", "current_password": "WrongPass1!"},
    )
    assert wrong.status_code == 401

    ok = client.post(
        "/account/credentials",
        headers=headers,
        json={"password": "NewPass1!", "current_password": "OldPass1!"},
    )
    assert ok.status_code == 200

    phone = client.post(
        "/account/credentials",
        headers=headers,
        json={"contact_phone": "+86 138-0013-8000"},
    )
    assert phone.status_code == 200
    assert phone.json()["user"]["contact_phone"] == "+8613800138000"


def test_userinfo_exposes_binding_state(
    client: TestClient, db_session: Session
) -> None:
    """userinfo now tells business apps whether the user needs completion."""
    application = create_test_application(db_session, login_methods=["email_code", "email_password"])
    debug_code = request_email_code(
        client, application["client_id"], "state@example.com"
    )["debug_code"]
    auth_code = client.post(
        "/auth/email/login",
        json={
            "client_id": application["client_id"],
            "redirect_uri": "https://crm.example.com/callback",
            "email": "state@example.com",
            "code": debug_code,
        },
    ).json()["code"]
    token = client.post(
        "/oauth/token",
        json={
            "client_id": application["client_id"],
            "client_secret": application["client_secret"],
            "code": auth_code,
            "redirect_uri": "https://crm.example.com/callback",
        },
    ).json()

    response = client.get(
        "/oauth/userinfo",
        headers={"Authorization": f"Bearer {token['access_token']}"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["has_password"] is False
    assert payload["identities"] == [
        {"provider": "email", "provider_email": "state@example.com"}
    ]


def _local_account(db_session: Session) -> User:
    user = User(
        username="alice",
        email="alice@example.com",
        email_verified_at=None,
        hashed_password=hash_password("OldPass1!"),
        status="active",
    )
    db_session.add(user)
    db_session.commit()
    return user


def test_link_existing_merges_bare_wechat_account(
    client: TestClient, db_session: Session
) -> None:
    """A bare wechat account merges into a local one and gets a fresh token."""
    bare = _wechat_skip_user(db_session)
    application = create_test_application(db_session)
    db_session.add(
        ApplicationUser(
            application_id=application["id"], user_id=bare.id, status="active", joined_at=func.now()
        )
    )
    db_session.commit()
    alice = _local_account(db_session)
    bare_token = create_access_token(
        subject=str(bare.id), application_id=application["id"], expires_in=3600
    )
    headers = {"Authorization": f"Bearer {bare_token}"}

    response = client.post(
        "/account/link-existing",
        headers=headers,
        json={"identifier": "alice", "password": "OldPass1!"},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["profile"]["user"]["id"] == alice.id
    assert payload["access_token"]

    db_session.expire_all()
    assert db_session.get(User, bare.id) is None
    providers = db_session.scalars(
        select(UserIdentity.provider).where(UserIdentity.user_id == alice.id)
    ).all()
    assert sorted(providers) == ["wechat"]
    membership = db_session.scalar(
        select(ApplicationUser).where(
            ApplicationUser.application_id == application["id"],
            ApplicationUser.user_id == alice.id,
        )
    )
    assert membership is not None

    userinfo = client.get(
        "/oauth/userinfo", headers={"Authorization": f"Bearer {payload['access_token']}"}
    )
    assert userinfo.status_code == 200
    assert userinfo.json()["user"]["id"] == alice.id


def test_link_existing_rejects_wrong_password_and_non_bare_accounts(
    client: TestClient, db_session: Session
) -> None:
    bare = _wechat_skip_user(db_session)
    alice = _local_account(db_session)
    headers, _ = _bearer(db_session, bare)

    wrong = client.post(
        "/account/link-existing",
        headers=headers,
        json={"identifier": "alice", "password": "WrongPass1!"},
    )
    assert wrong.status_code == 401

    credentialed = User(hashed_password=hash_password("SomePass1!"), status="active")
    db_session.add(credentialed)
    db_session.commit()
    credentialed_headers, _ = _bearer(db_session, credentialed)
    conflict = client.post(
        "/account/link-existing",
        headers=credentialed_headers,
        json={"identifier": "alice", "password": "OldPass1!"},
    )
    assert conflict.status_code == 409


def test_link_existing_rejects_target_with_same_provider(
    client: TestClient, db_session: Session
) -> None:
    bare = _wechat_skip_user(db_session)
    alice = _local_account(db_session)
    db_session.add(
        UserIdentity(
            user_id=alice.id,
            provider="wechat",
            provider_user_id="another-wechat-id",
            raw_profile={},
        )
    )
    db_session.commit()
    headers, _ = _bearer(db_session, bare)

    response = client.post(
        "/account/link-existing",
        headers=headers,
        json={"identifier": "alice", "password": "OldPass1!"},
    )
    assert response.status_code == 409


def test_link_existing_via_sso_cookie_rotates_session(
    client: TestClient, db_session: Session
) -> None:
    """The cookie path swaps the SSO session onto the target account."""
    bare = _wechat_skip_user(db_session)
    alice = _local_account(db_session)
    client.cookies.set("passport_sso", create_sso_session(db_session, user_id=bare.id))

    response = client.post(
        "/account/link-existing",
        json={"identifier": "alice", "password": "OldPass1!"},
    )
    assert response.status_code == 200
    assert response.json()["access_token"] is None

    profile = client.get("/account/profile")
    assert profile.status_code == 200
    assert profile.json()["user"]["id"] == alice.id
    client.cookies.delete("passport_sso")
