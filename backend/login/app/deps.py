"""Shared FastAPI dependencies."""

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.session import get_db
from app.models import User, UserStatus
from app.services.auth import SSO_COOKIE_NAME
from app.services.sso import resolve_sso_user_id


def get_account_user(
    authorization: str | None = Header(default=None),
    request: Request = None,  # injected by FastAPI
    db: Session = Depends(get_db),
) -> tuple[User, int | None]:
    """Resolve the caller via Bearer access token, falling back to the SSO cookie.

    Returns the user plus the originating application id (None for the
    cookie path, which has no application context).
    """
    if authorization and authorization.startswith("Bearer "):
        try:
            claims = decode_access_token(authorization.removeprefix("Bearer ").strip())
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
            ) from exc
        user = db.get(User, int(claims["sub"]))
        if user is None or user.status != UserStatus.ACTIVE:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="User is disabled"
            )
        return user, int(claims["application_id"])

    user_id = resolve_sso_user_id(db, token=request.cookies.get(SSO_COOKIE_NAME))
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    user = db.get(User, user_id)
    if user is None or user.status != UserStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="User is disabled"
        )
    return user, None
