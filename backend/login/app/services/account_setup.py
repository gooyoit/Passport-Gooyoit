"""Short-lived account completion flow for new third-party identities."""

import json
import secrets
from typing import Any
from urllib.parse import urlencode

from fastapi import HTTPException, Response, status
from redis.exceptions import RedisError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.redis import get_redis_client
from app.core.security import hash_password, utcnow, verify_password
from app.models import User, UserIdentity, UserStatus
from app.schemas import AccountSetupRequest
from app.services.account import consume_bind_email_code, find_local_user
from app.services.applications import get_active_application_by_client_id
from app.services.auth import (
    _set_sso_cookie_if_enabled,
    create_authorization_code,
    ensure_application_user,
)

_KEY_PREFIX = "passport:oauth-account-setup:"


def create_pending_account_setup(data: dict[str, Any]) -> str:
    """Persist a new OAuth identity context in Redis and return an opaque token."""
    redis_client = get_redis_client()
    if redis_client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Account setup is temporarily unavailable",
        )
    token = secrets.token_urlsafe(32)
    try:
        redis_client.setex(
            _KEY_PREFIX + token,
            settings.account_setup_ttl_seconds,
            json.dumps(data, ensure_ascii=False),
        )
    except RedisError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Account setup is temporarily unavailable",
        ) from exc
    return token


def get_pending_account_setup(token: str) -> dict[str, Any]:
    """Read a pending setup context without consuming it."""
    redis_client = get_redis_client()
    try:
        raw = redis_client.get(_KEY_PREFIX + token) if redis_client else None
    except RedisError:
        raw = None
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account setup link is invalid or expired",
        )
    return json.loads(raw)


def _delete_pending_account_setup(token: str) -> None:
    redis_client = get_redis_client()
    if redis_client is None:
        return
    try:
        redis_client.delete(_KEY_PREFIX + token)
    except RedisError:
        pass


def complete_account_setup(
    db: Session,
    response: Response,
    payload: AccountSetupRequest,
) -> str:
    """Create/link the canonical user and finish the original OAuth request."""
    pending = get_pending_account_setup(payload.token)
    application = get_active_application_by_client_id(db, pending["client_id"])
    if application is None:
        raise HTTPException(status_code=404, detail="Application not found")

    existing_identity = db.scalar(
        select(UserIdentity).where(
            UserIdentity.provider == pending["provider"],
            UserIdentity.provider_user_id == pending["provider_user_id"],
        )
    )
    if existing_identity is not None:
        user = db.get(User, existing_identity.user_id)
        if user is None:
            raise HTTPException(status_code=404, detail="User not found")
        if user.status != UserStatus.ACTIVE:
            raise HTTPException(status_code=403, detail="User is disabled")
    elif payload.mode == "link":
        if not payload.identifier or not payload.existing_password:
            raise HTTPException(status_code=400, detail="Username/email and password are required")
        user = find_local_user(db, identifier=payload.identifier)
        if user is None or not user.hashed_password or not verify_password(
            payload.existing_password, user.hashed_password
        ):
            raise HTTPException(status_code=401, detail="Invalid username/email or password")
        if user.status != UserStatus.ACTIVE:
            raise HTTPException(status_code=403, detail="User is disabled")
        normalized_identifier = payload.identifier.strip().lower()
        if (
            user.email
            and user.email.lower() == normalized_identifier
            and not user.email_verified_at
        ):
            raise HTTPException(status_code=401, detail="Email is not verified")
    else:
        username = (
            payload.username.strip().lower()
            if payload.mode == "new" and payload.username
            else None
        )
        email = (
            str(payload.email).lower()
            if payload.mode == "new" and payload.email
            else None
        )
        user = None
        if email:
            consume_bind_email_code(db, email=email, code=payload.email_code)
            user = db.scalar(select(User).where(func.lower(User.email) == email))
            if user is not None:
                if user.status != UserStatus.ACTIVE:
                    raise HTTPException(status_code=403, detail="User is disabled")
                user.email_verified_at = user.email_verified_at or utcnow()

        if user is None:
            if payload.mode == "new" and bool(username) != bool(payload.password):
                raise HTTPException(status_code=400, detail="Username and password must be set together")
            if username and db.scalar(
                select(User.id).where(func.lower(User.username) == username)
            ):
                raise HTTPException(status_code=409, detail="Username is already in use")
            user = User(
                username=username,
                email=email,
                email_verified_at=utcnow() if email else None,
                contact_phone=payload.contact_phone if payload.mode == "new" else None,
                display_name=pending.get("display_name") or username or "Passport User",
                avatar_url=pending.get("avatar_url"),
                hashed_password=(
                    hash_password(payload.password)
                    if payload.mode == "new" and payload.password
                    else None
                ),
                status=UserStatus.ACTIVE,
            )
            db.add(user)
            db.flush()
        if email:
            email_identity = db.scalar(
                select(UserIdentity).where(
                    UserIdentity.provider == "email",
                    UserIdentity.provider_user_id == email,
                )
            )
            if email_identity is None:
                db.add(
                    UserIdentity(
                        user_id=user.id,
                        provider="email",
                        provider_user_id=email,
                        provider_email=email,
                        raw_profile={},
                    )
                )
            elif email_identity.user_id != user.id:
                raise HTTPException(status_code=409, detail="Email identity belongs to another account")

    if existing_identity is None:
        db.add(
            UserIdentity(
                user_id=user.id,
                provider=pending["provider"],
                provider_user_id=pending["provider_user_id"],
                provider_email=user.email,
                raw_profile=pending.get("raw_profile") or {},
            )
        )

    membership = ensure_application_user(
        db, application=application, user=user, require_public_users=False
    )
    membership.last_login_at = utcnow()
    auth_code = create_authorization_code(
        db,
        application=application,
        user=user,
        redirect_uri=pending["redirect_uri"],
    )
    _set_sso_cookie_if_enabled(db, response, application, user.id)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Account data is already in use") from exc

    _delete_pending_account_setup(payload.token)
    query = {"code": auth_code.code}
    if pending.get("state"):
        query["state"] = pending["state"]
    return f"{pending['redirect_uri']}?{urlencode(query)}"
