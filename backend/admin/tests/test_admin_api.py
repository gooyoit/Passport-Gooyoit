"""Admin API tests."""

from fastapi.testclient import TestClient


def test_admin_can_list_application_configuration(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    """Admin can inspect applications, login methods, roles, and permissions."""
    app_payload = client.post(
        "/admin/applications",
        headers=admin_headers,
        json={
            "name": "Console",
            "redirect_uris": ["https://console.example.com/callback"],
            "enable_public_users": True,
        },
    ).json()

    apps_response = client.get("/admin/applications", headers=admin_headers)
    assert apps_response.status_code == 200
    assert apps_response.json()[0]["client_id"] == app_payload["client_id"]

    methods_response = client.get(
        f"/admin/applications/{app_payload['id']}/login-methods",
        headers=admin_headers,
    )
    assert methods_response.status_code == 200
    assert methods_response.json()[0]["method"] == "email_code"

    roles_response = client.get(
        f"/admin/applications/{app_payload['id']}/roles",
        headers=admin_headers,
    )
    assert roles_response.status_code == 200
    assert roles_response.json()[0]["code"] == "member"

    client.post(
        f"/admin/applications/{app_payload['id']}/permissions",
        headers=admin_headers,
        json={"code": "console.read", "name": "Read console"},
    )
    permissions_response = client.get(
        f"/admin/applications/{app_payload['id']}/permissions",
        headers=admin_headers,
    )
    assert permissions_response.status_code == 200
    assert permissions_response.json()[0]["code"] == "console.read"


def test_admin_can_manage_users(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    """Admin can list global and application users and disable application access."""
    app_payload = client.post(
        "/admin/applications",
        headers=admin_headers,
        json={
            "name": "Console",
            "redirect_uris": ["https://console.example.com/callback"],
            "enable_public_users": True,
        },
    ).json()
    debug_code = client.post(
        "/auth/email/request-code",
        json={"client_id": app_payload["client_id"], "email": "user@example.com"},
    ).json()["debug_code"]
    client.post(
        "/auth/email/login",
        json={
            "client_id": app_payload["client_id"],
            "redirect_uri": "https://console.example.com/callback",
            "email": "user@example.com",
            "code": debug_code,
        },
    )

    users_response = client.get("/admin/users", headers=admin_headers)
    assert users_response.status_code == 200
    user_id = users_response.json()[0]["id"]

    app_users_response = client.get(
        f"/admin/applications/{app_payload['id']}/users",
        headers=admin_headers,
    )
    assert app_users_response.status_code == 200
    assert app_users_response.json()[0]["roles"] == ["member"]

    disabled_response = client.patch(
        f"/admin/applications/{app_payload['id']}/users/{user_id}/status",
        headers=admin_headers,
        json={"status": "disabled"},
    )
    assert disabled_response.status_code == 200
    assert disabled_response.json()["status"] == "disabled"


def test_oauth_provider_status_reflects_login_method(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    """Provider status reports whether third-party login is enabled."""
    app_payload = client.post(
        "/admin/applications",
        headers=admin_headers,
        json={
            "name": "Console",
            "redirect_uris": ["https://console.example.com/callback"],
        },
    ).json()

    disabled_response = client.get(
        f"/oauth/providers/github?client_id={app_payload['client_id']}",
    )
    assert disabled_response.status_code == 200
    assert disabled_response.json() == {
        "provider": "github",
        "enabled": False,
        "authorization_url": None,
    }

    client.post(
        f"/admin/applications/{app_payload['id']}/login-methods",
        headers=admin_headers,
        json={"method": "github", "enabled": True},
    )
    enabled_response = client.get(
        f"/oauth/providers/github?client_id={app_payload['client_id']}",
    )
    assert enabled_response.status_code == 200
    assert enabled_response.json()["enabled"] is True


def test_oauth_provider_authorize_requires_authlib_config(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    """Provider authorize path uses Authlib config and rejects missing credentials."""
    app_payload = client.post(
        "/admin/applications",
        headers=admin_headers,
        json={
            "name": "Console",
            "redirect_uris": ["https://console.example.com/callback"],
        },
    ).json()
    client.post(
        f"/admin/applications/{app_payload['id']}/login-methods",
        headers=admin_headers,
        json={"method": "github", "enabled": True},
    )

    response = client.get(
        "/oauth/providers/github/authorize"
        f"?client_id={app_payload['client_id']}"
        "&redirect_uri=https://console.example.com/callback",
    )
    assert response.status_code == 400
    assert "client_id/client_secret" in response.json()["detail"]
