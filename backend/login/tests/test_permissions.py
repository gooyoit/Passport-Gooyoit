"""Permission calculation tests."""

from fastapi.testclient import TestClient


def test_default_and_explicit_roles_grant_permission_union(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    """PyCasbin grants permissions from default and explicit roles."""
    app_response = client.post(
        "/admin/applications",
        headers=admin_headers,
        json={
            "name": "Ops",
            "redirect_uris": ["https://ops.example.com/callback"],
            "enable_public_users": True,
        },
    )
    application = app_response.json()
    application_id = application["id"]
    default_role_id = application["default_role_id"]

    read_permission = client.post(
        f"/admin/applications/{application_id}/permissions",
        headers=admin_headers,
        json={"code": "user.read", "name": "Read users"},
    ).json()
    write_permission = client.post(
        f"/admin/applications/{application_id}/permissions",
        headers=admin_headers,
        json={"code": "user.write", "name": "Write users"},
    ).json()
    admin_role = client.post(
        f"/admin/applications/{application_id}/roles",
        headers=admin_headers,
        json={"code": "admin", "name": "管理员"},
    ).json()

    client.post(
        f"/admin/applications/{application_id}/roles/{default_role_id}/permissions/{read_permission['id']}",
        headers=admin_headers,
    )
    client.post(
        f"/admin/applications/{application_id}/roles/{admin_role['id']}/permissions/{write_permission['id']}",
        headers=admin_headers,
    )

    debug_code = client.post(
        "/auth/email/request-code",
        json={"client_id": application["client_id"], "email": "admin@example.com"},
    ).json()["debug_code"]
    auth_code = client.post(
        "/auth/email/login",
        json={
            "client_id": application["client_id"],
            "redirect_uri": "https://ops.example.com/callback",
            "email": "admin@example.com",
            "code": debug_code,
        },
    ).json()["code"]
    token_payload = client.post(
        "/oauth/token",
        json={
            "client_id": application["client_id"],
            "client_secret": application["client_secret"],
            "code": auth_code,
            "redirect_uri": "https://ops.example.com/callback",
        },
    ).json()
    user_id = token_payload["user"]["id"]

    client.post(
        f"/admin/applications/{application_id}/users/{user_id}/roles/{admin_role['id']}",
        headers=admin_headers,
    )

    debug_code = client.post(
        "/auth/email/request-code",
        json={"client_id": application["client_id"], "email": "admin@example.com"},
    ).json()["debug_code"]
    auth_code = client.post(
        "/auth/email/login",
        json={
            "client_id": application["client_id"],
            "redirect_uri": "https://ops.example.com/callback",
            "email": "admin@example.com",
            "code": debug_code,
        },
    ).json()["code"]
    token_payload = client.post(
        "/oauth/token",
        json={
            "client_id": application["client_id"],
            "client_secret": application["client_secret"],
            "code": auth_code,
            "redirect_uri": "https://ops.example.com/callback",
        },
    ).json()

    assert sorted(token_payload["roles"]) == ["admin", "member"]
    assert token_payload["permissions"] == ["user.read", "user.write"]

