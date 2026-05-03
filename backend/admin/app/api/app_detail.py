"""Application-detail endpoints: users, role assignments, user status within app."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.deps import require_admin, require_super_admin
from app.models import ApplicationUser, Role, User, UserRole
from app.schemas import ApplicationUserRead, ApplicationUserStatusUpdate
from app.services.permissions import (
    get_effective_permissions,
    get_effective_permissions_for_users,
    get_effective_roles,
)

router = APIRouter(
    tags=["app-detail"], dependencies=[Depends(require_admin)]
)


@router.get(
    "/applications/{application_id}/users",
    response_model=list[ApplicationUserRead],
)
def list_application_users(
    application_id: int,
    db: Session = Depends(get_db),
) -> list[ApplicationUserRead]:
    """List users that have joined an application."""
    memberships = db.scalars(
        select(ApplicationUser)
        .where(ApplicationUser.application_id == application_id)
        .order_by(ApplicationUser.id)
    ).all()
    user_ids = [m.user_id for m in memberships]
    users_by_id = {
        u.id: u
        for u in db.scalars(select(User).where(User.id.in_(user_ids))).all()
    }
    perms_map = get_effective_permissions_for_users(db, application_id, user_ids)
    roles_map = {uid: [role.code for role in get_effective_roles(db, application_id, uid)] for uid in user_ids}
    return [
        ApplicationUserRead(
            id=membership.id,
            application_id=membership.application_id,
            user_id=membership.user_id,
            user_email=users_by_id[membership.user_id].email,
            user_display_name=users_by_id[membership.user_id].display_name,
            user_status=users_by_id[membership.user_id].status,
            status=membership.status,
            roles=roles_map[membership.user_id],
            permissions=perms_map.get(membership.user_id, []),
        )
        for membership in memberships
    ]


@router.patch(
    "/applications/{application_id}/users/{user_id}/status",
    response_model=ApplicationUserRead,
)
def update_application_user_status(
    application_id: int,
    user_id: int,
    payload: ApplicationUserStatusUpdate,
    db: Session = Depends(get_db),
) -> ApplicationUserRead:
    """Enable or disable a user inside one application."""
    membership = db.scalar(
        select(ApplicationUser).where(
            ApplicationUser.application_id == application_id,
            ApplicationUser.user_id == user_id,
        )
    )
    if membership is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application user not found",
        )
    membership.status = payload.status
    db.commit()
    user = db.get(User, user_id)
    return ApplicationUserRead(
        id=membership.id,
        application_id=membership.application_id,
        user_id=membership.user_id,
        user_email=user.email if user else "",
        user_display_name=user.display_name if user else None,
        user_status=user.status if user else "",
        status=membership.status,
        roles=[role.code for role in get_effective_roles(db, application_id, user_id)],
        permissions=get_effective_permissions(db, application_id, user_id),
    )


@router.post("/applications/{application_id}/users/{user_id}/roles/{role_id}")
def assign_role_to_user(
    application_id: int,
    user_id: int,
    role_id: int,
    _admin_user_id: int = Depends(require_super_admin),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Assign an explicit role to a user."""
    membership = db.scalar(
        select(ApplicationUser).where(
            ApplicationUser.application_id == application_id,
            ApplicationUser.user_id == user_id,
        )
    )
    if membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User is not a member of this application")
    role = db.get(Role, role_id)
    if role is None or role.application_id != application_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Role not found"
        )
    if role.code == "super_admin":
        raise HTTPException(status_code=403, detail="Cannot assign super_admin role through this endpoint")

    existing = db.scalar(
        select(UserRole).where(
            UserRole.application_id == application_id,
            UserRole.user_id == user_id,
            UserRole.role_id == role_id,
        )
    )
    if existing is None:
        db.add(
            UserRole(application_id=application_id, user_id=user_id, role_id=role_id)
        )
        db.commit()
    return {"status": "ok"}
