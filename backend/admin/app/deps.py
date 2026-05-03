"""FastAPI dependencies for authentication and authorization."""

import structlog

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import httpx

from app.config import settings

logger = structlog.get_logger(__name__)

_bearer_scheme = HTTPBearer()

SUPER_ADMIN_ROLE = "super_admin"
ADMIN_ROLE = "admin"


async def _verify_token(credentials: HTTPAuthorizationCredentials) -> dict:
    """Validate the Bearer token via Passport /oauth/userinfo and return full response."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{settings.passport_api_url}/oauth/userinfo",
                headers={"Authorization": f"Bearer {credentials.credentials}"},
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
    except httpx.RequestError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Passport service unavailable",
        )


async def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
) -> int:
    """Validate the Bearer token via Passport /oauth/userinfo and return user_id."""
    data = await _verify_token(credentials)
    user = data.get("user")
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing user info",
        )
    return int(user["id"])


async def require_admin(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
) -> int:
    """Require the user to have 'admin' or 'super_admin' role in the Admin application."""
    data = await _verify_token(credentials)
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


async def require_super_admin(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
) -> int:
    """Require the user to have 'super_admin' role in the Admin application."""
    data = await _verify_token(credentials)
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
