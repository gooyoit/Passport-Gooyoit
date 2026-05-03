"""FastAPI dependencies for authentication and authorization."""

import hashlib
import threading
import time

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings
from app.services.passport import get_http_client

_bearer_scheme = HTTPBearer()

SUPER_ADMIN_ROLE = "super_admin"
ADMIN_ROLE = "admin"

_cache: dict[str, tuple[float, dict]] = {}
_cache_lock = threading.Lock()
_CACHE_TTL = 60


async def _verify_token(credentials: HTTPAuthorizationCredentials) -> dict:
    """Validate the Bearer token via Passport /oauth/userinfo and return full response."""
    token_key = hashlib.sha256(credentials.credentials.encode()).hexdigest()

    with _cache_lock:
        cached = _cache.get(token_key)
    if cached is not None:
        ts, data = cached
        if time.monotonic() - ts < _CACHE_TTL:
            return data
        with _cache_lock:
            _cache.pop(token_key, None)

    import httpx

    try:
        client = get_http_client()
        resp = await client.get(
            f"{settings.passport_api_url}/oauth/userinfo",
            headers={"Authorization": f"Bearer {credentials.credentials}"},
        )
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPStatusError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
    except httpx.RequestError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Service temporarily unavailable",
        )
    if not data.get("user") or "id" not in data.get("user", {}):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Authentication service error",
        )

    with _cache_lock:
        _cache[token_key] = (time.monotonic(), data)

    return data


async def _parse_token(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
) -> dict:
    return await _verify_token(credentials)


async def get_current_user_id(data: dict = Depends(_parse_token)) -> int:
    """Validate the Bearer token via Passport /oauth/userinfo and return user_id."""
    user = data.get("user")
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing user info",
        )
    return int(user["id"])


async def require_admin(data: dict = Depends(_parse_token)) -> int:
    """Require the user to have 'admin' or 'super_admin' role in the Admin application."""
    user = data.get("user")
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing user info",
        )
    roles = data.get("roles", [])
    if ADMIN_ROLE not in roles and SUPER_ADMIN_ROLE not in roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return int(user["id"])


async def require_super_admin(data: dict = Depends(_parse_token)) -> int:
    """Require the user to have 'super_admin' role in the Admin application."""
    user = data.get("user")
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing user info",
        )
    roles = data.get("roles", [])
    if SUPER_ADMIN_ROLE not in roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super admin access required",
        )
    return int(user["id"])
