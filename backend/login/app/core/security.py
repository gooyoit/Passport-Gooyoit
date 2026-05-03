"""Security helpers for secrets, codes, and JWTs."""

import bcrypt
from datetime import UTC, datetime, timedelta
import hashlib
import hmac
import secrets
from typing import Any

import jwt
import structlog

from app.core.config import settings

logger = structlog.get_logger(__name__)


def utcnow() -> datetime:
    """Return a naive UTC timestamp for database persistence."""
    return datetime.now(UTC).replace(tzinfo=None)


def random_token(byte_length: int = 32) -> str:
    """Return a URL-safe random token."""
    return secrets.token_urlsafe(byte_length)


def random_digits(length: int = 6) -> str:
    """Return a numeric verification code."""
    return "".join(secrets.choice("0123456789") for _ in range(length))


def hash_secret(value: str) -> str:
    """Hash a secret with an application-level HMAC key."""
    digest = hmac.new(
        settings.secret_key.encode("utf-8"),
        value.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"sha256:{digest}"


def verify_secret(value: str, hashed_value: str) -> bool:
    """Verify a plaintext secret against a stored hash."""
    return hmac.compare_digest(hash_secret(value), hashed_value)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed_password.encode("utf-8"))
    except (ValueError, TypeError):
        logger.warning("password_verification_error")
        return False


def create_access_token(
    *,
    subject: str,
    application_id: int,
    expires_in: int,
    extra_claims: dict[str, Any] | None = None,
) -> str:
    """Create a signed JWT access token."""
    now = utcnow().replace(tzinfo=UTC)
    claims: dict[str, Any] = {
        "iss": settings.jwt_issuer,
        "sub": subject,
        "application_id": application_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=expires_in)).timestamp()),
    }
    if extra_claims:
        claims.update(extra_claims)
    return jwt.encode(claims, settings.secret_key, algorithm="HS256")


def decode_access_token(token: str) -> dict[str, Any]:
    """Decode and validate an access token."""
    return jwt.decode(
        token,
        settings.secret_key,
        algorithms=["HS256"],
        issuer=settings.jwt_issuer,
    )
