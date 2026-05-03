"""Application query helpers for the login backend."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Application, ApplicationLoginMethod


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
