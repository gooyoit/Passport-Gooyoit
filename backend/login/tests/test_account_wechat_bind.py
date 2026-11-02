"""Account center WeChat binding (start/callback) flow tests."""

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.api import account as account_api
from app.core.security import create_access_token
from app.models import User, UserIdentity
from app.services.sso import create_sso_session

from conftest import create_test_application


def _plain_user(db_session: Session) -> User:
    user = User(display_name="微信用户", status="active")
    db_session.add(user)
    db_session.commit()
    return user


def _wechat_config(db_session: Session) -> dict:
    """Create an application whose wechat login method has usable credentials."""
    application = create_test_application(db_session, login_methods=["wechat"])
    method = db_session.scalar(
        select(models.ApplicationLoginMethod).where(
            models.ApplicationLoginMethod.application_id == application["id"],
            models.ApplicationLoginMethod.method == "wechat",
        )
    )
    method.config = {"client_id": "wx-appid-1", "client_secret": "wx-secret-1"}
    db_session.commit()
    return application


def _sso_cookie(client: TestClient, db_session: Session, user: User) -> None:
    sso_token = create_sso_session(db_session, user_id=user.id)
    client.cookies.set("passport_sso", sso_token)


def test_wechat_bind_start_requires_sso_cookie(
    client: TestClient, db_session: Session
) -> None:
    """Anonymous callers get 401; application bearer tokens get 403."""
    _wechat_config(db_session)
    assert (
        client.get("/account/wechat/bind/start", follow_redirects=False).status_code
        == 401
    )

    user = _plain_user(db_session)
    application = create_test_application(db_session, login_methods=["wechat"])
    token = create_access_token(
        subject=str(user.id), application_id=application["id"], expires_in=3600
    )
    bearer = client.get(
        "/account/wechat/bind/start",
        headers={"Authorization": f"Bearer {token}"},
        follow_redirects=False,
    )
    assert bearer.status_code == 403


def test_wechat_bind_start_redirects_to_wechat_authorize(
    client: TestClient, db_session: Session
) -> None:
    """The SSO-cookie path sends the browser to WeChat with the bind callback."""
    _wechat_config(db_session)
    user = _plain_user(db_session)
    _sso_cookie(client, db_session, user)

    response = client.get("/account/wechat/bind/start", follow_redirects=False)
    assert response.status_code in (302, 307)
    location = response.headers["location"]
    assert "open.weixin.qq.com" in location
    assert "appid=wx-appid-1" in location
    assert "redirect_uri=" in location


def test_wechat_bind_start_requires_wechat_method(
    client: TestClient, db_session: Session
) -> None:
    """Without any wechat-configured application the bind cannot start."""
    create_test_application(db_session, login_methods=["sms_code"])
    user = _plain_user(db_session)
    _sso_cookie(client, db_session, user)

    response = client.get("/account/wechat/bind/start", follow_redirects=False)
    assert response.status_code == 400


def test_wechat_bind_callback_attaches_identity(
    client: TestClient, db_session: Session, monkeypatch
) -> None:
    """A fresh wechat identity is attached to the account that started the bind."""
    _wechat_config(db_session)
    user = _plain_user(db_session)
    _sso_cookie(client, db_session, user)
    start = client.get("/account/wechat/bind/start", follow_redirects=False)
    assert start.status_code in (302, 307)

    async def fake_fetch(provider, wechat_client, request):
        return {
            "id": "unionid-new",
            "email": None,
            "name": "wx-user",
            "avatar_url": None,
            "raw": {"nickname": "wx-user"},
        }

    monkeypatch.setattr(account_api, "fetch_provider_profile", fake_fetch)

    response = client.get("/account/wechat/bind/callback", follow_redirects=False)
    assert response.status_code in (302, 307)
    assert response.headers["location"].endswith("/account/settings?bind=ok")
    assert (
        db_session.query(UserIdentity)
        .filter_by(user_id=user.id, provider="wechat", provider_user_id="unionid-new")
        .count()
        == 1
    )


def test_wechat_bind_callback_is_idempotent(
    client: TestClient, db_session: Session, monkeypatch
) -> None:
    """Binding the same wechat identity twice still reports ok."""
    _wechat_config(db_session)
    user = _plain_user(db_session)
    _sso_cookie(client, db_session, user)

    async def fake_fetch(provider, wechat_client, request):
        return {"id": "unionid-same", "email": None, "name": "wx", "avatar_url": None, "raw": {}}

    monkeypatch.setattr(account_api, "fetch_provider_profile", fake_fetch)

    for _ in range(2):
        start = client.get("/account/wechat/bind/start", follow_redirects=False)
        assert start.status_code in (302, 307)
        callback = client.get("/account/wechat/bind/callback", follow_redirects=False)
        assert callback.headers["location"].endswith("/account/settings?bind=ok")

    assert (
        db_session.query(UserIdentity)
        .filter_by(user_id=user.id, provider="wechat", provider_user_id="unionid-same")
        .count()
        == 1
    )


def test_wechat_bind_callback_reports_conflict(
    client: TestClient, db_session: Session, monkeypatch
) -> None:
    """A wechat identity owned by another account is reported, never stolen."""
    _wechat_config(db_session)
    user = _plain_user(db_session)
    other = _plain_user(db_session)
    db_session.add(
        UserIdentity(
            user_id=other.id,
            provider="wechat",
            provider_user_id="unionid-taken",
            raw_profile={},
        )
    )
    db_session.commit()
    _sso_cookie(client, db_session, user)
    start = client.get("/account/wechat/bind/start", follow_redirects=False)
    assert start.status_code in (302, 307)

    async def fake_fetch(provider, wechat_client, request):
        return {"id": "unionid-taken", "email": None, "name": "wx", "avatar_url": None, "raw": {}}

    monkeypatch.setattr(account_api, "fetch_provider_profile", fake_fetch)

    response = client.get("/account/wechat/bind/callback", follow_redirects=False)
    assert response.headers["location"].endswith("/account/settings?bind=conflict")
    # The identity still belongs to its original owner.
    identity = db_session.scalar(
        select(UserIdentity).where(
            UserIdentity.provider == "wechat",
            UserIdentity.provider_user_id == "unionid-taken",
        )
    )
    assert identity.user_id == other.id


def test_wechat_bind_callback_without_intent_redirects_error(
    client: TestClient, db_session: Session
) -> None:
    """A callback with no session intent (expired/lost cookie) lands on error."""
    _wechat_config(db_session)
    response = client.get("/account/wechat/bind/callback", follow_redirects=False)
    assert response.status_code in (302, 307)
    assert response.headers["location"].endswith("/account/settings?bind=error")
