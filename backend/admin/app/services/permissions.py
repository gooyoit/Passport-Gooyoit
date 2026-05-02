"""RBAC permission helpers -- walk role_permissions and user_roles tables."""

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


def get_effective_roles(
    db: Session, application_id: int, user_id: int
) -> list[Role]:
    """Return the default role plus any explicit roles for a user in an application."""
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


def get_effective_permissions(
    db: Session, application_id: int, user_id: int
) -> list[str]:
    """Return permission codes granted by the user's effective roles."""
    roles = get_effective_roles(db, application_id, user_id)
    if not roles:
        return []

    role_ids = [r.id for r in roles]

    granted: set[str] = set()
    rows = db.execute(
        select(Permission.code)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .where(
            RolePermission.role_id.in_(role_ids),
            Permission.application_id == application_id,
        )
    ).all()
    for (code,) in rows:
        granted.add(code)

    return sorted(granted)
