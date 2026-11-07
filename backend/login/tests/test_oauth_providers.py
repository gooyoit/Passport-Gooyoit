"""Unit tests for OAuth provider client credential resolution."""
import asyncio
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app import models
from app.core.config import settings
from app.services.oauth_providers import build_oauth_client, fetch_provider_profile

from conftest import create_test_application


def test_build_client_uses_plaintext_secret_from_config(monkeypatch):
    client = build_oauth_client(
        "wechat",
        {"client_id": "wx-app", "client_secret": "plain-secret", "client_secret_env": "SHOULD_NOT_BE_USED"},
    )
    assert client.client_id == "wx-app"
    assert client.client_secret == "plain-secret"


def test_build_client_falls_back_to_env_secret(monkeypatch):
    monkeypatch.setenv("PASSPORT_WECHAT_CLIENT_SECRET", "env-secret")
    client = build_oauth_client(
        "wechat",
        {"client_id": "wx-app", "client_secret_env": "PASSPORT_WECHAT_CLIENT_SECRET"},
    )
    assert client.client_secret == "env-secret"


def test_build_client_missing_env_value_is_rejected(monkeypatch):
    monkeypatch.delenv("PASSPORT_WECHAT_CLIENT_SECRET", raising=False)
    with pytest.raises(HTTPException) as exc_info:
        build_oauth_client(
            "wechat",
            {"client_id": "wx-app", "client_secret_env": "PASSPORT_WECHAT_CLIENT_SECRET"},
        )
    assert exc_info.value.status_code == 400


def test_build_client_without_any_secret_is_rejected():
    with pytest.raises(HTTPException) as exc_info:
        build_oauth_client("wechat", {"client_id": "wx-app"})
    assert exc_info.value.status_code == 400


def test_wechat_authorization_uses_appid_parameter(monkeypatch):
    monkeypatch.setenv("PASSPORT_WECHAT_CLIENT_SECRET", "env-secret")
    client = build_oauth_client(
        "wechat",
        {
            "client_id": "wx-app",
            "client_secret_env": "PASSPORT_WECHAT_CLIENT_SECRET",
        },
    )

    result = asyncio.run(
        client.create_authorization_url("https://passport.example.com/callback")
    )
    parsed = urlsplit(result["url"])
    query = parse_qs(parsed.query)

    assert query["appid"] == ["wx-app"]
    assert "client_id" not in query
    assert query["scope"] == ["snsapi_login"]
    assert parsed.fragment == "wechat_redirect"


def test_wechat_profile_uses_query_parameters():
    class DummyClient:
        request_args = None

        async def authorize_access_token(self, request):
            return {"access_token": "access-token", "openid": "openid-1"}

        async def get(self, path, **kwargs):
            self.request_args = (path, kwargs)

            class Response:
                @staticmethod
                def json():
                    return {
                        "openid": "openid-1",
                        "nickname": "Passport User",
                    }

            return Response()

    client = DummyClient()
    profile = asyncio.run(fetch_provider_profile("wechat", client, object()))

    assert profile["id"] == "openid-1"
    assert client.request_args == (
        "sns/userinfo",
        {
            "params": {
                "access_token": "access-token",
                "openid": "openid-1",
                "lang": "zh_CN",
            },
            "withhold_token": True,
        },
    )


def test_provider_status_reflects_login_method(
    client: TestClient, db_session: Session
) -> None:
    """Provider status reports whether third-party login is enabled."""
    application = create_test_application(db_session)

    disabled_response = client.get(
        f"/oauth/providers/github?client_id={application['client_id']}",
    )
    assert disabled_response.status_code == 200
    assert disabled_response.json() == {
        "provider": "github",
        "enabled": False,
        "authorization_url": None,
    }

    db_session.add(
        models.ApplicationLoginMethod(
            application_id=application["id"],
            method="github",
            enabled=True,
            config={},
        )
    )
    db_session.commit()
    enabled_response = client.get(
        f"/oauth/providers/github?client_id={application['client_id']}",
    )
    assert enabled_response.status_code == 200
    assert enabled_response.json()["enabled"] is True


def test_provider_authorize_without_credentials_is_rejected(
    client: TestClient, db_session: Session
) -> None:
    """Provider authorize path rejects enabled methods without credentials."""
    application = create_test_application(db_session)
    db_session.add(
        models.ApplicationLoginMethod(
            application_id=application["id"],
            method="github",
            enabled=True,
            config={},
        )
    )
    db_session.commit()

    response = client.get(
        "/oauth/providers/github/authorize"
        f"?client_id={application['client_id']}"
        "&redirect_uri=https://crm.example.com/callback",
    )
    assert response.status_code == 400
    assert "client_id/client_secret" in response.json()["detail"]


def test_wechat_authorize_route_retains_clickjacking_protection(
    client: TestClient, db_session: Session
) -> None:
    """Only the WeChat redirect bootstrap may be embedded by the login page."""
    application = create_test_application(db_session)
    db_session.add(
        models.ApplicationLoginMethod(
            application_id=application["id"],
            method="wechat",
            enabled=True,
            config={},
        )
    )
    db_session.commit()

    response = client.get(
        "/oauth/providers/wechat/authorize"
        f"?client_id={application['client_id']}"
        "&redirect_uri=https://crm.example.com/callback",
    )

    assert response.status_code == 400
    assert response.headers["x-frame-options"] == "DENY"
    assert client.get("/healthz").headers["x-frame-options"] == "DENY"


def test_wechat_embed_url_is_returned_as_json(
    client: TestClient, db_session: Session, monkeypatch
) -> None:
    """The login page gets a direct WeChat iframe URL in the same session."""
    monkeypatch.setenv("PASSPORT_WECHAT_CLIENT_SECRET", "env-secret")
    application = create_test_application(db_session)
    db_session.add(
        models.ApplicationLoginMethod(
            application_id=application["id"],
            method="wechat",
            enabled=True,
            config={
                "client_id": "wx-app",
                "client_secret_env": "PASSPORT_WECHAT_CLIENT_SECRET",
            },
        )
    )
    db_session.commit()

    response = client.get(
        "/oauth/providers/wechat/embed-url"
        f"?client_id={application['client_id']}"
        "&redirect_uri=https://crm.example.com/callback"
        "&state=state-1",
    )

    assert response.status_code == 200, response.text
    authorization_url = response.json()["authorization_url"]
    query = parse_qs(urlsplit(authorization_url).query)
    assert query["appid"] == ["wx-app"]
    assert query["self_redirect"] == ["false"]
    assert query["href"][0].startswith("data:text/css;base64,")


def test_login_methods_include_wechat_with_global_credentials(
    client: TestClient, db_session: Session, monkeypatch
) -> None:
    """Deployment-wide WeChat credentials make WeChat available to every application."""
    monkeypatch.setattr(settings, "wechat_app_id", "wx-global")
    monkeypatch.setattr(settings, "wechat_app_secret", "wx-global-secret")

    application = create_test_application(
        db_session, login_methods=["sms_code", "email_password"]
    )

    response = client.get(f"/oauth/login-methods?client_id={application['client_id']}")

    assert response.status_code == 200, response.text
    assert "wechat" in response.json()["login_methods"]


def test_wechat_embed_url_uses_global_credentials(
    client: TestClient, db_session: Session, monkeypatch
) -> None:
    """The QR iframe works for an app that never configured WeChat itself."""
    monkeypatch.setattr(settings, "wechat_app_id", "wx-global")
    monkeypatch.setattr(settings, "wechat_app_secret", "wx-global-secret")
    application = create_test_application(db_session)

    response = client.get(
        "/oauth/providers/wechat/embed-url"
        f"?client_id={application['client_id']}"
        "&redirect_uri=https://crm.example.com/callback",
    )

    assert response.status_code == 200, response.text
    query = parse_qs(urlsplit(response.json()["authorization_url"]).query)
    assert query["appid"] == ["wx-global"]


def test_explicit_wechat_opt_out_beats_global_credentials(
    client: TestClient, db_session: Session, monkeypatch
) -> None:
    """An application that explicitly disables WeChat must not inherit it."""
    monkeypatch.setattr(settings, "wechat_app_id", "wx-global")
    monkeypatch.setattr(settings, "wechat_app_secret", "wx-global-secret")
    application = create_test_application(db_session)
    db_session.add(
        models.ApplicationLoginMethod(
            application_id=application["id"],
            method="wechat",
            enabled=False,
            config={},
        )
    )
    db_session.commit()

    methods = client.get(f"/oauth/login-methods?client_id={application['client_id']}")
    assert methods.status_code == 200
    assert "wechat" not in methods.json()["login_methods"]

    status = client.get(f"/oauth/providers/wechat?client_id={application['client_id']}")
    assert status.json()["enabled"] is False

    embed = client.get(
        "/oauth/providers/wechat/embed-url"
        f"?client_id={application['client_id']}"
        "&redirect_uri=https://crm.example.com/callback",
    )
    assert embed.status_code == 400
