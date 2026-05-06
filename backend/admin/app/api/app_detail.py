"""Application-detail endpoints: users, role assignments, user status within app."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.deps import require_admin, require_super_admin
from app.models import ApplicationUser, Role, User, UserRole, WebAuthnCredential
from app.schemas import ApplicationUserRead, ApplicationUserStatusUpdate, PaginatedResponse, WebAuthnCredentialRead
from app.services.permissions import (
    get_effective_permissions,
    get_effective_permissions_for_users,
    get_effective_roles_for_users,
    get_effective_roles,
)

router = APIRouter(
    tags=["app-detail"], dependencies=[Depends(require_admin)]
)


@router.get(
    "/applications/{application_id}/users",
    response_model=PaginatedResponse[ApplicationUserRead],
)
def list_application_users(
    application_id: int,
    db: Session = Depends(get_db),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> PaginatedResponse[ApplicationUserRead]:
    """List users that have joined an application."""
    base_query = (
        select(ApplicationUser)
        .where(ApplicationUser.application_id == application_id)
    )
    total = db.scalar(select(func.count()).select_from(base_query.subquery())) or 0
    memberships = db.scalars(
        base_query
        .order_by(ApplicationUser.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    user_ids = [m.user_id for m in memberships]
    users_by_id = {
        u.id: u
        for u in db.scalars(select(User).where(User.id.in_(user_ids))).all()
    }
    perms_map = get_effective_permissions_for_users(db, application_id, user_ids)
    roles_map = get_effective_roles_for_users(db, application_id, user_ids)
    items = [
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
    return {"items": items, "total": total}


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
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Data conflict")
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
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Data conflict")
    return {"status": "ok"}


@router.get("/applications/{application_id}/passkeys", response_model=PaginatedResponse[WebAuthnCredentialRead])
def list_passkeys(
    application_id: int,
    db: Session = Depends(get_db),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> PaginatedResponse[WebAuthnCredentialRead]:
    """List all Passkey credentials for an application."""
    app_user_ids = db.scalars(
        select(ApplicationUser.user_id).where(
            ApplicationUser.application_id == application_id,
            ApplicationUser.status == "active",
        )
    ).all()
    if not app_user_ids:
        return {"items": [], "total": 0}

    base_query = (
        select(WebAuthnCredential)
        .where(WebAuthnCredential.user_id.in_(app_user_ids))
    )
    total = db.scalar(select(func.count()).select_from(base_query.subquery())) or 0
    creds = db.scalars(
        base_query
        .order_by(WebAuthnCredential.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()

    users_by_id = {
        u.id: u
        for u in db.scalars(select(User).where(User.id.in_([c.user_id for c in creds]))).all()
    }
    items = [
        WebAuthnCredentialRead(
            id=c.id,
            user_id=c.user_id,
            user_email=users_by_id[c.user_id].email,
            user_display_name=users_by_id[c.user_id].display_name,
            credential_id=c.credential_id,
            sign_count=c.sign_count,
            transports=c.transports,
            device_name=c.device_name,
            aaguid=c.aaguid,
            created_at=c.created_at,
        )
        for c in creds
    ]
    return {"items": items, "total": total}


@router.delete("/applications/{application_id}/passkeys/{credential_id}")
def delete_passkey(
    application_id: int,
    credential_id: int,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Delete a Passkey credential."""
    app_user_ids = db.scalars(
        select(ApplicationUser.user_id).where(
            ApplicationUser.application_id == application_id,
        )
    ).all()
    if not app_user_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

    cred = db.scalar(
        select(WebAuthnCredential).where(
            WebAuthnCredential.id == credential_id,
            WebAuthnCredential.user_id.in_(app_user_ids),
        )
    )
    if cred is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Credential not found")
    db.delete(cred)
    db.commit()
    return {"status": "ok"}
