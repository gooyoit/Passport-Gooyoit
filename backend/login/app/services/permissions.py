"""RBAC and PyCasbin permission service."""

import casbin
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Application,
    ApplicationUser,
    Permission,
    Role,
    RolePermission,
    UserRole,
)


CASBIN_MODEL = """
[request_definition]
r = sub, dom, obj, act

[policy_definition]
p = sub, dom, obj, act

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = r.sub == p.sub && r.dom == p.dom && r.obj == p.obj && r.act == p.act
"""


def get_effective_roles(db: Session, application_id: int, user_id: int) -> list[Role]:
    """Return default role plus explicit roles for one application user."""
    application = db.get(Application, application_id)
    if application is None or application.status != "active":
        return []

    membership = db.scalar(
        select(ApplicationUser).where(
            ApplicationUser.application_id == application_id,
            ApplicationUser.user_id == user_id,
        )
    )
    if membership is None or membership.status != "active":
        return []

    roles_by_id: dict[int, Role] = {}
    if application.default_role_id is not None:
        default_role = db.get(Role, application.default_role_id)
        if default_role is not None:
            roles_by_id[default_role.id] = default_role

    explicit_roles = db.scalars(
        select(Role)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(
            UserRole.application_id == application_id,
            UserRole.user_id == user_id,
            Role.application_id == application_id,
        )
    ).all()
    for role in explicit_roles:
        roles_by_id[role.id] = role
    return list(roles_by_id.values())


def build_enforcer(db: Session, application_id: int) -> casbin.Enforcer:
    """Build a PyCasbin enforcer from role-permission rows."""
    model = casbin.model.Model()
    model.load_model_from_text(CASBIN_MODEL)
    enforcer = casbin.Enforcer(model)
    enforcer.clear_policy()

    rows = db.execute(
        select(Role.code, Permission.code)
        .join(RolePermission, RolePermission.role_id == Role.id)
        .join(Permission, Permission.id == RolePermission.permission_id)
        .where(Role.application_id == application_id, Permission.application_id == application_id)
    ).all()
    for role_code, permission_code in rows:
        enforcer.add_policy(role_code, str(application_id), permission_code, "allow")
    return enforcer


def get_effective_permissions(db: Session, application_id: int, user_id: int) -> list[str]:
    application = db.get(Application, application_id)
    if application is None or application.status != "active":
        return []
    membership = db.scalar(
        select(ApplicationUser).where(
            ApplicationUser.application_id == application_id,
            ApplicationUser.user_id == user_id,
            ApplicationUser.status == "active",
        )
    )
    if membership is None:
        return []
    role_ids: list[int] = []
    if application.default_role_id is not None:
        role_ids.append(application.default_role_id)
    explicit = db.scalars(
        select(UserRole.role_id).where(
            UserRole.application_id == application_id,
            UserRole.user_id == user_id,
        )
    ).all()
    role_ids.extend(explicit)
    if not role_ids:
        return []
    return sorted(
        db.scalars(
            select(Permission.code)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .where(RolePermission.role_id.in_(role_ids))
            .distinct()
        ).all()
    )
