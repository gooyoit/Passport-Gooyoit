"""Permission calculation tests."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app import models

from conftest import create_test_application, request_sms_code, sms_sender  # noqa: F401


def test_default_and_explicit_roles_grant_permission_union(
    client: TestClient,
    db_session: Session,
    sms_sender,
) -> None:
    """PyCasbin grants permissions from default and explicit roles."""
    application = create_test_application(db_session, name="Ops", redirect_uris=["https://ops.example.com/callback"])
    application_id = application["id"]
    default_role_id = application["default_role_id"]

    read_permission = models.Permission(
        application_id=application_id, code="user.read", name="Read users"
    )
    write_permission = models.Permission(
        application_id=application_id, code="user.write", name="Write users"
    )
    db_session.add_all([read_permission, write_permission])
    db_session.flush()
    admin_role = models.Role(
        application_id=application_id, code="admin", name="管理员"
    )
    db_session.add(admin_role)
    db_session.flush()
    db_session.add_all(
        [
            models.RolePermission(
                role_id=default_role_id, permission_id=read_permission.id
            ),
            models.RolePermission(
                role_id=admin_role.id, permission_id=write_permission.id
            ),
        ]
    )
    db_session.commit()

    debug_code = request_sms_code(
        client, application["client_id"], "13800138000"
    )["debug_code"]
    auth_code = client.post(
        "/auth/sms/login",
        json={
            "client_id": application["client_id"],
            "redirect_uri": "https://ops.example.com/callback",
            "phone": "13800138000",
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

    db_session.add(
        models.UserRole(
            application_id=application_id, user_id=user_id, role_id=admin_role.id
        )
    )
    db_session.commit()

    debug_code = request_sms_code(
        client, application["client_id"], "13800138000"
    )["debug_code"]
    auth_code = client.post(
        "/auth/sms/login",
        json={
            "client_id": application["client_id"],
            "redirect_uri": "https://ops.example.com/callback",
            "phone": "13800138000",
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
