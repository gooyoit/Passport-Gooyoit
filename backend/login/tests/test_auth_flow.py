"""Authentication flow tests."""

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import UserRole


def create_public_application(client: TestClient, admin_headers: dict[str, str]) -> dict:
    """Create an application for tests."""
    response = client.post(
        "/admin/applications",
        headers=admin_headers,
        json={
            "name": "CRM",
            "redirect_uris": ["https://crm.example.com/callback"],
            "enable_public_users": True,
            "enable_sso": True,
        },
    )
    assert response.status_code == 201
    return response.json()


def test_email_login_code_exchange_and_userinfo(
    client: TestClient,
    admin_headers: dict[str, str],
    db_session: Session,
) -> None:
    """Email login issues one-time code, tokens, and default role."""
    application = create_public_application(client, admin_headers)

    code_response = client.post(
        "/auth/email/request-code",
        json={"client_id": application["client_id"], "email": "User@Example.com"},
    )
    assert code_response.status_code == 200
    debug_code = code_response.json()["debug_code"]

    login_response = client.post(
        "/auth/email/login",
        json={
            "client_id": application["client_id"],
            "redirect_uri": "https://crm.example.com/callback",
            "email": "user@example.com",
            "code": debug_code,
            "state": "state-1",
        },
    )
    assert login_response.status_code == 200
    authorization_code = login_response.json()["code"]

    token_response = client.post(
        "/oauth/token",
        json={
            "client_id": application["client_id"],
            "client_secret": application["client_secret"],
            "code": authorization_code,
            "redirect_uri": "https://crm.example.com/callback",
        },
    )
    assert token_response.status_code == 200
    token_payload = token_response.json()
    assert token_payload["user"]["email"] == "user@example.com"
    assert token_payload["roles"] == ["member"]
    assert token_payload["permissions"] == []

    second_exchange = client.post(
        "/oauth/token",
        json={
            "client_id": application["client_id"],
            "client_secret": application["client_secret"],
            "code": authorization_code,
            "redirect_uri": "https://crm.example.com/callback",
        },
    )
    assert second_exchange.status_code == 400

    userinfo_response = client.get(
        "/oauth/userinfo",
        headers={"Authorization": f"Bearer {token_payload['access_token']}"},
    )
    assert userinfo_response.status_code == 200
    assert userinfo_response.json()["roles"] == ["member"]

    user_roles_count = db_session.scalar(select(func.count()).select_from(UserRole))
    assert user_roles_count == 0


def test_refresh_token_and_logout(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    """Refresh token can renew access and logout revokes refresh token."""
    application = create_public_application(client, admin_headers)
    debug_code = client.post(
        "/auth/email/request-code",
        json={"client_id": application["client_id"], "email": "user@example.com"},
    ).json()["debug_code"]
    authorization_code = client.post(
        "/auth/email/login",
        json={
            "client_id": application["client_id"],
            "redirect_uri": "https://crm.example.com/callback",
            "email": "user@example.com",
            "code": debug_code,
        },
    ).json()["code"]
    token_payload = client.post(
        "/oauth/token",
        json={
            "client_id": application["client_id"],
            "client_secret": application["client_secret"],
            "code": authorization_code,
            "redirect_uri": "https://crm.example.com/callback",
        },
    ).json()

    refresh_response = client.post(
        "/oauth/token/refresh",
        json={
            "client_id": application["client_id"],
            "client_secret": application["client_secret"],
            "refresh_token": token_payload["refresh_token"],
        },
    )
    assert refresh_response.status_code == 200
    assert refresh_response.json()["user"]["email"] == "user@example.com"

    logout_response = client.post(
        "/oauth/logout",
        json={"refresh_token": token_payload["refresh_token"], "global_logout": True},
    )
    assert logout_response.status_code == 200
    assert logout_response.json()["refresh_token_revoked"] is True

    revoked_refresh_response = client.post(
        "/oauth/token/refresh",
        json={
            "client_id": application["client_id"],
            "client_secret": application["client_secret"],
            "refresh_token": token_payload["refresh_token"],
        },
    )
    assert revoked_refresh_response.status_code == 401


def test_invalid_redirect_uri_is_rejected(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    """Login rejects callback URLs that are not whitelisted."""
    application = create_public_application(client, admin_headers)
    code_response = client.post(
        "/auth/email/request-code",
        json={"client_id": application["client_id"], "email": "user@example.com"},
    )

    login_response = client.post(
        "/auth/email/login",
        json={
            "client_id": application["client_id"],
            "redirect_uri": "https://evil.example.com/callback",
            "email": "user@example.com",
            "code": code_response.json()["debug_code"],
        },
    )
    assert login_response.status_code == 400
