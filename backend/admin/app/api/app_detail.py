"""Application-detail endpoints: users, role assignments, user status within app."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.deps import get_current_user_id
from app.models import ApplicationUser, Role, UserRole
from app.schemas import ApplicationUserRead, ApplicationUserStatusUpdate
from app.services.permissions import get_effective_permissions, get_effective_roles

router = APIRouter(
    tags=["app-detail"], dependencies=[Depends(get_current_user_id)]
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
    return [
        ApplicationUserRead(
            id=membership.id,
            application_id=membership.application_id,
            user_id=membership.user_id,
            status=membership.status,
            roles=[
                role.code
                for role in get_effective_roles(db, membership.application_id, membership.user_id)
            ],
            permissions=get_effective_permissions(
                db,
                membership.application_id,
                membership.user_id,
            ),
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
    return ApplicationUserRead(
        id=membership.id,
        application_id=membership.application_id,
        user_id=membership.user_id,
        status=membership.status,
        roles=[role.code for role in get_effective_roles(db, application_id, user_id)],
        permissions=get_effective_permissions(db, application_id, user_id),
    )


@router.post("/applications/{application_id}/users/{user_id}/roles/{role_id}")
def assign_role_to_user(
    application_id: int,
    user_id: int,
    role_id: int,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Assign an explicit role to a user."""
    role = db.get(Role, role_id)
    if role is None or role.application_id != application_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Role not found"
        )

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
