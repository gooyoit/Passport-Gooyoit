"""SSO session storage with Redis primary and database fallback."""

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.redis import get_redis_client
from app.core.security import hash_secret, random_token, utcnow
from app.models import SsoSession


def create_sso_session(db: Session, *, user_id: int) -> str:
    """Create an SSO session in Redis when available and persist DB fallback."""
    token = random_token(32)
    token_hash = hash_secret(token)
    expires_at = utcnow() + timedelta(seconds=settings.sso_session_ttl_seconds)

    redis_client = get_redis_client()
    if redis_client is not None:
        redis_client.setex(
            f"sso:{token_hash}",
            settings.sso_session_ttl_seconds,
            str(user_id),
        )

    db.add(
        SsoSession(
            session_id_hash=token_hash,
            user_id=user_id,
            expires_at=expires_at,
        )
    )
    return token


def resolve_sso_user_id(db: Session, *, token: str | None) -> int | None:
    """Resolve an SSO cookie token to a user ID."""
    if not token:
        return None
    token_hash = hash_secret(token)

    redis_client = get_redis_client()
    if redis_client is not None:
        value = redis_client.get(f"sso:{token_hash}")
        if value:
            return int(value)

    session = db.scalar(
        select(SsoSession).where(
            SsoSession.session_id_hash == token_hash,
            SsoSession.revoked_at.is_(None),
            SsoSession.expires_at > utcnow(),
        )
    )
    if session is None:
        return None
    return session.user_id


def revoke_sso_session(db: Session, *, token: str | None) -> bool:
    """Revoke an SSO session from Redis and database fallback."""
    if not token:
        return False
    token_hash = hash_secret(token)
    revoked = False

    redis_client = get_redis_client()
    if redis_client is not None:
        revoked = bool(redis_client.delete(f"sso:{token_hash}"))

    session = db.scalar(
        select(SsoSession).where(
            SsoSession.session_id_hash == token_hash,
            SsoSession.revoked_at.is_(None),
        )
    )
    if session is not None:
        session.revoked_at = utcnow()
        db.commit()
        revoked = True
    return revoked
