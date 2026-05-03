"""Application management service."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_secret, random_token
from app.models import Application, ApplicationClientSecret, ApplicationLoginMethod, Role


def create_application(
    db: Session,
    *,
    name: str,
    redirect_uris: list[str],
    description: str | None,
    enable_public_users: bool,
    enable_sso: bool,
) -> tuple[Application, str]:
    """Create an application and its default role."""
    client_id = f"app_{random_token(12)}"
    client_secret = random_token(32)
    application = Application(
        client_id=client_id,
        name=name,
        description=description,
        redirect_uris=redirect_uris,
        enable_public_users=enable_public_users,
        enable_sso=enable_sso,
        access_token_ttl_seconds=settings.access_token_ttl_seconds,
        refresh_token_ttl_seconds=settings.refresh_token_ttl_seconds,
        status="active",
    )
    db.add(application)
    db.flush()

    db.add(ApplicationClientSecret(
        application_id=application.id,
        secret_hash=hash_secret(client_secret),
    ))

    default_role = Role(
        application_id=application.id,
        code="member",
        name="普通用户",
        description="系统默认角色",
        is_default=True,
    )
    db.add(default_role)
    db.flush()

    application.default_role_id = default_role.id
    db.add(
        ApplicationLoginMethod(
            application_id=application.id,
            method="email_code",
            enabled=True,
            config={},
        )
    )
    db.commit()
    db.refresh(application)
    return application, client_secret


def get_active_application_by_client_id(db: Session, client_id: str) -> Application | None:
    """Return an active application by client ID."""
    statement = select(Application).where(
        Application.client_id == client_id,
        Application.status == "active",
    )
    return db.scalar(statement)


def validate_redirect_uri(application: Application, redirect_uri: str) -> bool:
    """Return whether a redirect URI is allowed for the application."""
    return redirect_uri in application.redirect_uris


def is_login_method_enabled(db: Session, application_id: int, method: str) -> bool:
    """Return whether a login method is enabled."""
    statement = select(ApplicationLoginMethod).where(
        ApplicationLoginMethod.application_id == application_id,
        ApplicationLoginMethod.method == method,
        ApplicationLoginMethod.enabled.is_(True),
    )
    return db.scalar(statement) is not None
