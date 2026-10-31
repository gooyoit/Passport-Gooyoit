"""Admin API tests."""

from fastapi.testclient import TestClient
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models


def _create_user_member(db: Session, application_id: int) -> models.User:
    """Insert a user with an active membership directly in the database."""
    user = models.User(
        email="user@example.com",
        email_verified_at=None,
        display_name="Example User",
        status="active",
    )
    db.add(user)
    db.flush()
    db.add(
        models.ApplicationUser(
            application_id=application_id,
            user_id=user.id,
            status="active",
            joined_at=func.now(),
        )
    )
    db.commit()
    return user


def test_admin_can_list_application_configuration(client: TestClient) -> None:
    """Admin can inspect applications, login methods, roles, and permissions."""
    app_payload = client.post(
        "/applications",
        json={
            "name": "Console",
            "redirect_uris": ["https://console.example.com/callback"],
            "enable_public_users": True,
        },
    ).json()

    apps_response = client.get("/applications")
    assert apps_response.status_code == 200
    assert apps_response.json()["items"][0]["client_id"] == app_payload["client_id"]

    methods_response = client.get(
        f"/applications/{app_payload['id']}/login-methods",
    )
    assert methods_response.status_code == 200
    assert methods_response.json()[0]["method"] == "email_code"

    roles_response = client.get(
        f"/applications/{app_payload['id']}/roles",
    )
    assert roles_response.status_code == 200
    assert roles_response.json()[0]["code"] == "member"

    client.post(
        f"/applications/{app_payload['id']}/permissions",
        json={"code": "console.read", "name": "Read console"},
    )
    permissions_response = client.get(
        f"/applications/{app_payload['id']}/permissions",
    )
    assert permissions_response.status_code == 200
    assert permissions_response.json()[0]["code"] == "console.read"


def test_admin_can_manage_users(client: TestClient, db_session: Session) -> None:
    """Admin can list global and application users and disable application access."""
    app_payload = client.post(
        "/applications",
        json={
            "name": "Console",
            "redirect_uris": ["https://console.example.com/callback"],
            "enable_public_users": True,
        },
    ).json()
    user = _create_user_member(db_session, app_payload["id"])

    users_response = client.get("/users")
    assert users_response.status_code == 200
    assert users_response.json()["items"][0]["id"] == user.id

    app_users_response = client.get(
        f"/applications/{app_payload['id']}/users",
    )
    assert app_users_response.status_code == 200
    assert app_users_response.json()["items"][0]["user_email"] == user.email

    disabled_response = client.patch(
        f"/applications/{app_payload['id']}/users/{user.id}/status",
        json={"status": "disabled"},
    )
    assert disabled_response.status_code == 200
    assert disabled_response.json()["status"] == "disabled"


def test_toggling_login_method_preserves_provider_config(
    client: TestClient,
) -> None:
    """Changing enabled state must not erase provider credentials."""
    app_payload = client.post(
        "/applications",
        json={
            "name": "Console",
            "redirect_uris": ["https://console.example.com/callback"],
        },
    ).json()
    endpoint = f"/applications/{app_payload['id']}/login-methods"
    config = {
        "client_id": "wx-example",
        "client_secret_env": "PASSPORT_WECHAT_CLIENT_SECRET",
    }

    configured_response = client.post(
        endpoint,
        json={"method": "wechat", "enabled": True, "config": config},
    )
    assert configured_response.status_code == 200

    toggled_response = client.post(
        endpoint,
        json={"method": "wechat", "enabled": False},
    )
    assert toggled_response.status_code == 200

    methods = client.get(endpoint).json()
    wechat = next(item for item in methods if item["method"] == "wechat")
    assert wechat["enabled"] is False
    assert wechat["config"] == config
