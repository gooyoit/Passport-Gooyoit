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

def get_effective_permissions_for_users(
    db: Session, application_id: int, user_ids: list[int],
) -> dict[int, list[str]]:
    if not user_ids:
        return {}
    application = db.get(Application, application_id)
    if application is None or application.status != "active":
        return {uid: [] for uid in user_ids}
    user_ids_set = set(user_ids)
    memberships = db.scalars(
        select(ApplicationUser).where(
            ApplicationUser.application_id == application_id,
            ApplicationUser.user_id.in_(user_ids_set),
            ApplicationUser.status == "active",
        )
    ).all()
    active_user_ids = {m.user_id for m in memberships}
    role_ids_by_user: dict[int, set[int]] = {uid: set() for uid in user_ids}
    if application.default_role_id is not None:
        for uid in active_user_ids:
            role_ids_by_user[uid].add(application.default_role_id)
    explicit = db.execute(
        select(UserRole.user_id, UserRole.role_id).where(
            UserRole.application_id == application_id,
            UserRole.user_id.in_(active_user_ids),
        )
    ).all()
    for uid, rid in explicit:
        role_ids_by_user[uid].add(rid)
    all_role_ids = set()
    for rids in role_ids_by_user.values():
        all_role_ids.update(rids)
    if not all_role_ids:
        return {uid: [] for uid in user_ids}
    perm_rows = db.execute(
        select(RolePermission.role_id, Permission.code)
        .join(Permission, Permission.id == RolePermission.permission_id)
        .where(RolePermission.role_id.in_(all_role_ids))
    ).all()
    perms_by_role: dict[int, set[str]] = {}
    for rid, pcode in perm_rows:
        perms_by_role.setdefault(rid, set()).add(pcode)
    result: dict[int, list[str]] = {}
    for uid in user_ids:
        granted: set[str] = set()
        for rid in role_ids_by_user.get(uid, set()):
            granted.update(perms_by_role.get(rid, set()))
        result[uid] = sorted(granted)
    return result


def get_effective_roles_for_users(
    db: Session, application_id: int, user_ids: list[int],
) -> dict[int, list[str]]:
    """Return role codes for multiple users in an application."""
    if not user_ids:
        return {}
    application = db.get(Application, application_id)
    if application is None or application.status != "active":
        return {uid: [] for uid in user_ids}
    user_ids_set = set(user_ids)
    memberships = db.scalars(
        select(ApplicationUser).where(
            ApplicationUser.application_id == application_id,
            ApplicationUser.user_id.in_(user_ids_set),
            ApplicationUser.status == "active",
        )
    ).all()
    active_user_ids = {m.user_id for m in memberships}
    role_ids_by_user: dict[int, set[int]] = {uid: set() for uid in user_ids}
    if application.default_role_id is not None:
        for uid in active_user_ids:
            role_ids_by_user[uid].add(application.default_role_id)
    explicit = db.execute(
        select(UserRole.user_id, UserRole.role_id).where(
            UserRole.application_id == application_id,
            UserRole.user_id.in_(active_user_ids),
        )
    ).all()
    for uid, rid in explicit:
        role_ids_by_user[uid].add(rid)
    all_role_ids = set()
    for rids in role_ids_by_user.values():
        all_role_ids.update(rids)
    if not all_role_ids:
        return {uid: [] for uid in user_ids}
    roles = db.scalars(
        select(Role).where(Role.id.in_(all_role_ids))
    ).all()
    role_code_by_id: dict[int, str] = {r.id: r.code for r in roles}
    result: dict[int, list[str]] = {}
    for uid in user_ids:
        codes = sorted({role_code_by_id[rid] for rid in role_ids_by_user[uid] if rid in role_code_by_id})
        result[uid] = codes
    return result
