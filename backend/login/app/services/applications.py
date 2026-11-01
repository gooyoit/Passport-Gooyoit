"""Application query helpers for the login backend."""

from urllib.parse import urlsplit

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


def is_allowed_logout_redirect(db: Session, url: str) -> bool:
    """Return whether a logout redirect target shares an origin with any
    registered application redirect URI (open-redirect guard)."""
    target = urlsplit(url)
    if target.scheme not in ("http", "https") or not target.netloc:
        return False
    origin = f"{target.scheme}://{target.netloc}"
    registered = db.scalars(select(Application.redirect_uris)).all()
    return any(
        f"{urlsplit(uri).scheme}://{urlsplit(uri).netloc}" == origin
        for uris in registered
        for uri in uris
    )


def is_login_method_enabled(db: Session, application_id: int, method: str) -> bool:
    """Return whether a login method is enabled."""
    statement = select(ApplicationLoginMethod).where(
        ApplicationLoginMethod.application_id == application_id,
        ApplicationLoginMethod.method == method,
        ApplicationLoginMethod.enabled.is_(True),
    )
    return db.scalar(statement) is not None
