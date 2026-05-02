"""Application management service."""

import hashlib
import hmac
import secrets

from sqlalchemy.orm import Session

from app.config import settings
from app.models import Application, ApplicationLoginMethod, Role


def _hash_secret(value: str) -> str:
    """Hash a secret with the shared SECRET_KEY using HMAC-SHA256."""
    digest = hmac.new(
        settings.secret_key.encode("utf-8"),
        value.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"sha256:{digest}"


def create_application(
    db: Session,
    *,
    name: str,
    redirect_uris: list[str],
    description: str | None,
    enable_public_users: bool,
    enable_sso: bool,
) -> tuple[Application, str]:
    """Create an application and its default role.

    Returns the created ``Application`` ORM object and the **plaintext**
    ``client_secret`` (only shown once to the caller).
    """
    client_id = f"app_{secrets.token_urlsafe(12)}"
    client_secret = secrets.token_urlsafe(32)

    application = Application(
        client_id=client_id,
        client_secret_hash=_hash_secret(client_secret),
        name=name,
        description=description,
        redirect_uris=redirect_uris,
        enable_public_users=enable_public_users,
        enable_sso=enable_sso,
        access_token_ttl_seconds=7200,
        refresh_token_ttl_seconds=2_592_000,
        status="active",
    )
    db.add(application)
    db.flush()

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
