"""Account center API tests."""

import secrets

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import create_access_token, hash_password
from app.models import ApplicationUser, User, UserIdentity
from app.services.sso import create_sso_session

from conftest import FakeRedis, create_test_application, request_sms_code


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


def test_bind_email_happy_path_and_conflicts(
    client: TestClient, db_session: Session
) -> None:
    """Binding is immediate (no verification code), idempotent, and rejects taken emails."""
    user = _wechat_skip_user(db_session)
    headers, _ = _bearer(db_session, user)

    bound = client.post(
        "/account/email/bind",
        headers=headers,
        json={"email": "bind@example.com"},
    )
    assert bound.status_code == 200
    assert bound.json()["user"]["email"] == "bind@example.com"
    assert bound.json()["user"]["email_verified"] is False

    db_session.expire_all()
    refreshed = db_session.get(User, user.id)
    assert refreshed.email == "bind@example.com"
    assert (
        db_session.query(UserIdentity)
        .filter_by(user_id=user.id, provider="email")
        .count()
        == 1
    )

    # Re-binding the same email is idempotent.
    again = client.post(
        "/account/email/bind", headers=headers, json={"email": "bind@example.com"}
    )
    assert again.status_code == 200

    # An email owned by another account cannot be bound.
    late_user = _wechat_skip_user(db_session)
    late_headers, _ = _bearer(db_session, late_user)
    taken = client.post(
        "/account/email/bind", headers=late_headers, json={"email": "bind@example.com"}
    )
    assert taken.status_code == 409

    # A fresh email binds fine, but swapping to a third party's email is rejected.
    latecomer = client.post(
        "/account/email/bind", headers=late_headers, json={"email": "late@example.com"}
    )
    assert latecomer.status_code == 200
    owner = User(email="owner@example.com", status="active")
    db_session.add(owner)
    db_session.commit()
    swap = client.post(
        "/account/email/bind", headers=late_headers, json={"email": "owner@example.com"}
    )
    assert swap.status_code == 409


def test_credentials_enable_password_login(
    client: TestClient, db_session: Session
) -> None:
    """A wechat-skip user can set username+password and then log in with them."""
    user = _wechat_skip_user(db_session)
    headers, application = _bearer(db_session, user)

    # Bearer tokens speak for one app's session, not global account control.
    forbidden = client.post(
        "/account/credentials",
        headers=headers,
        json={"username": "center_user", "password": "StrongPass1!"},
    )
    assert forbidden.status_code == 403

    client.cookies.set("passport_sso", create_sso_session(db_session, user_id=user.id))
    response = client.post(
        "/account/credentials",
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
        json={"username": "center_user"},
    )
    assert conflict.status_code == 200  # idempotent same-username update

    duplicate_holder = User(username="taken_name", status="active")
    db_session.add(duplicate_holder)
    db_session.commit()
    duplicate = client.post(
        "/account/credentials", json={"username": "taken_name"}
    )
    assert duplicate.status_code == 409

    weak = client.post(
        "/account/credentials", json={"password": "password"}
    )
    assert weak.status_code == 422

    empty = client.post("/account/credentials", json={})
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
    client.cookies.set("passport_sso", create_sso_session(db_session, user_id=user.id))

    missing = client.post(
        "/account/credentials", json={"password": "NewPass1!"}
    )
    assert missing.status_code == 401

    wrong = client.post(
        "/account/credentials",
        json={"password": "NewPass1!", "current_password": "WrongPass1!"},
    )
    assert wrong.status_code == 401

    ok = client.post(
        "/account/credentials",
        json={"password": "NewPass1!", "current_password": "OldPass1!"},
    )
    assert ok.status_code == 200

    phone = client.post(
        "/account/credentials",
        json={"contact_phone": "+86 138-0013-8000"},
    )
    assert phone.status_code == 200
    assert phone.json()["user"]["contact_phone"] == "+8613800138000"


def test_userinfo_exposes_binding_state(
    client: TestClient, db_session: Session, sms_sender
) -> None:
    """userinfo now tells business apps whether the user needs completion."""
    application = create_test_application(db_session, login_methods=["sms_code", "email_password"])
    debug_code = request_sms_code(
        client, application["client_id"], "13800138000"
    )["debug_code"]
    auth_code = client.post(
        "/auth/sms/login",
        json={
            "client_id": application["client_id"],
            "redirect_uri": "https://crm.example.com/callback",
            "phone": "13800138000",
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
    assert payload["identities"] == [{"provider": "phone", "provider_email": None}]


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


def test_browser_logout_revokes_sso_and_redirects(
    client: TestClient, db_session: Session
) -> None:
    """Top-level logout kills the SSO session and honors origin-whitelisted
    return URLs."""
    from app.models import SsoSession

    user = _wechat_skip_user(db_session)
    application = create_test_application(
        db_session, redirect_uris=["https://crm.example.com/callback"]
    )
    token = create_sso_session(db_session, user_id=user.id)
    db_session.commit()
    session_id_hash = (
        db_session.query(SsoSession).filter_by(user_id=user.id).one().session_id_hash
    )
    client.cookies.set("passport_sso", token)

    allowed = client.get(
        "/auth/logout",
        params={
            "client_id": application["client_id"],
            "post_logout_redirect_uri": "https://crm.example.com/login",
        },
        follow_redirects=False,
    )
    assert allowed.status_code == 302
    assert allowed.headers["location"] == "https://crm.example.com/login"

    outside = client.get(
        "/auth/logout",
        params={
            "client_id": application["client_id"],
            "post_logout_redirect_uri": "https://evil.example.com/phish",
        },
        follow_redirects=False,
    )
    assert outside.status_code == 302
    assert outside.headers["location"] == "/"

    # Cross-tenant: another registered app's origin is not allowed either.
    other = create_test_application(
        db_session, name="Other", redirect_uris=["https://other.example.com/cb"]
    )
    cross = client.get(
        "/auth/logout",
        params={
            "client_id": other["client_id"],
            "post_logout_redirect_uri": "https://crm.example.com/home",
        },
        follow_redirects=False,
    )
    assert cross.status_code == 302
    assert cross.headers["location"] == "/"

    db_session.expire_all()
    revoked = (
        db_session.query(SsoSession)
        .filter_by(session_id_hash=session_id_hash)
        .one()
        .revoked_at
    )
    assert revoked is not None


def test_registration_hidden_and_rejected_when_public_signup_disabled(
    client: TestClient, db_session: Session
) -> None:
    """Closed apps do not advertise registration and reject register codes."""
    application = create_test_application(
        db_session, enable_public_users=False, login_methods=["sms_code", "email_password"]
    )

    methods = client.get(
        "/oauth/login-methods", params={"client_id": application["client_id"]}
    )
    assert methods.status_code == 200
    assert methods.json()["allow_registration"] is False

    rejected = client.post(
        "/auth/sms/request-code",
        json={
            "client_id": application["client_id"],
            "phone": "13800138000",
            "purpose": "register",
            "captcha_verify_param": "test-captcha-token",
        },
    )
    assert rejected.status_code == 400
    assert rejected.json()["detail"] == "Registration is disabled"


def test_link_existing_locks_out_brute_force(
    client: TestClient, db_session: Session, monkeypatch
) -> None:
    """Repeated wrong merge passwords trigger the lockout."""
    from app.api import account as account_api

    class LockRedis(FakeRedis):
        pass

    redis = LockRedis()
    monkeypatch.setattr(account_api, "get_redis_client", lambda: redis)

    bare = _wechat_skip_user(db_session)
    alice = _local_account(db_session)
    headers, _ = _bearer(db_session, bare)

    for _ in range(5):
        response = client.post(
            "/account/link-existing",
            headers=headers,
            json={"identifier": "alice", "password": "WrongPass1!"},
        )
        assert response.status_code == 401

    locked = client.post(
        "/account/link-existing",
        headers=headers,
        json={"identifier": "alice", "password": "OldPass1!"},
    )
    assert locked.status_code == 429


def _phone_owner(db_session: Session, phone: str, username: str) -> User:
    """Insert the account an SMS login would have created for this phone."""
    owner = User(
        username=username,
        phone=phone,
        phone_verified_at=func.now(),
        hashed_password=None,
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


def test_phone_bind_happy_path_enables_phone_login(
    client: TestClient, db_session: Session, sms_sender
) -> None:
    """Binding a free phone attaches the credential and enables phone login."""
    user = _wechat_skip_user(db_session)
    application = create_test_application(db_session, login_methods=["sms_code", "email_password"])
    headers, _ = _bearer(db_session, user)

    requested = client.post(
        "/account/phone/request-code",
        headers=headers,
        json={"phone": "13800138000", "captcha_verify_param": "test-captcha-token"},
    )
    assert requested.status_code == 200, requested.text
    assert requested.json()["sent"] is True
    debug_code = requested.json()["debug_code"]
    assert debug_code

    bound = client.post(
        "/account/phone/bind",
        headers=headers,
        json={"phone": "13800138000", "code": debug_code},
    )
    assert bound.status_code == 200, bound.text
    payload = bound.json()
    assert payload["access_token"] is None  # no merge happened
    assert {"provider": "phone", "provider_email": None} in payload["profile"]["identities"]

    login = client.post(
        "/auth/email/login-password",
        json={
            "client_id": application["client_id"],
            "redirect_uri": "https://crm.example.com/callback",
            "identifier": "13800138000",
            "password": "whatever-does-not-matter",
        },
    )
    # The account has no password yet, but the identifier must resolve —
    # a wrong-password 401 (not 404-style rejection) proves phone resolution.
    assert login.status_code == 401

    # Re-binding the same phone is idempotent.
    again_code = client.post(
        "/account/phone/request-code",
        headers=headers,
        json={"phone": "138 0013 8000", "captcha_verify_param": "t"},
    ).json()["debug_code"]
    again = client.post(
        "/account/phone/bind",
        headers=headers,
        json={"phone": "+8613800138000", "code": again_code},
    )
    assert again.status_code == 200
    assert again.json()["access_token"] is None


def test_phone_bind_merges_wechat_account_into_phone_owner(
    client: TestClient, db_session: Session, sms_sender
) -> None:
    """A phone owned by another account claims the caller via merge."""
    from app.models import ApplicationUser

    bare = _wechat_skip_user(db_session)
    application = create_test_application(db_session)
    db_session.add(
        ApplicationUser(
            application_id=application["id"], user_id=bare.id, status="active", joined_at=func.now()
        )
    )
    db_session.commit()
    owner = _phone_owner(db_session, "13900139000", "phone_owner")
    headers, _ = _bearer(db_session, bare)

    code = client.post(
        "/account/phone/request-code",
        headers=headers,
        json={"phone": "13900139000", "captcha_verify_param": "t"},
    ).json()["debug_code"]
    merged = client.post(
        "/account/phone/bind",
        headers=headers,
        json={"phone": "13900139000", "code": code},
    )
    assert merged.status_code == 200, merged.text
    payload = merged.json()
    assert payload["access_token"]  # fresh token for the surviving account
    assert payload["profile"]["user"]["id"] == owner.id
    providers = sorted(
        i["provider"]
        for i in payload["profile"]["identities"]
    )
    assert providers == ["phone", "wechat"]

    db_session.expire_all()
    assert db_session.get(User, bare.id) is None
    # The fresh token resolves to the surviving account.
    userinfo = client.get(
        "/oauth/userinfo", headers={"Authorization": f"Bearer {payload['access_token']}"}
    )
    assert userinfo.status_code == 200
    assert userinfo.json()["user"]["id"] == owner.id
    membership = db_session.scalar(
        select(ApplicationUser).where(
            ApplicationUser.application_id == application["id"],
            ApplicationUser.user_id == owner.id,
        )
    )
    assert membership is not None


def test_phone_bind_merges_via_sso_cookie_rotates_session(
    client: TestClient, db_session: Session, sms_sender
) -> None:
    """The cookie path swaps the SSO session onto the phone's account."""
    bare = _wechat_skip_user(db_session)
    owner = _phone_owner(db_session, "13700137000", "cookie_owner")
    client.cookies.set("passport_sso", create_sso_session(db_session, user_id=bare.id))

    code = client.post(
        "/account/phone/request-code",
        json={"phone": "13700137000", "captcha_verify_param": "t"},
    ).json()["debug_code"]
    merged = client.post(
        "/account/phone/bind",
        json={"phone": "13700137000", "code": code},
    )
    assert merged.status_code == 200
    assert merged.json()["access_token"] is None
    assert merged.json()["profile"]["user"]["id"] == owner.id

    profile = client.get("/account/profile")
    assert profile.status_code == 200
    assert profile.json()["user"]["id"] == owner.id
    client.cookies.delete("passport_sso")


def test_phone_bind_cookie_path_rejects_bad_captcha(
    client: TestClient, db_session: Session, monkeypatch
) -> None:
    """The anonymous-facing cookie path fails closed on a bad captcha."""
    from app.api import account as account_api

    user = _wechat_skip_user(db_session)
    client.cookies.set("passport_sso", create_sso_session(db_session, user_id=user.id))
    monkeypatch.setattr(account_api, "verify_captcha", lambda param: False)

    rejected = client.post(
        "/account/phone/request-code",
        json={"phone": "13600136000", "captcha_verify_param": "bad"},
    )
    assert rejected.status_code == 400
    client.cookies.delete("passport_sso")


def test_phone_bind_refuses_merge_into_inactive_owner(
    client: TestClient, db_session: Session, sms_sender
) -> None:
    """An inactive phone-owner account blocks the merge instead of being claimed."""
    bare = _wechat_skip_user(db_session)
    owner = _phone_owner(db_session, "13400134000", "inactive_owner")
    owner.status = "inactive"
    db_session.commit()
    headers, _ = _bearer(db_session, bare)

    code = client.post(
        "/account/phone/request-code",
        headers=headers,
        json={"phone": "13400134000", "captcha_verify_param": "t"},
    ).json()["debug_code"]
    refused = client.post(
        "/account/phone/bind",
        headers=headers,
        json={"phone": "13400134000", "code": code},
    )
    assert refused.status_code == 403

    db_session.expire_all()
    assert db_session.get(User, bare.id) is not None
    assert db_session.get(User, owner.id) is not None


def test_phone_bind_wrong_code_locks_out(
    client: TestClient, db_session: Session, sms_sender, monkeypatch
) -> None:
    """Repeated wrong SMS codes trigger the brute-force lockout."""
    from app.api import account as account_api

    redis = FakeRedis()
    monkeypatch.setattr(account_api, "get_redis_client", lambda: redis)

    user = _wechat_skip_user(db_session)
    headers, _ = _bearer(db_session, user)
    client.post(
        "/account/phone/request-code",
        headers=headers,
        json={"phone": "13500135000", "captcha_verify_param": "t"},
    )

    for _ in range(5):
        wrong = client.post(
            "/account/phone/bind",
            headers=headers,
            json={"phone": "13500135000", "code": "000000"},
        )
        assert wrong.status_code == 400

    locked = client.post(
        "/account/phone/bind",
        headers=headers,
        json={"phone": "13500135000", "code": "000000"},
    )
    assert locked.status_code == 429
