"""Application CRUD endpoints: list, create, get, login-methods, roles, permissions."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.deps import get_current_user_id
from app.models import (
    Application,
    ApplicationClientSecret,
    ApplicationLoginMethod,
    Permission,
    Role,
    RolePermission,
)
from app.schemas import (
    ApplicationCreate,
    ApplicationCreated,
    ApplicationRead,
    ApplicationUpdate,
    ClientSecretItem,
    ClientSecretResponse,
    LoginMethodRead,
    LoginMethodUpsert,
    PermissionCreate,
    PermissionRead,
    RoleCreate,
    RoleRead,
)
from app.services.applications import create_application

router = APIRouter(tags=["applications"], dependencies=[Depends(get_current_user_id)])


# ---------------------------------------------------------------------------
# Applications
# ---------------------------------------------------------------------------

@router.get("/applications", response_model=list[ApplicationRead])
def list_applications(db: Session = Depends(get_db)) -> list[Application]:
    """List Passport applications."""
    return list(db.scalars(select(Application).order_by(Application.id)).all())


@router.post(
    "/applications",
    response_model=ApplicationCreated,
    status_code=status.HTTP_201_CREATED,
)
def create_application_endpoint(
    payload: ApplicationCreate,
    db: Session = Depends(get_db),
) -> ApplicationCreated:
    """Create a Passport application."""
    application, client_secret = create_application(
        db,
        name=payload.name,
        description=payload.description,
        redirect_uris=[str(uri) for uri in payload.redirect_uris],
        enable_public_users=payload.enable_public_users,
        enable_sso=payload.enable_sso,
    )
    data = ApplicationRead.model_validate(application).model_dump()
    return ApplicationCreated(**data, client_secret=client_secret)


@router.get("/applications/{application_id}", response_model=ApplicationRead)
def get_application(
    application_id: int,
    db: Session = Depends(get_db),
) -> Application:
    """Get one Passport application."""
    application = db.get(Application, application_id)
    if application is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Application not found"
        )
    return application


@router.patch("/applications/{application_id}", response_model=ApplicationRead)
def update_application(
    application_id: int,
    payload: ApplicationUpdate,
    db: Session = Depends(get_db),
) -> Application:
    """Update an application's settings."""
    application = db.get(Application, application_id)
    if application is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Application not found"
        )
    if payload.name is not None:
        application.name = payload.name
    if payload.description is not None:
        application.description = payload.description
    if payload.redirect_uris is not None:
        application.redirect_uris = [str(uri) for uri in payload.redirect_uris]
    if payload.enable_public_users is not None:
        application.enable_public_users = payload.enable_public_users
    if payload.enable_sso is not None:
        application.enable_sso = payload.enable_sso
    db.commit()
    db.refresh(application)
    return application


# ---------------------------------------------------------------------------
# Client secrets
# ---------------------------------------------------------------------------


@router.post(
    "/applications/{application_id}/regenerate-secret",
    response_model=ClientSecretResponse,
)
def regenerate_secret(
    application_id: int,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Generate a new client secret (old secrets remain valid)."""
    from app.services.applications import _hash_secret

    import secrets

    application = db.get(Application, application_id)
    if application is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Application not found"
        )
    new_secret = secrets.token_urlsafe(32)
    db.add(
        ApplicationClientSecret(
            application_id=application.id,
            secret_hash=_hash_secret(new_secret),
        )
    )
    db.commit()
    return {"client_secret": new_secret}


@router.get(
    "/applications/{application_id}/secrets",
    response_model=list[ClientSecretItem],
)
def list_secrets(
    application_id: int,
    db: Session = Depends(get_db),
) -> list[dict]:
    """List client secrets for an application (no plaintext)."""
    application = db.get(Application, application_id)
    if application is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Application not found"
        )
    rows = list(
        db.scalars(
            select(ApplicationClientSecret)
            .where(ApplicationClientSecret.application_id == application_id)
            .order_by(ApplicationClientSecret.id.desc())
        ).all()
    )
    result = []
    for row in rows:
        h = row.secret_hash
        if h.startswith("sha256:"):
            body = h[7:]
            masked = "sha256:" + body[:12] + "•" * 12 + body[-4:] if len(body) > 16 else h
        else:
            masked = h[:8] + "•" * 16 + h[-4:] if len(h) > 12 else "•" * len(h)
        result.append({"id": row.id, "masked_hash": masked, "created_at": row.created_at})
    return result


@router.delete("/applications/{application_id}/secrets/{secret_id}")
def delete_secret(
    application_id: int,
    secret_id: int,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Delete a client secret."""
    secret = db.get(ApplicationClientSecret, secret_id)
    if secret is None or secret.application_id != application_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Secret not found"
        )
    db.delete(secret)
    db.commit()
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Login methods
# ---------------------------------------------------------------------------

@router.get(
    "/applications/{application_id}/login-methods",
    response_model=list[LoginMethodRead],
)
def list_login_methods(
    application_id: int,
    db: Session = Depends(get_db),
) -> list[ApplicationLoginMethod]:
    """List login methods for an application."""
    return list(
        db.scalars(
            select(ApplicationLoginMethod)
            .where(ApplicationLoginMethod.application_id == application_id)
            .order_by(ApplicationLoginMethod.method)
        ).all()
    )


@router.post("/applications/{application_id}/login-methods")
def upsert_login_method(
    application_id: int,
    payload: LoginMethodUpsert,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Enable or disable one login method for an application."""
    method = db.scalar(
        select(ApplicationLoginMethod).where(
            ApplicationLoginMethod.application_id == application_id,
            ApplicationLoginMethod.method == payload.method,
        )
    )
    if method is None:
        method = ApplicationLoginMethod(
            application_id=application_id,
            method=payload.method,
            enabled=payload.enabled,
            config=payload.config or {},
        )
        db.add(method)
    else:
        method.enabled = payload.enabled
        method.config = payload.config or {}
    db.commit()
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Roles
# ---------------------------------------------------------------------------

@router.get("/applications/{application_id}/roles", response_model=list[RoleRead])
def list_roles(
    application_id: int,
    db: Session = Depends(get_db),
) -> list[Role]:
    """List application roles."""
    return list(
        db.scalars(
            select(Role)
            .where(Role.application_id == application_id)
            .order_by(Role.id)
        ).all()
    )


@router.post(
    "/applications/{application_id}/roles",
    response_model=RoleRead,
    status_code=status.HTTP_201_CREATED,
)
def create_role(
    application_id: int,
    payload: RoleCreate,
    db: Session = Depends(get_db),
) -> Role:
    """Create an application-local role."""
    if payload.is_default:
        existing_default = db.scalar(
            select(Role).where(
                Role.application_id == application_id, Role.is_default.is_(True)
            )
        )
        if existing_default is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Application already has a default role",
            )
    role = Role(
        application_id=application_id,
        code=payload.code,
        name=payload.name,
        description=payload.description,
        is_default=payload.is_default,
    )
    db.add(role)
    db.commit()
    db.refresh(role)
    return role


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------

@router.get(
    "/applications/{application_id}/permissions",
    response_model=list[PermissionRead],
)
def list_permissions(
    application_id: int,
    db: Session = Depends(get_db),
) -> list[Permission]:
    """List application permissions."""
    return list(
        db.scalars(
            select(Permission)
            .where(Permission.application_id == application_id)
            .order_by(Permission.id)
        ).all()
    )


@router.post(
    "/applications/{application_id}/permissions",
    response_model=PermissionRead,
    status_code=status.HTTP_201_CREATED,
)
def create_permission(
    application_id: int,
    payload: PermissionCreate,
    db: Session = Depends(get_db),
) -> Permission:
    """Create an application-local permission."""
    permission = Permission(
        application_id=application_id,
        code=payload.code,
        name=payload.name,
        description=payload.description,
    )
    db.add(permission)
    db.commit()
    db.refresh(permission)
    return permission


# ---------------------------------------------------------------------------
# Role-Permission assignment
# ---------------------------------------------------------------------------

@router.post(
    "/applications/{application_id}/roles/{role_id}/permissions/{permission_id}"
)
def assign_permission_to_role(
    application_id: int,
    role_id: int,
    permission_id: int,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Assign a permission to a role."""
    role = db.get(Role, role_id)
    permission = db.get(Permission, permission_id)
    if (
        role is None
        or permission is None
        or role.application_id != application_id
        or permission.application_id != application_id
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role or permission not found",
        )

    existing = db.scalar(
        select(RolePermission).where(
            RolePermission.role_id == role_id,
            RolePermission.permission_id == permission_id,
        )
    )
    if existing is None:
        db.add(RolePermission(role_id=role_id, permission_id=permission_id))
        db.commit()
    return {"status": "ok"}
